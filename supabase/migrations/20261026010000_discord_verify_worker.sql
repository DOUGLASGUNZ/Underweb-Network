-- Discord join verification, run by the existing UnderWeb Discord worker (underweb-discord-bot).
-- Needs 20261026000000_discord_verify.sql (requests table + VRChat match helpers) first.
--
-- Who should have the Verified role:
--   linked on underweb.cloud (uw_discord.links) and eligible        ← what the worker already did
--   OR an active verification grant:
--      auto          VRChat link matched a verified UnderWeb account linked to this Discord (follows eligibility)
--      staff         a staff member approved them in Discord
--      grandfathered had Verified before role changes were switched on (so nobody loses access)
-- Role changes still only happen when uw_discord.config.apply_enabled is on and the worker has DRY_RUN=false.

create table if not exists uw_discord.grants (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  kind text not null check (kind in ('auto','staff','grandfathered')),
  underweb_user_id uuid references auth.users(id) on delete set null,
  request_id uuid references public.discord_verify_requests(id) on delete set null,
  granted_by_discord_id text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text
);
create unique index if not exists grants_active_discord on uw_discord.grants (discord_user_id) where revoked_at is null;
alter table uw_discord.grants enable row level security;
revoke all on uw_discord.grants from public, anon, authenticated;

-- Does this Discord account hold a valid verification grant?
create or replace function uw_discord.grant_ok(p_discord text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from uw_discord.grants g
     where g.discord_user_id = p_discord and g.revoked_at is null
       and (g.kind <> 'auto' or (g.underweb_user_id is not null and uw_discord.eligible(g.underweb_user_id))))
$$;

-- Same snapshot as before, plus grants.
create or replace function uw_discord.job_snapshot(p_discord text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'discordUserId',j.discord_user_id,'revision',j.leased_revision::text,'leaseId',j.lease_id,'attempts',j.attempts,
    'guildId',c.guild_id,'verifiedRoleId',c.verified_role_id,'applyEnabled',c.apply_enabled,
    'desiredVerified',coalesce(uw_discord.eligible(l.user_id),false) or uw_discord.grant_ok(j.discord_user_id),
    'linkId',l.id)
  from uw_discord.sync_jobs j cross join uw_discord.config c
  left join uw_discord.links l on l.discord_user_id=j.discord_user_id and l.revoked_at is null
  where j.discord_user_id=p_discord;
$$;

-- Discord accounts that count as "this UnderWeb member's Discord": signed in with Discord, linked on the profile,
-- or linked through the bot's own Discord link flow.
create or replace function public.uw_discord_verify_match(p_vrc_user_id text)
returns table (user_id uuid, discord_ids text[])
language sql stable security definer set search_path = public, auth as $$
  select c.user_id,
         array(
           select distinct x from (
             select p.discord_user_id as x from public.profiles p where p.id = c.user_id
             union all
             select i.provider_id from auth.identities i where i.user_id = c.user_id and i.provider = 'discord'
             union all
             select l.discord_user_id from uw_discord.links l where l.user_id = c.user_id and l.revoked_at is null
           ) s where x is not null
         )
    from public.network_connections c
   where c.provider = 'vrchat' and c.verification_status = 'verified' and lower(c.external_id) = lower(p_vrc_user_id)
$$;
revoke all on function public.uw_discord_verify_match(text) from public, anon, authenticated;
grant execute on function public.uw_discord_verify_match(text) to service_role;

-- Same worker check uw_bot_dispatch uses.
create or replace function uw_discord.worker_ok(p_token_hash text, p_guild text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from uw_discord.config c
      join uw_discord.worker_credentials w on w.guild_id = c.guild_id
     where c.singleton and c.enabled and c.guild_id = p_guild
       and w.token_hash = p_token_hash and w.revoked_at is null and (w.expires_at is null or w.expires_at > now()))
$$;

-- Worker actions for the Verify button / staff buttons. Called only by the underweb-discord edge function (service role).
create or replace function public.uw_bot_verify(p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_discord text := p_payload->>'discordUserId';
  v_vrc text := lower(coalesce(p_payload->>'vrcUserId', ''));
  v_req public.discord_verify_requests;
  v_owner uuid; v_ids text[]; v_mine uuid; v_reason text; v_kind text; v_id uuid;
  v_apply boolean;
begin
  if not uw_discord.worker_ok(p_payload->>'tokenHash', p_payload->>'guildId') then raise exception 'WORKER_UNAUTHORIZED'; end if;
  select apply_enabled into v_apply from uw_discord.config where singleton;

  if p_action = 'verify_submit' then
    if v_discord !~ '^[0-9]{17,20}$' or v_vrc !~ '^usr_[0-9a-f-]{36}$' then raise exception 'INVALID_REQUEST'; end if;
    perform pg_advisory_xact_lock(hashtext('uwv:' || v_discord));
    if uw_discord.grant_ok(v_discord) or exists (select 1 from uw_discord.links l where l.discord_user_id = v_discord and l.revoked_at is null and uw_discord.eligible(l.user_id)) then
      perform uw_discord.enqueue(v_discord);
      return jsonb_build_object('outcome','already','applyEnabled',v_apply);
    end if;
    if exists (select 1 from public.discord_verify_requests where discord_user_id = v_discord and outcome = 'pending') then
      return jsonb_build_object('outcome','already_pending');
    end if;
    if exists (select 1 from public.discord_verify_requests where discord_user_id = v_discord and outcome = 'denied' and decided_at > now() - interval '24 hours') then
      return jsonb_build_object('outcome','cooldown');
    end if;
    if (select count(*) from public.discord_verify_requests where discord_user_id = v_discord and created_at > now() - interval '1 hour') >= 5 then
      return jsonb_build_object('outcome','cooldown');
    end if;

    select m.user_id, m.discord_ids into v_owner, v_ids from public.uw_discord_verify_match(v_vrc) m limit 1;
    if v_owner is not null and v_discord = any(coalesce(v_ids, '{}')) and uw_discord.eligible(v_owner) then
      insert into public.discord_verify_requests (discord_user_id, discord_username, vrc_user_id, vrc_url, underweb_user_id, outcome, reason, decided_at)
        values (v_discord, left(p_payload->>'discordName', 64), v_vrc, 'https://vrchat.com/home/user/' || v_vrc, v_owner, 'auto_verified',
                'VRChat verified on underweb.cloud and linked to this Discord', now())
        returning id into v_id;
      insert into uw_discord.grants (discord_user_id, kind, underweb_user_id, request_id) values (v_discord, 'auto', v_owner, v_id);
      perform uw_discord.enqueue(v_discord);
      perform uw_discord.audit('verify.auto', v_owner, null, v_discord, jsonb_build_object('request_id', v_id));
      return jsonb_build_object('outcome','verified','applyEnabled',v_apply);
    end if;

    v_mine := public.uw_discord_account_of(v_discord);
    if v_owner is not null and coalesce(array_length(v_ids, 1), 0) = 0 then
      v_reason := 'This VRChat account is verified on underweb.cloud, but that account has no Discord linked'; v_kind := 'link_discord';
    elsif v_owner is not null and not (v_discord = any(v_ids)) then
      v_reason := '⚠️ This VRChat account is verified on underweb.cloud by a DIFFERENT Discord account'; v_kind := 'other_discord';
    elsif v_owner is not null then
      v_reason := 'This UnderWeb account is restricted'; v_kind := 'restricted';
    elsif v_mine is not null then
      v_reason := 'Has an UnderWeb account, but this VRChat account isn''t verified on it yet'; v_kind := 'verify_vrchat';
    else
      v_reason := 'Not on underweb.cloud'; v_kind := 'join_site';
    end if;
    insert into public.discord_verify_requests (discord_user_id, discord_username, vrc_user_id, vrc_url, underweb_user_id, outcome, reason)
      values (v_discord, left(p_payload->>'discordName', 64), v_vrc, 'https://vrchat.com/home/user/' || v_vrc, v_mine, 'pending', v_reason)
      returning id into v_id;
    return jsonb_build_object('outcome','pending','requestId',v_id,'reason',v_reason,'tip',v_kind,'flagged',v_kind in ('other_discord','restricted'));

  elsif p_action = 'verify_posted' then
    update public.discord_verify_requests set staff_message_id = left(p_payload->>'messageId', 25)
     where id = (p_payload->>'requestId')::uuid and outcome = 'pending';
    return '{}';

  elsif p_action = 'verify_cancel' then
    delete from public.discord_verify_requests where id = (p_payload->>'requestId')::uuid and outcome = 'pending' and staff_message_id is null;
    return '{}';

  elsif p_action = 'verify_decide' then
    if (p_payload->>'staffDiscordId') !~ '^[0-9]{17,20}$' then raise exception 'INVALID_REQUEST'; end if;
    update public.discord_verify_requests
       set outcome = case when (p_payload->>'approve')::boolean then 'approved' else 'denied' end,
           decided_by_discord_id = p_payload->>'staffDiscordId', decided_at = now()
     where id = (p_payload->>'requestId')::uuid and outcome = 'pending'
     returning * into v_req;
    if v_req.id is null then
      select * into v_req from public.discord_verify_requests where id = (p_payload->>'requestId')::uuid;
      return jsonb_build_object('outcome', coalesce('already_' || v_req.outcome, 'missing'));
    end if;
    if v_req.outcome = 'approved' then
      update uw_discord.grants set revoked_at = now(), revoke_reason = 'replaced' where discord_user_id = v_req.discord_user_id and revoked_at is null;
      insert into uw_discord.grants (discord_user_id, kind, request_id, granted_by_discord_id)
        values (v_req.discord_user_id, 'staff', v_req.id, p_payload->>'staffDiscordId');
      perform uw_discord.enqueue(v_req.discord_user_id);
    end if;
    perform uw_discord.audit('verify.' || v_req.outcome, null, null, v_req.discord_user_id,
      jsonb_build_object('request_id', v_req.id, 'staff_discord_id', p_payload->>'staffDiscordId'));
    return jsonb_build_object('outcome', v_req.outcome, 'discordUserId', v_req.discord_user_id, 'applyEnabled', v_apply);
  end if;
  raise exception 'INVALID_REQUEST';
end;
$$;
revoke all on function public.uw_bot_verify(text, jsonb) from public, anon, authenticated;
grant execute on function public.uw_bot_verify(text, jsonb) to service_role;
revoke all on function uw_discord.grant_ok(text), uw_discord.worker_ok(text, text) from public, anon, authenticated;

-- Staff Tools → Owner card.
create or replace function public.uw_discord_verify_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.uw_max_role_rank(), 0) < 90 then raise exception 'not_allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'enabled', (select enabled from uw_discord.config where singleton),
    'apply_enabled', (select apply_enabled from uw_discord.config where singleton),
    'waiting', (select count(*) from public.discord_verify_requests where outcome = 'pending'),
    'week', (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (
              select outcome, count(*) n from public.discord_verify_requests where created_at > now() - interval '7 days' group by 1) t),
    'would_lose_role', (select count(*) from uw_discord.sync_jobs j where j.last_outcome = 'dry_run'
                          and not coalesce((uw_discord.job_snapshot(j.discord_user_id)->>'desiredVerified')::boolean, false)),
    'protected', (select count(*) from uw_discord.grants where kind = 'grandfathered' and revoked_at is null));
end;
$$;
revoke all on function public.uw_discord_verify_status() from public, anon;
grant execute on function public.uw_discord_verify_status() to authenticated;

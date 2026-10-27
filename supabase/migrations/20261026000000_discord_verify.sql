-- Discord join verification.
-- New members press "Verify" in #verify and paste their VRChat profile link. The discord-verify edge function:
--   * lets them in automatically when that VRChat account is verified on underweb.cloud AND the UnderWeb account
--     it belongs to is linked to the same Discord account (so nobody can get in with someone else's link);
--   * otherwise sends the request to staff in Discord with Approve / Deny buttons.
-- Only the edge function (service role) writes here; leadership can read it on the website.

create table if not exists public.discord_verify_requests (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{5,25}$'),
  discord_username text check (char_length(discord_username) <= 64),
  vrc_user_id text check (vrc_user_id is null or vrc_user_id ~ '^usr_[0-9a-f-]{36}$'),
  vrc_url text check (char_length(vrc_url) <= 200),
  underweb_user_id uuid references auth.users(id) on delete set null,
  outcome text not null check (outcome in ('auto_verified','pending','approved','denied')),
  reason text not null default '' check (char_length(reason) <= 300),
  staff_message_id text,
  decided_by_discord_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists discord_verify_requests_user on public.discord_verify_requests (discord_user_id, created_at desc);
create unique index if not exists discord_verify_one_pending on public.discord_verify_requests (discord_user_id) where outcome = 'pending';

alter table public.discord_verify_requests enable row level security;
drop policy if exists discord_verify_read on public.discord_verify_requests;
create policy discord_verify_read on public.discord_verify_requests for select to authenticated
  using (coalesce(public.uw_max_role_rank(), 0) >= 80);
revoke insert, update, delete on public.discord_verify_requests from anon, authenticated;

-- Who owns this VRChat account on UnderWeb, and which Discord accounts are linked to them. Service role only.
create or replace function public.uw_discord_verify_match(p_vrc_user_id text)
returns table (user_id uuid, discord_ids text[])
language sql stable security definer set search_path = public, auth as $$
  select c.user_id,
         array_remove(array(
           select distinct x from (
             select p.discord_user_id as x from public.profiles p where p.id = c.user_id
             union all
             select i.provider_id from auth.identities i where i.user_id = c.user_id and i.provider = 'discord'
           ) s where x is not null
         ), null)
    from public.network_connections c
   where c.provider = 'vrchat' and c.verification_status = 'verified' and lower(c.external_id) = lower(p_vrc_user_id)
$$;
revoke all on function public.uw_discord_verify_match(text) from public, anon, authenticated;
grant execute on function public.uw_discord_verify_match(text) to service_role;

-- Is this Discord account linked to any UnderWeb account? (for a better message when the VRChat link isn't theirs)
create or replace function public.uw_discord_account_of(p_discord_id text)
returns uuid
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select p.id from public.profiles p where p.discord_user_id = p_discord_id limit 1),
    (select i.user_id from auth.identities i where i.provider = 'discord' and i.provider_id = p_discord_id limit 1))
$$;
revoke all on function public.uw_discord_account_of(text) from public, anon, authenticated;
grant execute on function public.uw_discord_account_of(text) to service_role;

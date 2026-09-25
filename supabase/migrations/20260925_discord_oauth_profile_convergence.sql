-- REVIEW ONLY: UnderWeb Discord OAuth/profile link convergence.
-- This file is a workspace migration for review; do not apply it to production
-- without the normal migration review and deployment process.
--
-- The browser never supplies a Discord ID. Linking reads the authenticated
-- user's Discord identity from Supabase Auth; unlinking only clears that user's
-- profile link after the Discord identity has been removed.

-- Permit profile link changes only from the trusted link RPCs (or the bot's
-- service-role path). Comparing current_user with the SECURITY DEFINER owners
-- lets these functions pass the trigger while authenticated browser updates
-- remain denied. The functions and trigger must be owned by a trusted DB role.
create or replace function public.uw_guard_discord_link_column()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trusted_owner boolean;
begin
  select exists (
    select 1
      from pg_catalog.pg_proc as proc
     where proc.oid in (
       pg_catalog.to_regprocedure('public.redeem_discord_link_token(text)'),
       pg_catalog.to_regprocedure('public.uw_sync_my_discord_link()'),
       pg_catalog.to_regprocedure('public.uw_revoke_my_discord_link()')
     )
       and pg_catalog.pg_get_userbyid(proc.proowner) = current_user
  ) into v_trusted_owner;

  if old.discord_user_id is distinct from new.discord_user_id
     and auth.role() is distinct from 'service_role'
     and not v_trusted_owner then
    raise exception 'Discord links must be changed through the verified link flow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.uw_guard_discord_link_column()
  from public, anon, authenticated;
drop trigger if exists uw_guard_discord_link_column on public.profiles;
create trigger uw_guard_discord_link_column
  before update of discord_user_id on public.profiles
  for each row execute function public.uw_guard_discord_link_column();

-- Sync only the caller's Discord OAuth identity. No user or Discord ID is
-- accepted from the client, and an existing conflicting profile link fails
-- closed rather than being overwritten.
create or replace function public.uw_sync_my_discord_link()
returns table (linked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_discord_id text;
  v_identity_count bigint;
  v_distinct_identity_count bigint;
  v_profile_discord_id text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select count(*), count(distinct i.provider_id), min(i.provider_id)
    into v_identity_count, v_distinct_identity_count, v_discord_id
    from auth.identities as i
   where i.user_id = v_user_id
     and i.provider = 'discord';

  if v_identity_count <> 1 or v_distinct_identity_count <> 1
     or v_discord_id !~ '^[0-9]{17,20}$' then
    raise exception 'verified_discord_identity_not_found_or_ambiguous'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from auth.identities as i
     where i.provider = 'discord'
       and i.provider_id = v_discord_id
       and i.user_id <> v_user_id
  ) then
    raise exception 'discord_oauth_identity_owned_by_other_user'
      using errcode = 'P0001';
  end if;

  select p.discord_user_id
    into v_profile_discord_id
    from public.profiles as p
   where p.id = v_user_id
   for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;
  if v_profile_discord_id is not null
     and v_profile_discord_id <> v_discord_id then
    raise exception 'profile_discord_link_conflict' using errcode = 'P0001';
  end if;

  update public.profiles as p
     set discord_user_id = v_discord_id
   where p.id = v_user_id
     and (p.discord_user_id is null or p.discord_user_id = v_discord_id);

  if not found then
    raise exception 'profile_discord_link_conflict' using errcode = 'P0001';
  end if;
  return query select true;
exception
  when unique_violation then
    raise exception 'discord_already_linked' using errcode = 'P0001';
end;
$$;

revoke all on function public.uw_sync_my_discord_link() from public, anon;
revoke all on function public.uw_sync_my_discord_link() from authenticated;
grant execute on function public.uw_sync_my_discord_link() to authenticated;

-- A caller can revoke only their own profile link, and only after their
-- Discord OAuth identity is absent from auth.identities. If it still exists,
-- fail closed and leave the profile unchanged.
create or replace function public.uw_revoke_my_discord_link()
returns table (revoked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_rows integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if exists (
    select 1 from auth.identities as i
     where i.user_id = v_user_id
       and i.provider = 'discord'
  ) then
    raise exception 'remove_discord_oauth_identity_first'
      using errcode = 'P0001';
  end if;

  update public.profiles as p
     set discord_user_id = null
   where p.id = v_user_id
     and p.discord_user_id is not null
     and not exists (
       select 1 from auth.identities as i
        where i.user_id = v_user_id
          and i.provider = 'discord'
     );
  get diagnostics v_rows = row_count;
  return query select v_rows = 1;
end;
$$;

revoke all on function public.uw_revoke_my_discord_link() from public, anon;
revoke all on function public.uw_revoke_my_discord_link() from authenticated;
grant execute on function public.uw_revoke_my_discord_link() to authenticated;

-- Keep the deployed website token redemption flow from splitting one Discord
-- OAuth identity across website users, or linking a user's existing OAuth
-- identity to a different Discord account.
create or replace function public.redeem_discord_link_token(p_token_hash text)
returns table (linked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_token public.discord_link_tokens%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  select *
    into v_token
    from public.discord_link_tokens
   where token_hash = p_token_hash
   for update;
  if not found or v_token.used_at is not null or v_token.expires_at <= now() then
    raise exception 'expired_or_used_token' using errcode = 'P0001';
  end if;

  select p.id into v_profile_id
    from public.profiles as p
   where p.id = auth.uid()
   for update;
  if v_profile_id is null then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  -- Even when no profile has yet been synced, Auth is authoritative for
  -- ownership. Reject the same provider ID on another Auth user and reject a
  -- token that disagrees with this caller's already-linked Discord identity.
  if exists (
    select 1
      from auth.identities as i
     where i.provider = 'discord'
       and i.provider_id = v_token.discord_user_id
       and i.user_id <> auth.uid()
  ) then
    raise exception 'discord_oauth_identity_owned_by_other_user'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from auth.identities as i
     where i.provider = 'discord'
       and i.user_id = auth.uid()
       and i.provider_id <> v_token.discord_user_id
  ) then
    raise exception 'discord_oauth_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.profiles as other_profile
     where other_profile.discord_user_id = v_token.discord_user_id
       and other_profile.id <> v_profile_id
  ) then
    raise exception 'discord_already_linked' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.profiles as current_profile
     where current_profile.id = v_profile_id
       and current_profile.discord_user_id is not null
       and current_profile.discord_user_id <> v_token.discord_user_id
  ) then
    raise exception 'profile_already_linked' using errcode = 'P0001';
  end if;

  update public.profiles
     set discord_user_id = v_token.discord_user_id
   where id = v_profile_id;
  update public.discord_link_tokens
     set used_at = now(),
         redeemed_profile_id = v_profile_id
   where id = v_token.id;
  return query select true;
exception
  when unique_violation then
    raise exception 'discord_already_linked' using errcode = 'P0001';
end;
$$;

revoke all on function public.redeem_discord_link_token(text)
  from public, anon, authenticated;
grant execute on function public.redeem_discord_link_token(text) to authenticated;
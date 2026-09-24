-- UnderWeb website integration for Discord account linking.
--
-- Apply after:
--   supabase/migrations/20260923_milestone2_discord_link_tokens.sql
--
-- This function derives the website user from auth.uid(). It does not accept
-- a user ID, profile ID, email, or Discord ID from the browser.

create or replace function public.redeem_discord_link_token(
  p_token_hash text
)
returns table (
  linked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_token public.discord_link_tokens%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated'
      using errcode = 'P0001';
  end if;

  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'invalid_token'
      using errcode = 'P0001';
  end if;

  select *
    into v_token
    from public.discord_link_tokens
   where token_hash = p_token_hash
   for update;

  if not found
     or v_token.used_at is not null
     or v_token.expires_at <= now() then
    raise exception 'expired_or_used_token'
      using errcode = 'P0001';
  end if;

  -- UnderWeb's current profile model uses profiles.id as the authenticated
  -- Supabase user's UUID. If the website uses another existing profile lookup,
  -- replace only this lookup with that established relationship.
  select p.id
    into v_profile_id
    from public.profiles as p
   where p.id = auth.uid();

  if v_profile_id is null then
    raise exception 'profile_not_found'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.profiles as other_profile
     where other_profile.discord_user_id = v_token.discord_user_id
       and other_profile.id <> v_profile_id
  ) then
    raise exception 'discord_already_linked'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.profiles as current_profile
     where current_profile.id = v_profile_id
       and current_profile.discord_user_id is not null
       and current_profile.discord_user_id <> v_token.discord_user_id
  ) then
    raise exception 'profile_already_linked'
      using errcode = 'P0001';
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
    -- Covers a concurrent link attempt protected by the partial unique index.
    raise exception 'discord_already_linked'
      using errcode = 'P0001';
end;
$$;

revoke all on function public.redeem_discord_link_token(text) from public;
grant execute on function public.redeem_discord_link_token(text) to authenticated;
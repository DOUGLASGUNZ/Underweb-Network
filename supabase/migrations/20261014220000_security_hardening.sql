-- UnderWeb security hardening (2026-10-14)
-- Fixes the Supabase security advisor findings without changing what members
-- can see or do in the site or in UWX.

-- 1. network_partners_public ran with the view owner's rights (security definer).
--    Run it with the caller's rights; network_partners' own RLS already lets
--    anyone read active partners, so results are unchanged.
alter view public.network_partners_public set (security_invoker = true);

-- 2. set_updated_at had a role-mutable search_path.
alter function public.set_updated_at() set search_path = pg_catalog, public;

-- 3. Security-definer functions were callable by logged-out visitors (anon)
--    through /rest/v1/rpc/*, including owner/staff tools. Revoke anon access
--    from all of them except the ones the public site really uses logged out
--    (checked against the live index.html / spider-collection.js on 2026-10-15):
--      uw_can_manage_partners           - called by public partner RLS policies
--      uw_network_pulse_v2              - home page "Radar" activity feed
--      uw_profile_milestones,
--      uw_profile_network_activity,
--      uw_profile_partner_affiliations  - public profile popup sections
--      uw_public_spiders                - public spider collection on profiles
--    Signed-in members keep their access; trigger functions lose direct
--    RPC access entirely (triggers still fire — EXECUTE is not checked then).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
  loop
    if f.proname not in (
      'uw_can_manage_partners',
      'uw_network_pulse_v2',
      'uw_profile_milestones',
      'uw_profile_network_activity',
      'uw_profile_partner_affiliations',
      'uw_public_spiders'
    ) then
      execute format('revoke execute on function %s from public, anon', f.sig);
    end if;
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

-- 4. "Creator profiles are publicly readable" used `true`, so profiles a
--    creator had hidden (public_visible = false) were still readable by
--    anyone. Keep visible profiles public (the directory is unchanged), and
--    let only the owner (existing policy) and UnderWeb staff see hidden ones.
drop policy if exists "Creator profiles are publicly readable" on public.creator_profiles;

create policy "Visible creator profiles are public"
  on public.creator_profiles for select to anon
  using (public_visible = true);

create policy "Visible creator profiles, or staff"
  on public.creator_profiles for select to authenticated
  using (public_visible = true or public.is_underweb_staff(auth.uid()));

-- 5. Bans and suspensions were only shown as a warning; the server still granted
--    network access. uw_has_network_access() gates ~18 RLS policies, so making it
--    return false for an active ban or suspension blocks protected data and
--    actions server-side. Owners are never locked out (recovery).
create or replace function public.uw_has_network_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and lower(btrim(ur.status)) = 'active'
              and lower(btrim(ur.role_slug)) = 'owner'
        )
        or (
            not exists (
                select 1 from public.user_restrictions r
                where r.user_id = auth.uid()
                  and r.active
                  and lower(r.restriction_type) in ('ban', 'suspend')
                  and (r.expires_at is null or r.expires_at > now())
            )
            and (
                exists (
                    select 1 from public.user_roles ur
                    where ur.user_id = auth.uid()
                      and lower(btrim(ur.status)) = 'active'
                      and lower(btrim(ur.role_slug)) = 'director'
                )
                or exists (
                    select 1 from public.network_connections nc
                    where nc.user_id = auth.uid()
                      and lower(btrim(nc.provider)) = 'vrchat'
                      and lower(btrim(nc.verification_status)) = 'verified'
                )
            )
        ),
        false
    );
$$;
revoke execute on function public.uw_has_network_access() from public, anon;
grant execute on function public.uw_has_network_access() to authenticated;

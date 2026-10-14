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
--    through /rest/v1/rpc/*. Nothing logged-out needs them, except
--    uw_can_manage_partners, which public RLS policies call.
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
    if f.proname <> 'uw_can_manage_partners' then
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

-- Only moderation leadership can read and publish private Safety Intel cases.
-- Kept in an unexposed schema so the privileged membership lookup is not an RPC.
create schema if not exists uwx_private;
revoke all on schema uwx_private from public, anon;
grant usage on schema uwx_private to authenticated;

create or replace function uwx_private.is_safety_reviewer()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
      join public.groups g on g.id = m.group_id
     where m.user_id = (select auth.uid())
       and m.status::text = 'approved'
       and g.slug = 'underweb'
       and r.name in ('Owner', 'Director', 'Moderator', 'Security', 'Admin')
  );
$$;
revoke all on function uwx_private.is_safety_reviewer() from public, anon, authenticated;
grant execute on function uwx_private.is_safety_reviewer() to authenticated;

create or replace function public.uwx_can_review_safety()
returns boolean
language sql stable security invoker
set search_path = ''
as $$ select uwx_private.is_safety_reviewer(); $$;
revoke all on function public.uwx_can_review_safety() from public, anon, authenticated;
grant execute on function public.uwx_can_review_safety() to authenticated;

drop policy if exists "uwx safety reporters see own" on public.uwx_safety_reports;
create policy "uwx safety reporters see own"
  on public.uwx_safety_reports for select to authenticated
  using (
    reporter_user_id = (select auth.uid())
    or (select public.uwx_can_review_safety())
  );
drop policy if exists "uwx safety staff update reports" on public.uwx_safety_reports;
drop policy if exists "uwx safety reviewers update reports" on public.uwx_safety_reports;
create policy "uwx safety reviewers update reports"
  on public.uwx_safety_reports for update to authenticated
  using ((select public.uwx_can_review_safety()))
  with check ((select public.uwx_can_review_safety()));

drop policy if exists "uwx safety evidence private read" on public.uwx_safety_evidence;
create policy "uwx safety evidence private read"
  on public.uwx_safety_evidence for select to authenticated
  using (exists (
    select 1 from public.uwx_safety_reports r
     where r.id = report_id
       and (
         r.reporter_user_id = (select auth.uid())
         or (select public.uwx_can_review_safety())
       )
  ));
drop policy if exists "uwx safety evidence submitter insert" on public.uwx_safety_evidence;
create policy "uwx safety evidence submitter insert"
  on public.uwx_safety_evidence for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and exists (
      select 1 from public.uwx_safety_reports r
       where r.id = report_id
         and (
           r.reporter_user_id = (select auth.uid())
           or (select public.uwx_can_review_safety())
         )
         and r.status in ('pending', 'reviewing')
    )
  );

drop policy if exists "uwx safety reviews staff insert" on public.uwx_safety_reviews;
drop policy if exists "uwx safety reviews reviewer insert" on public.uwx_safety_reviews;
create policy "uwx safety reviews reviewer insert"
  on public.uwx_safety_reviews for insert to authenticated
  with check (
    (select public.uwx_can_review_safety())
    and reviewer_user_id = (select auth.uid())
  );
drop policy if exists "uwx safety reviews staff read" on public.uwx_safety_reviews;
drop policy if exists "uwx safety reviews reviewer read" on public.uwx_safety_reviews;
create policy "uwx safety reviews reviewer read"
  on public.uwx_safety_reviews for select to authenticated
  using ((select public.uwx_can_review_safety()));

drop policy if exists "uwx safety summaries visible" on public.uwx_safety_subjects;
drop policy if exists "uwx safety summaries public" on public.uwx_safety_subjects;
drop policy if exists "uwx safety summaries reviewer read" on public.uwx_safety_subjects;
create policy "uwx safety summaries public"
  on public.uwx_safety_subjects for select to anon
  using (active = true and (expires_at is null or expires_at > now()));
create policy "uwx safety summaries reviewer read"
  on public.uwx_safety_subjects for select to authenticated
  using (
    (active = true and (expires_at is null or expires_at > now()))
    or (select public.uwx_can_review_safety())
  );
drop policy if exists "uwx safety summaries staff insert" on public.uwx_safety_subjects;
drop policy if exists "uwx safety summaries reviewer insert" on public.uwx_safety_subjects;
create policy "uwx safety summaries reviewer insert"
  on public.uwx_safety_subjects for insert to authenticated
  with check ((select public.uwx_can_review_safety()));
drop policy if exists "uwx safety summaries staff update" on public.uwx_safety_subjects;
drop policy if exists "uwx safety summaries reviewer update" on public.uwx_safety_subjects;
create policy "uwx safety summaries reviewer update"
  on public.uwx_safety_subjects for update to authenticated
  using ((select public.uwx_can_review_safety()))
  with check ((select public.uwx_can_review_safety()));
drop policy if exists "uwx safety summaries staff delete" on public.uwx_safety_subjects;
drop policy if exists "uwx safety summaries reviewer delete" on public.uwx_safety_subjects;
create policy "uwx safety summaries reviewer delete"
  on public.uwx_safety_subjects for delete to authenticated
  using ((select public.uwx_can_review_safety()));

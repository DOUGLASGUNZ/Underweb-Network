-- Reports are anonymous intake. UWX never connects to UnderWeb Auth, and
-- neither client sends or stores a reporter account identifier or IP address.
drop policy if exists "uwx safety reporters see own" on public.uwx_safety_reports;
drop policy if exists "uwx safety reporters submit" on public.uwx_safety_reports;
drop policy if exists "uwx safety evidence private read" on public.uwx_safety_evidence;
drop policy if exists "uwx safety evidence submitter insert" on public.uwx_safety_evidence;

alter table public.uwx_safety_reports
  drop column if exists reporter_user_id,
  add column if not exists source text not null default 'website'
    check (source in ('website', 'uwx')),
  add column if not exists private_evidence_url text
    check (private_evidence_url is null or private_evidence_url ~* '^https?://[^[:space:]]+$');

alter table public.uwx_safety_evidence
  drop column if exists submitted_by;

drop policy if exists "uwx safety private reviewer read" on public.uwx_safety_reports;
create policy "uwx safety private reviewer read"
  on public.uwx_safety_reports for select to authenticated
  using ((select public.uwx_can_review_safety()));

drop policy if exists "uwx safety anonymous submit" on public.uwx_safety_reports;
create policy "uwx safety anonymous submit"
  on public.uwx_safety_reports for insert to anon, authenticated
  with check (
    status = 'pending' and reviewer_user_id is null
    and reviewed_at is null and reviewed_risk_level is null
    and review_note is null and public_summary is null and expires_at is null
  );

drop policy if exists "uwx safety evidence reviewer read" on public.uwx_safety_evidence;
create policy "uwx safety evidence reviewer read"
  on public.uwx_safety_evidence for select to authenticated
  using ((select public.uwx_can_review_safety()));

grant insert on public.uwx_safety_reports to anon;
revoke insert on public.uwx_safety_evidence from authenticated;

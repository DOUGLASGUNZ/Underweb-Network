-- Review decisions and public Safety Intel summaries are written together.
-- Reports and evidence remain private under the existing RLS policies.
alter table public.uwx_safety_reports
  add column if not exists reviewed_risk_level text
  check (reviewed_risk_level in ('info', 'caution', 'high'));

alter table public.uwx_safety_subjects
  add column if not exists expires_at timestamptz;

-- These existing SECURITY DEFINER functions are trigger internals; callers
-- must not be able to invoke them directly through the Data API.
revoke execute on function public.uwx_refresh_safety_subject(text)
  from public, anon, authenticated;
revoke execute on function public.uwx_safety_report_changed()
  from public, anon, authenticated;

drop policy if exists "uwx safety summaries visible" on public.uwx_safety_subjects;
create policy "uwx safety summaries visible"
  on public.uwx_safety_subjects for select to anon, authenticated
  using (
    (active = true and (expires_at is null or expires_at > now()))
    or (select public.uwx_is_underweb_staff())
  );

create or replace function public.uwx_review_safety_report(
  p_report_id uuid,
  p_decision text,
  p_review_note text default null,
  p_public_summary text default null,
  p_risk_level text default null,
  p_expires_at timestamptz default null
)
returns table (report_id uuid, report_status text, public_record_active boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_report public.uwx_safety_reports%rowtype;
  v_count integer;
  v_flags text[];
  v_latest timestamptz;
  v_expiry timestamptz;
  v_top public.uwx_safety_reports%rowtype;
begin
  if v_actor is null or not (select public.uwx_is_underweb_staff()) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('reviewing', 'verified', 'rejected', 'expired') then
    raise exception 'Invalid review decision' using errcode = '22023';
  end if;
  if p_decision = 'verified' and (
    p_risk_level is null or p_risk_level not in ('info', 'caution', 'high')
    or char_length(trim(coalesce(p_public_summary, ''))) not between 20 and 500
    or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now() + interval '1 year'
  ) then
    raise exception 'Verification needs a risk level, a 20–500 character public summary, and an expiry within one year'
      using errcode = '22023';
  end if;
  if p_decision in ('rejected', 'expired')
     and char_length(trim(coalesce(p_review_note, ''))) < 10 then
    raise exception 'Add an internal reason for rejection or expiry'
      using errcode = '22023';
  end if;

  select * into v_report
    from public.uwx_safety_reports
   where id = p_report_id
   for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  -- Serialize concurrent reviews for the same VRChat ID before rebuilding
  -- its public summary.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_report.vrchat_user_id, 82911)
  );

  update public.uwx_safety_reports
     set status = p_decision,
         reviewer_user_id = v_actor,
         review_note = nullif(trim(p_review_note), ''),
         public_summary = case when p_decision = 'verified'
            then trim(p_public_summary) else null end,
         reviewed_risk_level = case when p_decision = 'verified'
            then p_risk_level else null end,
         reviewed_at = case when p_decision = 'reviewing'
            then reviewed_at else now() end,
         expires_at = case when p_decision = 'verified'
            then p_expires_at else null end,
         updated_at = now()
   where id = p_report_id;

  insert into public.uwx_safety_reviews
    (report_id, reviewer_user_id, previous_status, decision, note)
  values
    (p_report_id, v_actor, v_report.status, p_decision, nullif(trim(p_review_note), ''));

  select count(*)::integer, coalesce(array_agg(distinct category), '{}'::text[]),
         max(reviewed_at), min(expires_at)
    into v_count, v_flags, v_latest, v_expiry
    from public.uwx_safety_reports
   where vrchat_user_id = v_report.vrchat_user_id
     and status = 'verified'
     and (expires_at is null or expires_at > now());

  if v_count = 0 then
    delete from public.uwx_safety_subjects
     where vrchat_user_id = v_report.vrchat_user_id;
  else
    select * into v_top
      from public.uwx_safety_reports
     where vrchat_user_id = v_report.vrchat_user_id
       and status = 'verified'
       and (expires_at is null or expires_at > now())
     order by case reviewed_risk_level
       when 'high' then 3 when 'caution' then 2 else 1 end desc,
       reviewed_at desc
     limit 1;

    insert into public.uwx_safety_subjects
      (vrchat_user_id, last_known_display_name, risk_level,
       verified_flags, verified_report_count, public_summary,
       latest_verified_at, last_reviewed_at, expires_at, active, updated_at)
    values
      (v_report.vrchat_user_id, v_top.last_known_display_name,
       coalesce(v_top.reviewed_risk_level, 'info'), v_flags, v_count,
       v_top.public_summary, v_latest, now(), v_expiry, true, now())
    on conflict (vrchat_user_id) do update
      set last_known_display_name = excluded.last_known_display_name,
          risk_level = excluded.risk_level,
          verified_flags = excluded.verified_flags,
          verified_report_count = excluded.verified_report_count,
          public_summary = excluded.public_summary,
          latest_verified_at = excluded.latest_verified_at,
          last_reviewed_at = excluded.last_reviewed_at,
          expires_at = excluded.expires_at,
          active = true,
          updated_at = now();
  end if;

  return query select p_report_id, p_decision, (v_count > 0);
end;
$$;

revoke all on function public.uwx_review_safety_report(
  uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.uwx_review_safety_report(
  uuid, text, text, text, text, timestamptz
) to authenticated;

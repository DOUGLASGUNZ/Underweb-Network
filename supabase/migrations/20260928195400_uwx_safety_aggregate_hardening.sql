-- Keep the public projection aligned with reviewed risk when any private
-- report changes, and expose only the table privileges required by the app.
alter table public.uwx_safety_reports
  add constraint uwx_safety_verified_public_fields check (
    status <> 'verified' or (
      reviewed_risk_level in ('info', 'caution', 'high')
      and char_length(trim(public_summary)) between 20 and 500
      and expires_at is not null
    )
  );

create or replace function public.uwx_refresh_safety_subject(p_vrchat_user_id text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
  v_flags text[];
  v_latest timestamptz;
  v_expiry timestamptz;
  v_top public.uwx_safety_reports%rowtype;
begin
  select count(*)::integer, coalesce(array_agg(distinct category), '{}'::text[]),
         max(reviewed_at), min(expires_at)
    into v_count, v_flags, v_latest, v_expiry
    from public.uwx_safety_reports
   where vrchat_user_id = p_vrchat_user_id
     and status = 'verified' and expires_at > now();

  if v_count = 0 then
    delete from public.uwx_safety_subjects
     where vrchat_user_id = p_vrchat_user_id;
    return;
  end if;

  select * into v_top
    from public.uwx_safety_reports
   where vrchat_user_id = p_vrchat_user_id
     and status = 'verified' and expires_at > now()
   order by case reviewed_risk_level
       when 'high' then 3 when 'caution' then 2 else 1 end desc,
     reviewed_at desc
   limit 1;

  insert into public.uwx_safety_subjects
    (vrchat_user_id, last_known_display_name, risk_level,
     verified_flags, verified_report_count, public_summary,
     latest_verified_at, last_reviewed_at, expires_at, active, updated_at)
  values
    (p_vrchat_user_id, v_top.last_known_display_name, v_top.reviewed_risk_level,
     v_flags, v_count, v_top.public_summary,
     v_latest, now(), v_expiry, true, now())
  on conflict (vrchat_user_id) do update set
    last_known_display_name = excluded.last_known_display_name,
    risk_level = excluded.risk_level,
    verified_flags = excluded.verified_flags,
    verified_report_count = excluded.verified_report_count,
    public_summary = excluded.public_summary,
    latest_verified_at = excluded.latest_verified_at,
    last_reviewed_at = excluded.last_reviewed_at,
    expires_at = excluded.expires_at,
    active = true,
    updated_at = now();
end;
$$;

create or replace function public.uwx_safety_report_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.uwx_refresh_safety_subject(coalesce(new.vrchat_user_id, old.vrchat_user_id));
  if tg_op = 'UPDATE' and old.vrchat_user_id is distinct from new.vrchat_user_id then
    perform public.uwx_refresh_safety_subject(old.vrchat_user_id);
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.uwx_refresh_safety_subject(text)
  from public, anon, authenticated;
revoke execute on function public.uwx_safety_report_changed()
  from public, anon, authenticated;

revoke all on table public.uwx_safety_reports, public.uwx_safety_evidence,
  public.uwx_safety_reviews, public.uwx_safety_subjects
  from public, anon, authenticated;
grant select, insert, update on public.uwx_safety_reports to authenticated;
grant select, insert on public.uwx_safety_evidence to authenticated;
grant select, insert on public.uwx_safety_reviews to authenticated;
grant select on public.uwx_safety_subjects to anon, authenticated;
grant insert, update, delete on public.uwx_safety_subjects to authenticated;

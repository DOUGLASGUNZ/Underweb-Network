-- Base private intake and reviewed public summary schema shared by UnderWeb and UWX.
-- The later reviewer-scope migration replaces these initial staff policies.
create table if not exists public.uwx_safety_reports (
  id uuid primary key default gen_random_uuid(),
  vrchat_user_id text not null check (vrchat_user_id ~ '^usr_[A-Za-z0-9-]{8,}$'),
  last_known_display_name text,
  category text not null check (category in (
    'crashing', 'doxxing_privacy_threat', 'harassment', 'scam_impersonation',
    'malicious_client_behavior', 'ban_evasion', 'other')),
  suggested_severity text not null default 'caution'
    check (suggested_severity in ('info', 'caution', 'high')),
  incident_at timestamptz,
  incident_world text,
  summary text not null check (char_length(summary) between 10 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'reviewing', 'verified', 'rejected', 'expired')),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  review_note text,
  public_summary text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists uwx_safety_reports_subject_idx on public.uwx_safety_reports(vrchat_user_id);
create index if not exists uwx_safety_reports_reporter_idx on public.uwx_safety_reports(reporter_user_id);
create index if not exists uwx_safety_reports_status_idx on public.uwx_safety_reports(status);
create index if not exists uwx_safety_reports_reviewed_idx on public.uwx_safety_reports(reviewed_at desc);

create table if not exists public.uwx_safety_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.uwx_safety_reports(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  evidence_type text not null check (evidence_type in
    ('screenshot', 'video', 'log', 'vrchat_report_reference', 'other')),
  url text,
  description text check (description is null or char_length(description) <= 1200),
  created_at timestamptz not null default now(),
  check (url is not null or description is not null)
);
create index if not exists uwx_safety_evidence_report_idx on public.uwx_safety_evidence(report_id);

create table if not exists public.uwx_safety_reviews (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.uwx_safety_reports(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  previous_status text,
  decision text not null check (decision in ('reviewing', 'verified', 'rejected', 'expired')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists uwx_safety_reviews_report_idx on public.uwx_safety_reviews(report_id, created_at desc);

create table if not exists public.uwx_safety_subjects (
  vrchat_user_id text primary key check (vrchat_user_id ~ '^usr_[A-Za-z0-9-]{8,}$'),
  last_known_display_name text,
  risk_level text not null default 'info' check (risk_level in ('info', 'caution', 'high')),
  verified_flags text[] not null default '{}'::text[],
  verified_report_count integer not null default 0 check (verified_report_count >= 0),
  public_summary text,
  latest_verified_at timestamptz,
  last_reviewed_at timestamptz,
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.uwx_safety_reports enable row level security;
alter table public.uwx_safety_evidence enable row level security;
alter table public.uwx_safety_reviews enable row level security;
alter table public.uwx_safety_subjects enable row level security;

create or replace function public.uwx_is_underweb_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
      join public.roles r on r.id = m.role_id
      join public.groups g on g.id = m.group_id
     where m.user_id = (select auth.uid())
       and m.status::text = 'approved' and r.is_staff = true and g.slug = 'underweb'
  );
$$;

-- Rebuilt whenever an intake row changes. A later migration makes this
-- aggregator use reviewer-assigned risk and explicit expiry.
create or replace function public.uwx_refresh_safety_subject(p_vrchat_user_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
  v_flags text[];
  v_risk text;
  v_latest timestamptz;
  v_name text;
  v_summary text;
begin
  select count(*)::integer,
         coalesce(array_agg(distinct category), '{}'::text[]),
         case when bool_or(suggested_severity = 'high') then 'high'
              when bool_or(suggested_severity = 'caution') then 'caution'
              else 'info' end,
         max(reviewed_at),
         (array_agg(last_known_display_name order by reviewed_at desc nulls last)
            filter (where last_known_display_name is not null))[1],
         (array_agg(public_summary order by reviewed_at desc nulls last)
            filter (where public_summary is not null and btrim(public_summary) <> ''))[1]
    into v_count, v_flags, v_risk, v_latest, v_name, v_summary
    from public.uwx_safety_reports
   where vrchat_user_id = p_vrchat_user_id and status = 'verified'
     and (expires_at is null or expires_at > now());
  if v_count = 0 then
    insert into public.uwx_safety_subjects(vrchat_user_id, active, updated_at)
    values (p_vrchat_user_id, false, now())
    on conflict (vrchat_user_id) do update set active = false, updated_at = now();
  else
    insert into public.uwx_safety_subjects
      (vrchat_user_id, last_known_display_name, risk_level, verified_flags,
       verified_report_count, public_summary, latest_verified_at, last_reviewed_at,
       active, updated_at)
    values (p_vrchat_user_id, v_name, v_risk, v_flags, v_count, v_summary,
            v_latest, v_latest, true, now())
    on conflict (vrchat_user_id) do update set
      last_known_display_name = excluded.last_known_display_name,
      risk_level = excluded.risk_level,
      verified_flags = excluded.verified_flags,
      verified_report_count = excluded.verified_report_count,
      public_summary = excluded.public_summary,
      latest_verified_at = excluded.latest_verified_at,
      last_reviewed_at = excluded.last_reviewed_at,
      active = true, updated_at = now();
  end if;
end;
$$;

create or replace function public.uwx_safety_report_changed()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.uwx_refresh_safety_subject(coalesce(new.vrchat_user_id, old.vrchat_user_id));
  if tg_op = 'UPDATE' and old.vrchat_user_id is distinct from new.vrchat_user_id then
    perform public.uwx_refresh_safety_subject(old.vrchat_user_id);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists uwx_safety_report_refresh_subject on public.uwx_safety_reports;
create trigger uwx_safety_report_refresh_subject
  after insert or update or delete on public.uwx_safety_reports
  for each row execute function public.uwx_safety_report_changed();

drop policy if exists "uwx safety reporters submit" on public.uwx_safety_reports;
create policy "uwx safety reporters submit" on public.uwx_safety_reports
  for insert to authenticated with check (
    (select auth.uid()) is not null
    and reporter_user_id = (select auth.uid())
    and status = 'pending' and reviewer_user_id is null and reviewed_at is null
  );

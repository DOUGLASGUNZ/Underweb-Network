-- UWX staff operations: shifts / on duty, help requests, staff stats, flagged-subject alerts,
-- shared Event Mode recaps, partner group applications, per-person access, staff names.
-- Builds on 20261022000000_uwx_group_intelligence.sql (uwx_group_level etc.). Safe to run twice.

-- ───────── names (profiles are private per user; staff need display names of people in their group) ─────────
create or replace function public.uwx_names(p_group uuid, p_ids uuid[])
returns table (user_id uuid, display_name text, username text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.username from public.profiles p
  where public.uwx_group_level(p_group) >= 1 and p.id = any(p_ids[1:500])
$$;

-- ───────── shifts / on duty ─────────
create table if not exists public.uwx_staff_shifts (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text not null default '' check (char_length(note) <= 200),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists uwx_staff_shifts_one_open on public.uwx_staff_shifts (group_id, user_id) where ended_at is null;
create index if not exists uwx_staff_shifts_group on public.uwx_staff_shifts (group_id, started_at desc);

create or replace function public.uwx_shifts_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.started_at := now();
    new.ended_at := null;
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.group_id is distinct from old.group_id or new.started_at is distinct from old.started_at then
    raise exception 'only the end time and note can change' using errcode = '42501';
  end if;
  if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
    raise exception 'shift already ended' using errcode = '42501';
  end if;
  if new.ended_at is not null and old.ended_at is null then new.ended_at := now(); end if;
  return new;
end $$;
drop trigger if exists uwx_shifts_guard on public.uwx_staff_shifts;
create trigger uwx_shifts_guard before insert or update on public.uwx_staff_shifts for each row execute function public.uwx_shifts_guard();

-- Close shifts left open for more than 12 hours (forgot to check out). Called by any staff client.
create or replace function public.uwx_close_stale_shifts(p_group uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.uwx_group_level(p_group) < 1 then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.uwx_staff_shifts set ended_at = started_at + interval '12 hours', note = left(note || ' (auto-closed)', 200)
  where group_id = p_group and ended_at is null and started_at < now() - interval '12 hours';
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────── help requests ("need staff here") ─────────
create table if not exists public.uwx_help_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  requested_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  world_name text check (char_length(world_name) <= 120),
  location text check (char_length(location) <= 300),
  message text not null default '' check (char_length(message) <= 500),
  urgency text not null default 'normal' check (urgency in ('normal','urgent')),
  status text not null default 'open' check (status in ('open','claimed','closed')),
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists uwx_help_requests_group on public.uwx_help_requests (group_id, status, created_at desc);

create or replace function public.uwx_help_update(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.uwx_help_requests;
begin
  select * into r from public.uwx_help_requests where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if public.uwx_group_level(r.group_id) < 1 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_action = 'claim' and r.status = 'open' then
    update public.uwx_help_requests set status = 'claimed', claimed_by = auth.uid(), claimed_at = now() where id = p_id;
  elsif p_action = 'close' and r.status <> 'closed' then
    update public.uwx_help_requests set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = p_id;
  elsif p_action = 'reopen' and r.status = 'closed' then
    update public.uwx_help_requests set status = 'open', closed_by = null, closed_at = null, claimed_by = null, claimed_at = null where id = p_id;
  end if;
end $$;

-- ───────── shared Event Mode recaps ─────────
create table if not exists public.uwx_event_recaps (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  client_event_id text not null check (char_length(client_event_id) between 1 and 80),
  name text not null check (char_length(name) between 1 and 120),
  started_at timestamptz not null,
  ended_at timestamptz,
  peak int not null default 0 check (peak >= 0),
  unique_count int not null default 0 check (unique_count >= 0),
  stayed_five int not null default 0 check (stayed_five >= 0),
  group_invites int not null default 0 check (group_invites >= 0),
  instance_invites int not null default 0 check (instance_invites >= 0),
  staff_present text[] not null default '{}',
  recorded_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, recorded_by, client_event_id)
);
create index if not exists uwx_event_recaps_group on public.uwx_event_recaps (group_id, started_at desc);

-- ───────── partner group applications (Moderation Network onboarding) ─────────
create table if not exists public.uwx_group_applications (
  id uuid primary key default gen_random_uuid(),
  vrchat_group_id text not null check (vrchat_group_id ~ '^grp_[0-9a-f-]{36}$'),
  group_name text not null check (char_length(group_name) between 2 and 80),
  applicant uuid not null default auth.uid() references auth.users(id) on delete cascade,
  applicant_role text not null default '' check (char_length(applicant_role) <= 80),
  member_count int check (member_count is null or member_count >= 0),
  reason text not null default '' check (char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500),
  created_at timestamptz not null default now()
);
create unique index if not exists uwx_group_applications_one_pending on public.uwx_group_applications (vrchat_group_id) where status = 'pending';

create or replace function public.uwx_review_group_application(p_id uuid, p_approve boolean, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.uwx_group_applications; v_group uuid;
begin
  if coalesce(public.uw_max_role_rank(auth.uid(), null), 0) < 90 then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into a from public.uwx_group_applications where id = p_id;
  if a.id is null or a.status <> 'pending' then raise exception 'not_pending'; end if;
  if p_approve then
    if exists (select 1 from public.uwx_groups where vrchat_group_id = a.vrchat_group_id) then
      raise exception 'that VRChat group is already registered';
    end if;
    -- Partner groups don't inherit UnderWeb staff roles: only their owner (and people they add) get access.
    insert into public.uwx_groups (vrchat_group_id, name, role_scope, owner_user_id, network_opt_in, created_by)
    values (a.vrchat_group_id, a.group_name, 'partner:' || a.vrchat_group_id, a.applicant, true, auth.uid())
    returning id into v_group;
    insert into public.uwx_access_log (group_id, action, detail) values (v_group, 'group.register', jsonb_build_object('application', p_id, 'partner', true));
  end if;
  update public.uwx_group_applications set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(p_note, 500) where id = p_id;
  return v_group;
end $$;

-- Group owner: give someone direct access by UnderWeb username (partner groups rely on this).
create or replace function public.uwx_grant_access(p_group uuid, p_username text, p_level smallint)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if public.uwx_group_level(p_group) < 4 then raise exception 'not_allowed' using errcode = '42501'; end if;
  select id into v_user from public.profiles where lower(username) = lower(trim(both '@' from trim(p_username))) limit 1;
  if v_user is null then raise exception 'no UnderWeb account with that username'; end if;
  if p_level <= 0 then
    delete from public.uwx_group_access where group_id = p_group and user_id = v_user;
  else
    insert into public.uwx_group_access (group_id, user_id, level, granted_by) values (p_group, v_user, least(p_level, 4), auth.uid())
    on conflict (group_id, user_id) do update set level = excluded.level, granted_by = auth.uid(), granted_at = now();
  end if;
  insert into public.uwx_access_log (group_id, action, detail) values (p_group, 'access.person', jsonb_build_object('user', v_user, 'level', p_level));
  return v_user;
end $$;

create or replace function public.uwx_direct_access(p_group uuid)
returns table (user_id uuid, display_name text, username text, level smallint, granted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.user_id, p.display_name, p.username, a.level, a.granted_at
  from public.uwx_group_access a left join public.profiles p on p.id = a.user_id
  where a.group_id = p_group and public.uwx_group_level(p_group) >= 4
  order by a.level desc, p.display_name
$$;

-- ───────── flagged subjects (for "flagged user entered your instance" alerts) ─────────
-- Own group's open cases (moderators+), plus high/critical cases partner groups share with us.
create or replace function public.uwx_flagged_subjects(p_group uuid)
returns table (subject_vrc_id text, subject_name text, case_number bigint, severity text, status text, category text, source text)
language plpgsql security definer set search_path = public as $$
begin
  if public.uwx_group_level(p_group) < 2 then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.uwx_access_log (group_id, action, detail) values (p_group, 'network.flag_list', '{}'::jsonb);
  return query
    select c.subject_vrc_id, c.subject_name, c.case_number, c.severity, c.status, c.category, 'own'::text
    from public.uwx_cases c
    where c.group_id = p_group and c.subject_vrc_id is not null and c.status in ('open','under_review','escalated','appealed')
    union all
    select c.subject_vrc_id, null::text, c.case_number, c.severity, c.status, c.category, g.name
    from public.uwx_share_agreements a
    join public.uwx_groups g on g.id = a.from_group and g.status = 'active' and g.network_opt_in
    join public.uwx_cases c on c.group_id = a.from_group and c.share_with_network and c.subject_vrc_id is not null
    where a.to_group = p_group and a.status = 'active' and c.severity in ('high','critical') and c.status <> 'dismissed'
    limit 2000;
end $$;

-- ───────── staff stats ─────────
-- Balanced picture per staff member. Managers see everyone; others see themselves.
create or replace function public.uwx_staff_stats(p_group uuid, p_since timestamptz)
returns table (user_id uuid, display_name text, level smallint, shift_minutes bigint, on_duty boolean,
               cases_opened bigint, cases_open_assigned bigint, cases_closed bigint, case_entries bigint, actions_recorded bigint,
               notes bigint, first_responses bigint, avg_first_response_min numeric, recruits_reviewed bigint, help_claimed bigint)
language sql stable security definer set search_path = public as $$
  with lvl as (select public.uwx_group_level(p_group) as me),
  staff as (
    select ur.user_id from public.user_roles ur
      join public.uwx_group_role_access m on m.role_slug = ur.role_slug and m.group_id = p_group and m.level >= 1
      join public.uwx_groups g on g.id = p_group
      where ur.status = 'active' and ur.group_scope in ('network', g.role_scope)
    union select a.user_id from public.uwx_group_access a where a.group_id = p_group
    union select owner_user_id from public.uwx_groups where id = p_group and owner_user_id is not null
  ),
  firsts as (
    select distinct on (e.case_id) e.case_id, e.created_by, e.created_at, c.created_at as case_created
    from public.uwx_case_entries e join public.uwx_cases c on c.id = e.case_id
    where c.group_id = p_group and e.kind <> 'created' and c.created_at >= p_since
    order by e.case_id, e.created_at
  )
  select s.user_id, p.display_name, public.uwx_group_level(p_group, s.user_id),
    coalesce((select sum(extract(epoch from (coalesce(sh.ended_at, now()) - greatest(sh.started_at, p_since))) / 60)::bigint
              from public.uwx_staff_shifts sh where sh.group_id = p_group and sh.user_id = s.user_id and coalesce(sh.ended_at, now()) >= p_since), 0),
    exists (select 1 from public.uwx_staff_shifts sh where sh.group_id = p_group and sh.user_id = s.user_id and sh.ended_at is null),
    (select count(*) from public.uwx_cases c where c.group_id = p_group and c.created_by = s.user_id and c.created_at >= p_since),
    (select count(*) from public.uwx_cases c where c.group_id = p_group and c.assigned_to = s.user_id and c.status in ('open','under_review','escalated','appealed')),
    (select count(*) from public.uwx_case_entries e join public.uwx_cases c on c.id = e.case_id
       where c.group_id = p_group and e.created_by = s.user_id and e.kind = 'status' and e.to_value in ('resolved','dismissed') and e.created_at >= p_since),
    (select count(*) from public.uwx_case_entries e join public.uwx_cases c on c.id = e.case_id
       where c.group_id = p_group and e.created_by = s.user_id and e.kind <> 'created' and e.created_at >= p_since),
    (select count(*) from public.uwx_case_entries e join public.uwx_cases c on c.id = e.case_id
       where c.group_id = p_group and e.created_by = s.user_id and e.kind = 'action' and e.created_at >= p_since),
    (select count(*) from public.uwx_subject_notes n where n.group_id = p_group and n.created_by = s.user_id and n.created_at >= p_since),
    (select count(*) from firsts f where f.created_by = s.user_id),
    (select round(avg(extract(epoch from (f.created_at - f.case_created)) / 60)::numeric, 1) from firsts f where f.created_by = s.user_id),
    (select count(*) from public.uwx_recruit_claims r where r.group_id = p_group and r.reviewed_by = s.user_id and r.reviewed_at >= p_since),
    (select count(*) from public.uwx_help_requests h where h.group_id = p_group and h.claimed_by = s.user_id and h.claimed_at >= p_since)
  from staff s left join public.profiles p on p.id = s.user_id, lvl
  where lvl.me >= 1 and (lvl.me >= 3 or s.user_id = auth.uid())
  order by 5 desc, 2
$$;

-- ───────── Road to 500 for every signed-in member (UnderWeb's own groups only, not partners) ─────────
create or replace function public.uwx_public_progress()
returns table (group_id uuid, name text, member_goal int, member_count int, measured_at timestamptz, verified_recruits bigint)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, coalesce(g.member_goal, 500), s.member_count, s.bucket_at,
    (select count(*) from public.uwx_recruit_claims c where c.group_id = g.id and c.status = 'verified')
  from public.uwx_groups g
  left join lateral (select member_count, bucket_at from public.uwx_group_snapshots
                     where group_id = g.id and member_count is not null order by bucket_at desc limit 1) s on true
  where g.status = 'active' and g.role_scope not like 'partner:%' and auth.uid() is not null
  order by g.created_at
$$;

-- ───────── RLS ─────────
alter table public.uwx_staff_shifts enable row level security;
alter table public.uwx_help_requests enable row level security;
alter table public.uwx_event_recaps enable row level security;
alter table public.uwx_group_applications enable row level security;

drop policy if exists uwx_shifts_read on public.uwx_staff_shifts;
create policy uwx_shifts_read on public.uwx_staff_shifts for select to authenticated using (public.uwx_group_level(group_id) >= 1);
drop policy if exists uwx_shifts_insert on public.uwx_staff_shifts;
create policy uwx_shifts_insert on public.uwx_staff_shifts for insert to authenticated with check (user_id = auth.uid() and public.uwx_group_level(group_id) >= 1);
drop policy if exists uwx_shifts_update on public.uwx_staff_shifts;
create policy uwx_shifts_update on public.uwx_staff_shifts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists uwx_help_read on public.uwx_help_requests;
create policy uwx_help_read on public.uwx_help_requests for select to authenticated using (public.uwx_group_level(group_id) >= 1);
drop policy if exists uwx_help_insert on public.uwx_help_requests;
create policy uwx_help_insert on public.uwx_help_requests for insert to authenticated
  with check (requested_by = auth.uid() and status = 'open' and claimed_by is null and closed_by is null and public.uwx_group_level(group_id) >= 1);

drop policy if exists uwx_recaps_read on public.uwx_event_recaps;
create policy uwx_recaps_read on public.uwx_event_recaps for select to authenticated using (public.uwx_group_level(group_id) >= 1);
drop policy if exists uwx_recaps_insert on public.uwx_event_recaps;
create policy uwx_recaps_insert on public.uwx_event_recaps for insert to authenticated with check (recorded_by = auth.uid() and public.uwx_group_level(group_id) >= 1);

drop policy if exists uwx_apps_read on public.uwx_group_applications;
create policy uwx_apps_read on public.uwx_group_applications for select to authenticated
  using (applicant = auth.uid() or coalesce(public.uw_max_role_rank(auth.uid(), null), 0) >= 90);
drop policy if exists uwx_apps_insert on public.uwx_group_applications;
create policy uwx_apps_insert on public.uwx_group_applications for insert to authenticated
  with check (applicant = auth.uid() and status = 'pending' and reviewed_by is null);
drop policy if exists uwx_apps_withdraw on public.uwx_group_applications;
create policy uwx_apps_withdraw on public.uwx_group_applications for delete to authenticated using (applicant = auth.uid() and status = 'pending');

revoke all on function public.uwx_names(uuid, uuid[]) from public, anon;
revoke all on function public.uwx_close_stale_shifts(uuid) from public, anon;
revoke all on function public.uwx_help_update(uuid, text) from public, anon;
revoke all on function public.uwx_review_group_application(uuid, boolean, text) from public, anon;
revoke all on function public.uwx_grant_access(uuid, text, smallint) from public, anon;
revoke all on function public.uwx_direct_access(uuid) from public, anon;
revoke all on function public.uwx_flagged_subjects(uuid) from public, anon;
revoke all on function public.uwx_staff_stats(uuid, timestamptz) from public, anon;
revoke all on function public.uwx_public_progress() from public, anon;
grant execute on function public.uwx_names(uuid, uuid[]), public.uwx_close_stale_shifts(uuid), public.uwx_help_update(uuid, text),
  public.uwx_review_group_application(uuid, boolean, text), public.uwx_grant_access(uuid, text, smallint), public.uwx_direct_access(uuid),
  public.uwx_flagged_subjects(uuid), public.uwx_staff_stats(uuid, timestamptz), public.uwx_public_progress() to authenticated;

-- ───────── Discord moderation log state (written only by the uwx-mod-discord edge function) ─────────
create table if not exists public.uwx_discord_state (
  group_id uuid primary key references public.uwx_groups(id) on delete cascade,
  events_cursor timestamptz,
  entries_cursor bigint not null default 0,
  backfilled_at timestamptz,
  last_post_at timestamptz,
  last_error text
);
alter table public.uwx_discord_state enable row level security;
drop policy if exists uwx_discord_state_read on public.uwx_discord_state;
create policy uwx_discord_state_read on public.uwx_discord_state for select to authenticated using (public.uwx_group_level(group_id) >= 1);

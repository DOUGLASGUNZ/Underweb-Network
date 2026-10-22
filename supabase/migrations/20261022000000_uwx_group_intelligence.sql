-- UWX Group Intelligence, Moderation Center, Recruitment & Moderation Network (foundation)
--
-- Everything here is keyed by the permanent VRChat ids (grp_… / usr_…), never by display names.
-- Access is decided per registered group by uwx_group_level():
--   0 none · 1 viewer (stats + activity) · 2 moderator (user intel, notes, cases)
--   3 manager (assign, verify recruiting, read access log) · 4 group owner (sharing, access mapping)
-- Levels come from the group's configurable role mapping (UnderWeb roles -> level),
-- explicit per-person grants, or being the group's registered owner.
-- Nothing here stores VRChat passwords, cookies or tokens. VRChat data arrives from staff
-- clients reading their own VRChat session, through uwx_ingest_group_data().

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.uwx_try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ───────────────────────── registered groups ─────────────────────────
create table if not exists public.uwx_groups (
  id uuid primary key default gen_random_uuid(),
  vrchat_group_id text not null unique check (vrchat_group_id ~ '^grp_[0-9a-f-]{36}$'),
  name text not null check (char_length(name) between 1 and 80),
  role_scope text not null default 'network',           -- which user_roles.group_scope counts (plus 'network')
  underweb_group_id uuid references public.groups(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active','suspended','left')),
  network_opt_in boolean not null default false,
  member_goal int check (member_goal is null or member_goal between 1 and 1000000),
  retention_days int not null default 730 check (retention_days between 30 and 3650),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.uwx_group_access (
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level smallint not null check (level between 1 and 4),
  granted_by uuid default auth.uid() references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.uwx_group_role_access (
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  role_slug text not null,
  level smallint not null check (level between 0 and 4),
  primary key (group_id, role_slug)
);

create or replace function public.uwx_group_level(p_group uuid, p_user uuid default auth.uid())
returns smallint language sql stable security definer set search_path = public as $$
  select coalesce((
    select greatest(
      coalesce((select a.level from public.uwx_group_access a where a.group_id = g.id and a.user_id = p_user), 0),
      coalesce((
        select max(m.level) from public.uwx_group_role_access m
        join public.user_roles ur on ur.role_slug = m.role_slug
        where m.group_id = g.id and ur.user_id = p_user and ur.status = 'active'
          and ur.group_scope in ('network', g.role_scope)
      ), 0),
      case when g.owner_user_id = p_user then 4 else 0 end
    )
    from public.uwx_groups g
    where g.id = p_group and g.status = 'active' and p_user is not null
  ), 0)::smallint
$$;

-- Groups you can see anything for, with your level (what UWX reads on sign-in).
create or replace function public.uwx_my_groups()
returns table (id uuid, vrchat_group_id text, name text, level smallint, member_goal int, network_opt_in boolean, retention_days int)
language sql stable security definer set search_path = public as $$
  select g.id, g.vrchat_group_id, g.name, public.uwx_group_level(g.id), g.member_goal, g.network_opt_in, g.retention_days
  from public.uwx_groups g
  where g.status = 'active' and public.uwx_group_level(g.id) > 0
  order by g.name
$$;

-- Register a VRChat group. For now only UnderWeb Owner/Directors can register groups; the
-- desktop client checks the caller's VRChat role in that group before offering this.
create or replace function public.uwx_register_group(p_vrchat_group_id text, p_name text, p_role_scope text default 'underweb', p_member_goal int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(public.uw_max_role_rank(auth.uid(), null), 0) < 90 then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.uwx_groups (vrchat_group_id, name, role_scope, owner_user_id, member_goal, underweb_group_id)
  values (p_vrchat_group_id, left(trim(p_name), 80), coalesce(nullif(trim(p_role_scope), ''), 'network'), auth.uid(), p_member_goal,
          (select id from public.groups where slug = p_role_scope))
  on conflict (vrchat_group_id) do update set name = excluded.name, updated_at = now()
  returning id into v_id;
  -- Default access mapping (the group owner can change every row).
  insert into public.uwx_group_role_access (group_id, role_slug, level) values
    (v_id, 'owner', 4), (v_id, 'director', 4), (v_id, 'admin', 3), (v_id, 'moderator', 2),
    (v_id, 'staff', 2), (v_id, 'security', 2), (v_id, 'trial_staff', 1)
  on conflict do nothing;
  insert into public.uwx_access_log (group_id, action, detail) values (v_id, 'group.register', jsonb_build_object('vrchat_group_id', p_vrchat_group_id));
  return v_id;
end $$;

-- Group owner: change goal / retention / network opt-in.
create or replace function public.uwx_update_group(p_group uuid, p_member_goal int default null, p_retention_days int default null, p_network_opt_in boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.uwx_group_level(p_group) < 4 then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.uwx_groups set
    member_goal = coalesce(p_member_goal, member_goal),
    retention_days = coalesce(p_retention_days, retention_days),
    network_opt_in = coalesce(p_network_opt_in, network_opt_in),
    updated_at = now()
  where id = p_group;
  if p_network_opt_in is false then
    update public.uwx_share_agreements set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
    where status = 'active' and (from_group = p_group or to_group = p_group);
  end if;
  insert into public.uwx_access_log (group_id, action, detail)
  values (p_group, 'group.update', jsonb_strip_nulls(jsonb_build_object('member_goal', p_member_goal, 'retention_days', p_retention_days, 'network_opt_in', p_network_opt_in)));
end $$;

-- Group owner: set the level for an UnderWeb role (configurable Owner/Director/Admin/Moderator/Staff/Trial Staff access).
create or replace function public.uwx_set_role_access(p_group uuid, p_role_slug text, p_level smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.uwx_group_level(p_group) < 4 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_role_slug = 'owner' and p_level < 4 then raise exception 'owner_protected'; end if;
  insert into public.uwx_group_role_access (group_id, role_slug, level) values (p_group, p_role_slug, greatest(0, least(4, p_level)))
  on conflict (group_id, role_slug) do update set level = excluded.level;
  insert into public.uwx_access_log (group_id, action, detail) values (p_group, 'access.role', jsonb_build_object('role', p_role_slug, 'level', p_level));
end $$;

-- ───────────────────────── snapshots, events, sync state ─────────────────────────
create table if not exists public.uwx_group_snapshots (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  bucket_at timestamptz not null,                 -- 15-minute bucket; repeat syncs update the same row
  captured_at timestamptz not null default now(),
  member_count int check (member_count >= 0),
  online_count int check (online_count >= 0),
  ban_count int check (ban_count >= 0),
  request_count int check (request_count >= 0),
  invite_count int check (invite_count >= 0),
  capped jsonb not null default '{}'::jsonb,       -- e.g. {"ban_count": true} when the count stopped at the page limit
  recorded_by uuid default auth.uid() references auth.users(id) on delete set null,
  unique (group_id, bucket_at)
);
create index if not exists uwx_group_snapshots_group_time on public.uwx_group_snapshots (group_id, bucket_at desc);

create table if not exists public.uwx_group_events (
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  vrchat_event_id text not null,
  occurred_at timestamptz not null,
  event_type text not null,
  actor_vrc_id text,
  actor_name text,
  target_vrc_id text,
  description text,
  data jsonb not null default '{}'::jsonb,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  primary key (group_id, vrchat_event_id)
);
create index if not exists uwx_group_events_time on public.uwx_group_events (group_id, occurred_at desc);
create index if not exists uwx_group_events_type on public.uwx_group_events (group_id, event_type, occurred_at desc);
create index if not exists uwx_group_events_target on public.uwx_group_events (target_vrc_id, occurred_at desc);
create index if not exists uwx_group_events_actor on public.uwx_group_events (actor_vrc_id, occurred_at desc);

create table if not exists public.uwx_group_sync_state (
  group_id uuid primary key references public.uwx_groups(id) on delete cascade,
  last_snapshot_at timestamptz,
  last_events_at timestamptz,
  newest_event_at timestamptz,
  events_total bigint not null default 0,
  last_synced_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Staff clients push what they read from VRChat (their own session) here. Duplicates are ignored.
create or replace function public.uwx_ingest_group_data(p_group uuid, p_snapshot jsonb default null, p_events jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inserted int := 0;
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  v_newest timestamptz;
begin
  if public.uwx_group_level(p_group) < 1 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_events is null then p_events := '[]'::jsonb; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then raise exception 'bad_events'; end if;

  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object' then
    insert into public.uwx_group_snapshots as s (group_id, bucket_at, member_count, online_count, ban_count, request_count, invite_count, capped)
    values (p_group, v_bucket,
      (p_snapshot->>'member_count')::int, (p_snapshot->>'online_count')::int, (p_snapshot->>'ban_count')::int,
      (p_snapshot->>'request_count')::int, (p_snapshot->>'invite_count')::int,
      case when jsonb_typeof(p_snapshot->'capped') = 'object' then p_snapshot->'capped' else '{}'::jsonb end)
    on conflict (group_id, bucket_at) do update set
      member_count = coalesce(excluded.member_count, s.member_count),
      online_count = coalesce(excluded.online_count, s.online_count),
      ban_count = coalesce(excluded.ban_count, s.ban_count),
      request_count = coalesce(excluded.request_count, s.request_count),
      invite_count = coalesce(excluded.invite_count, s.invite_count),
      capped = s.capped || excluded.capped,
      captured_at = now(), recorded_by = auth.uid();
  end if;

  with ins as (
    insert into public.uwx_group_events (group_id, vrchat_event_id, occurred_at, event_type, actor_vrc_id, actor_name, target_vrc_id, description, data)
    select p_group, left(e->>'id', 100), (e->>'created_at')::timestamptz, left(coalesce(e->>'event_type', ''), 80),
      nullif(left(e->>'actor_id', 64), ''), nullif(left(e->>'actor_name', 80), ''), nullif(left(e->>'target_id', 64), ''),
      left(e->>'description', 500),
      case when jsonb_typeof(e->'data') = 'object' and length((e->'data')::text) <= 4000 then e->'data' else '{}'::jsonb end
    from jsonb_array_elements(p_events) e
    where coalesce(e->>'id', '') <> '' and coalesce(e->>'created_at', '') <> ''
      and (e->>'created_at')::timestamptz <= now() + interval '1 hour'
    on conflict do nothing
    returning occurred_at
  )
  select count(*), max(occurred_at) into v_inserted, v_newest from ins;

  insert into public.uwx_group_sync_state as st (group_id, last_snapshot_at, last_events_at, newest_event_at, events_total, last_synced_by, updated_at)
  values (p_group, case when p_snapshot is not null then now() end, now(), v_newest, v_inserted, auth.uid(), now())
  on conflict (group_id) do update set
    last_snapshot_at = coalesce(excluded.last_snapshot_at, st.last_snapshot_at),
    last_events_at = now(),
    newest_event_at = greatest(st.newest_event_at, excluded.newest_event_at),
    events_total = st.events_total + v_inserted,
    last_synced_by = auth.uid(), updated_at = now();

  return jsonb_build_object('inserted', v_inserted, 'bucket', v_bucket);
end $$;

-- ───────────────────────── moderation cases ─────────────────────────
create table if not exists public.uwx_cases (
  id uuid primary key default gen_random_uuid(),
  case_number bigint generated always as identity unique,
  group_id uuid not null references public.uwx_groups(id) on delete restrict,
  subject_vrc_id text check (subject_vrc_id is null or subject_vrc_id ~ '^usr_[0-9a-f-]{36}$'),
  subject_name text check (char_length(subject_name) <= 80),
  title text not null check (char_length(title) between 3 and 140),
  summary text not null default '' check (char_length(summary) <= 4000),
  category text not null default 'other' check (category in ('harassment','crashing','threats','doxxing','nsfw','age_concern','spam','impersonation','ban_evasion','hate','other')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','under_review','escalated','resolved','dismissed','appealed')),
  assigned_to uuid references auth.users(id) on delete set null,
  share_with_network boolean not null default false,
  incident_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists uwx_cases_group on public.uwx_cases (group_id, status, updated_at desc);
create index if not exists uwx_cases_subject on public.uwx_cases (subject_vrc_id);
create index if not exists uwx_cases_assigned on public.uwx_cases (assigned_to) where status in ('open','under_review','escalated','appealed');

-- Append-only case timeline. Status and assignment rows are written by triggers.
create table if not exists public.uwx_case_entries (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.uwx_cases(id) on delete cascade,
  kind text not null check (kind in ('created','note','action','status','assignment','evidence','appeal','appeal_decision','correction','share')),
  action_type text check (action_type in ('warning','kick','ban','unban','instance_kick','instance_warn','other')),
  done_in_vrchat boolean,
  body text not null default '' check (char_length(body) <= 4000),
  from_value text,
  to_value text,
  evidence_path text,
  evidence_name text check (char_length(evidence_name) <= 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists uwx_case_entries_case on public.uwx_case_entries (case_id, created_at);

create table if not exists public.uwx_subject_notes (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  subject_vrc_id text not null check (subject_vrc_id ~ '^usr_[0-9a-f-]{36}$'),
  body text not null check (char_length(body) between 1 and 2000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references auth.users(id) on delete set null
);
create index if not exists uwx_subject_notes_subject on public.uwx_subject_notes (group_id, subject_vrc_id, created_at desc);

-- Who looked at / changed what. Append-only.
create table if not exists public.uwx_access_log (
  id bigint generated always as identity primary key,
  actor uuid default auth.uid() references auth.users(id) on delete set null,
  group_id uuid references public.uwx_groups(id) on delete cascade,
  action text not null,
  subject_vrc_id text,
  case_id uuid,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists uwx_access_log_group on public.uwx_access_log (group_id, at desc);

-- Immutability: entries / access log can't be edited or deleted, except inside uwx_purge_case().
create or replace function public.uwx_block_change()
returns trigger language plpgsql as $$
begin
  if current_setting('uwx.allow_purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end $$;
drop trigger if exists uwx_case_entries_immutable on public.uwx_case_entries;
create trigger uwx_case_entries_immutable before update or delete on public.uwx_case_entries for each row execute function public.uwx_block_change();
drop trigger if exists uwx_access_log_immutable on public.uwx_access_log;
create trigger uwx_access_log_immutable before update or delete on public.uwx_access_log for each row execute function public.uwx_block_change();

-- Notes: the text can't change; only hiding is allowed (by the author or a manager).
create or replace function public.uwx_notes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.body is distinct from old.body or new.subject_vrc_id is distinct from old.subject_vrc_id
     or new.group_id is distinct from old.group_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'notes can only be hidden, not edited' using errcode = '42501';
  end if;
  if old.created_by is distinct from auth.uid() and public.uwx_group_level(old.group_id) < 3 then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  new.hidden_by := case when new.hidden_at is null then null else auth.uid() end;
  return new;
end $$;
drop trigger if exists uwx_subject_notes_guard on public.uwx_subject_notes;
create trigger uwx_subject_notes_guard before update on public.uwx_subject_notes for each row execute function public.uwx_notes_guard();

create or replace function public.uwx_cases_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    if new.status in ('resolved','dismissed') then new.closed_at := now(); end if;
    return new;
  end if;
  if new.group_id is distinct from old.group_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.case_number is distinct from old.case_number then
    raise exception 'case owner fields are fixed' using errcode = '42501';
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is distinct from auth.uid()
     and public.uwx_group_level(old.group_id) < 3 then
    raise exception 'only managers can assign cases to someone else' using errcode = '42501';
  end if;
  if new.share_with_network is distinct from old.share_with_network and public.uwx_group_level(old.group_id) < 3 then
    raise exception 'only managers can change network sharing' using errcode = '42501';
  end if;
  new.updated_at := now();
  if new.status in ('resolved','dismissed') and old.status not in ('resolved','dismissed') then new.closed_at := now(); end if;
  if new.status not in ('resolved','dismissed') then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists uwx_cases_before on public.uwx_cases;
create trigger uwx_cases_before before insert or update on public.uwx_cases for each row execute function public.uwx_cases_before();

create or replace function public.uwx_cases_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.uwx_case_entries (case_id, kind, body, to_value, created_by) values (new.id, 'created', new.summary, new.status, auth.uid());
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.uwx_case_entries (case_id, kind, from_value, to_value, created_by) values (new.id, 'status', old.status, new.status, auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.uwx_case_entries (case_id, kind, from_value, to_value, created_by) values (new.id, 'assignment', old.assigned_to::text, new.assigned_to::text, auth.uid());
  end if;
  if new.share_with_network is distinct from old.share_with_network then
    insert into public.uwx_case_entries (case_id, kind, to_value, created_by) values (new.id, 'share', new.share_with_network::text, auth.uid());
  end if;
  if new.title is distinct from old.title or new.summary is distinct from old.summary or new.category is distinct from old.category
     or new.severity is distinct from old.severity or new.subject_vrc_id is distinct from old.subject_vrc_id then
    insert into public.uwx_case_entries (case_id, kind, body, from_value, to_value, created_by)
    values (new.id, 'correction', 'Case details edited',
      jsonb_build_object('title', old.title, 'category', old.category, 'severity', old.severity, 'subject', old.subject_vrc_id)::text,
      jsonb_build_object('title', new.title, 'category', new.category, 'severity', new.severity, 'subject', new.subject_vrc_id)::text, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists uwx_cases_after on public.uwx_cases;
create trigger uwx_cases_after after insert or update on public.uwx_cases for each row execute function public.uwx_cases_after();

-- Owner-only deletion workflow (retention / legal requests). Leaves a log line behind.
create or replace function public.uwx_purge_case(p_case uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_num bigint;
begin
  select group_id, case_number into v_group, v_num from public.uwx_cases where id = p_case;
  if v_group is null then raise exception 'not_found'; end if;
  if public.uwx_group_level(v_group) < 4 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 5 then raise exception 'reason_required'; end if;
  perform set_config('uwx.allow_purge', 'on', true);
  delete from public.uwx_cases where id = p_case;
  perform set_config('uwx.allow_purge', 'off', true);
  insert into public.uwx_access_log (group_id, action, case_id, detail) values (v_group, 'case.purge', p_case, jsonb_build_object('case_number', v_num, 'reason', left(p_reason, 300)));
end $$;

-- Retention: drop raw VRChat events older than the group's retention window (group owner).
create or replace function public.uwx_apply_retention(p_group uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_days int; v_n int;
begin
  if public.uwx_group_level(p_group) < 4 then raise exception 'not_allowed' using errcode = '42501'; end if;
  select retention_days into v_days from public.uwx_groups where id = p_group;
  delete from public.uwx_group_events where group_id = p_group and occurred_at < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  insert into public.uwx_access_log (group_id, action, detail) values (p_group, 'retention.apply', jsonb_build_object('deleted', v_n, 'days', v_days));
  return v_n;
end $$;

-- ───────────────────────── user intelligence ─────────────────────────
-- Everything UnderWeb knows about one VRChat user, for one group you staff. Logged.
create or replace function public.uwx_subject_overview(p_group uuid, p_vrc_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_account jsonb; v_events jsonb; v_counts jsonb; v_safety jsonb;
begin
  if public.uwx_group_level(p_group) < 2 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_vrc_id !~ '^usr_[0-9a-f-]{36}$' then raise exception 'bad_user_id'; end if;

  select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'username', p.username, 'verified', nc.verification_status,
           'roles', coalesce((select jsonb_agg(jsonb_build_object('slug', ur.role_slug, 'name', rd.name, 'rank', rd.authority_rank) order by rd.authority_rank desc)
                              from public.user_roles ur join public.role_definitions rd on rd.slug = ur.role_slug
                              where ur.user_id = p.id and ur.status = 'active'), '[]'::jsonb))
    into v_account
  from public.network_connections nc join public.profiles p on p.id = nc.user_id
  where nc.provider = 'vrchat' and nc.external_id = p_vrc_id
  order by (nc.verification_status = 'verified') desc nulls last
  limit 1;

  -- Joins/leaves are done by the member themselves (they are the actor); actions on them name them as target.
  select jsonb_build_object(
      'tracked', count(*),
      'bans', count(*) filter (where event_type = 'group.user.ban' and target_vrc_id = p_vrc_id),
      'unbans', count(*) filter (where event_type = 'group.user.unban' and target_vrc_id = p_vrc_id),
      'removals', count(*) filter (where event_type = 'group.member.remove' and target_vrc_id = p_vrc_id),
      'instance_kicks', count(*) filter (where event_type = 'group.instance.kick' and target_vrc_id = p_vrc_id),
      'instance_warns', count(*) filter (where event_type = 'group.instance.warn' and target_vrc_id = p_vrc_id),
      'joins', count(*) filter (where event_type = 'group.member.join'),
      'leaves', count(*) filter (where event_type = 'group.member.leave'),
      'actions_taken', count(*) filter (where actor_vrc_id = p_vrc_id and event_type not in ('group.member.join','group.member.leave','group.request.create')),
      'first_seen', min(occurred_at), 'last_seen', max(occurred_at),
      'last_ban_state', (select event_type from public.uwx_group_events x where x.group_id = p_group and x.target_vrc_id = p_vrc_id
                           and x.event_type in ('group.user.ban','group.user.unban') order by occurred_at desc limit 1))
    into v_counts
  from public.uwx_group_events where group_id = p_group and (target_vrc_id = p_vrc_id or actor_vrc_id = p_vrc_id);

  select coalesce(jsonb_agg(to_jsonb(e) - 'group_id' - 'uploaded_by' - 'uploaded_at' order by e.occurred_at desc), '[]'::jsonb) into v_events
  from (select * from public.uwx_group_events where group_id = p_group and (target_vrc_id = p_vrc_id or actor_vrc_id = p_vrc_id)
        order by occurred_at desc limit 300) e;

  select to_jsonb(s) into v_safety from (
    select risk_level, verified_report_count, public_summary from public.uwx_safety_subjects where vrchat_user_id = p_vrc_id) s;

  v := jsonb_build_object(
    'account', v_account,
    'counts', v_counts,
    'events', v_events,
    'safety', v_safety,
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'case_number', c.case_number, 'title', c.title, 'status', c.status,
                 'severity', c.severity, 'category', c.category, 'created_at', c.created_at, 'incident_at', c.incident_at,
                 'actions', (select coalesce(jsonb_agg(jsonb_build_object('type', ce.action_type, 'at', ce.created_at, 'vrchat', ce.done_in_vrchat, 'body', ce.body) order by ce.created_at), '[]'::jsonb)
                             from public.uwx_case_entries ce where ce.case_id = c.id and ce.kind = 'action'))
               order by c.created_at desc)
               from public.uwx_cases c where c.group_id = p_group and c.subject_vrc_id = p_vrc_id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'created_by', n.created_by,
                 'author', (select coalesce(pp.display_name, pp.username) from public.profiles pp where pp.id = n.created_by)) order by n.created_at desc)
               from public.uwx_subject_notes n where n.group_id = p_group and n.subject_vrc_id = p_vrc_id and n.hidden_at is null), '[]'::jsonb),
    'sync', (select to_jsonb(st) - 'group_id' - 'last_synced_by' from public.uwx_group_sync_state st where st.group_id = p_group)
  );
  insert into public.uwx_access_log (group_id, action, subject_vrc_id) values (p_group, 'subject.view', p_vrc_id);
  return v;
end $$;

-- ───────────────────────── moderation network (opt-in sharing) ─────────────────────────
create table if not exists public.uwx_share_agreements (
  id uuid primary key default gen_random_uuid(),
  from_group uuid not null references public.uwx_groups(id) on delete cascade,
  to_group uuid not null references public.uwx_groups(id) on delete cascade,
  scope text not null default 'summary' check (scope in ('summary','detailed')),
  status text not null default 'active' check (status in ('active','revoked')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  unique (from_group, to_group),
  check (from_group <> to_group)
);

-- A group owner shares (or stops sharing) its network-flagged cases with another group.
create or replace function public.uwx_set_sharing(p_from uuid, p_to uuid, p_scope text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.uwx_group_level(p_from) < 4 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_active and not exists (select 1 from public.uwx_groups where id in (p_from, p_to) and network_opt_in group by true having count(*) = 2) then
    raise exception 'both groups must opt in to the network first';
  end if;
  insert into public.uwx_share_agreements (from_group, to_group, scope, status, revoked_at, revoked_by)
  values (p_from, p_to, coalesce(p_scope, 'summary'), case when p_active then 'active' else 'revoked' end,
          case when p_active then null else now() end, case when p_active then null else auth.uid() end)
  on conflict (from_group, to_group) do update set
    scope = excluded.scope, status = excluded.status, revoked_at = excluded.revoked_at, revoked_by = excluded.revoked_by;
  insert into public.uwx_access_log (group_id, action, detail) values (p_from, case when p_active then 'share.grant' else 'share.revoke' end,
    jsonb_build_object('to_group', p_to, 'scope', p_scope));
end $$;

-- Cases other groups chose to share with a group you moderate. Read-only, logged, never acted on automatically.
create or replace function public.uwx_network_lookup(p_group uuid, p_vrc_id text)
returns table (source_group text, case_number bigint, category text, severity text, status text, incident_at timestamptz, created_at timestamptz,
               actions text[], title text, summary text, scope text)
language plpgsql security definer set search_path = public as $$
begin
  if public.uwx_group_level(p_group) < 2 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_vrc_id !~ '^usr_[0-9a-f-]{36}$' then raise exception 'bad_user_id'; end if;
  insert into public.uwx_access_log (group_id, action, subject_vrc_id) values (p_group, 'network.lookup', p_vrc_id);
  return query
    select g.name, c.case_number, c.category, c.severity, c.status, c.incident_at, c.created_at,
      array(select distinct ce.action_type from public.uwx_case_entries ce where ce.case_id = c.id and ce.kind = 'action' and ce.action_type is not null),
      case when a.scope = 'detailed' then c.title end,
      case when a.scope = 'detailed' then c.summary end,
      a.scope
    from public.uwx_share_agreements a
    join public.uwx_groups g on g.id = a.from_group and g.status = 'active' and g.network_opt_in
    join public.uwx_cases c on c.group_id = a.from_group and c.share_with_network and c.subject_vrc_id = p_vrc_id
    where a.to_group = p_group and a.status = 'active'
    order by c.created_at desc
    limit 100;
end $$;

-- ───────────────────────── recruitment (Road to 500) ─────────────────────────
create table if not exists public.uwx_recruit_claims (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.uwx_groups(id) on delete cascade,
  campaign text not null default 'road_to_500' check (campaign ~ '^[a-z0-9_]{2,40}$'),
  recruiter_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recruit_vrc_id text not null check (recruit_vrc_id ~ '^usr_[0-9a-f-]{36}$'),
  recruit_name text check (char_length(recruit_name) <= 80),
  note text not null default '' check (char_length(note) <= 500),
  evidence_path text,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  join_event_id text,
  joined_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  unique (group_id, campaign, recruit_vrc_id, recruiter_user_id)
);
-- One verified recruiter per recruit per campaign.
create unique index if not exists uwx_recruit_claims_one_verified on public.uwx_recruit_claims (group_id, campaign, recruit_vrc_id) where status = 'verified';
create index if not exists uwx_recruit_claims_group on public.uwx_recruit_claims (group_id, campaign, status, created_at desc);

create or replace function public.uwx_review_recruit_claim(p_claim uuid, p_verify boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.uwx_recruit_claims; v_event record;
begin
  select * into c from public.uwx_recruit_claims where id = p_claim;
  if c.id is null then raise exception 'not_found'; end if;
  if public.uwx_group_level(c.group_id) < 3 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if c.recruiter_user_id = auth.uid() then raise exception 'you can''t review your own claim' using errcode = '42501'; end if;
  select vrchat_event_id, occurred_at into v_event from public.uwx_group_events
   where group_id = c.group_id and event_type = 'group.member.join' and (actor_vrc_id = c.recruit_vrc_id or target_vrc_id = c.recruit_vrc_id)
   order by occurred_at asc limit 1;
  if p_verify and exists (select 1 from public.uwx_recruit_claims where group_id = c.group_id and campaign = c.campaign
                          and recruit_vrc_id = c.recruit_vrc_id and status = 'verified' and id <> c.id) then
    raise exception 'another recruiter is already verified for this person';
  end if;
  update public.uwx_recruit_claims set status = case when p_verify then 'verified' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(p_note, 500),
    join_event_id = v_event.vrchat_event_id, joined_at = v_event.occurred_at
  where id = p_claim;
  insert into public.uwx_access_log (group_id, action, subject_vrc_id, detail)
  values (c.group_id, case when p_verify then 'recruit.verify' else 'recruit.reject' end, c.recruit_vrc_id, jsonb_build_object('claim', p_claim, 'join_found', v_event.vrchat_event_id is not null));
  return jsonb_build_object('join_found', v_event.vrchat_event_id is not null, 'joined_at', v_event.occurred_at);
end $$;

-- Public-to-members leaderboard: names and counts only.
create or replace function public.uwx_recruit_leaderboard(p_group uuid, p_campaign text default 'road_to_500')
returns table (user_id uuid, display_name text, username text, verified bigint, pending bigint)
language sql stable security definer set search_path = public as $$
  select c.recruiter_user_id, p.display_name, p.username,
    count(*) filter (where c.status = 'verified'), count(*) filter (where c.status = 'pending')
  from public.uwx_recruit_claims c left join public.profiles p on p.id = c.recruiter_user_id
  where c.group_id = p_group and c.campaign = p_campaign and auth.uid() is not null
  group by 1, 2, 3
  having count(*) filter (where c.status in ('verified','pending')) > 0
  order by 4 desc, 5 desc, 2
  limit 100
$$;

-- Staff picker for case assignment: people who have level 2+ in the group.
create or replace function public.uwx_group_staff(p_group uuid)
returns table (user_id uuid, display_name text, username text, level smallint)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.username, public.uwx_group_level(p_group, p.id)
  from public.profiles p
  where public.uwx_group_level(p_group) >= 2
    and p.id in (select ur.user_id from public.user_roles ur join public.uwx_group_role_access m on m.role_slug = ur.role_slug and m.group_id = p_group
                 where ur.status = 'active' and m.level >= 2
                 union select a.user_id from public.uwx_group_access a where a.group_id = p_group and a.level >= 2
                 union select g.owner_user_id from public.uwx_groups g where g.id = p_group)
    and public.uwx_group_level(p_group, p.id) >= 2
  order by 4 desc, 2
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.uwx_groups enable row level security;
alter table public.uwx_group_access enable row level security;
alter table public.uwx_group_role_access enable row level security;
alter table public.uwx_group_snapshots enable row level security;
alter table public.uwx_group_events enable row level security;
alter table public.uwx_group_sync_state enable row level security;
alter table public.uwx_cases enable row level security;
alter table public.uwx_case_entries enable row level security;
alter table public.uwx_subject_notes enable row level security;
alter table public.uwx_access_log enable row level security;
alter table public.uwx_share_agreements enable row level security;
alter table public.uwx_recruit_claims enable row level security;

-- Signed-in members can see which groups exist (name, goal) — needed for the recruiting leaderboard.
drop policy if exists uwx_groups_read on public.uwx_groups;
create policy uwx_groups_read on public.uwx_groups for select to authenticated using (status = 'active');
drop policy if exists uwx_group_access_read on public.uwx_group_access;
create policy uwx_group_access_read on public.uwx_group_access for select to authenticated using (user_id = auth.uid() or public.uwx_group_level(group_id) >= 4);
drop policy if exists uwx_group_access_write on public.uwx_group_access;
create policy uwx_group_access_write on public.uwx_group_access for all to authenticated
  using (public.uwx_group_level(group_id) >= 4) with check (public.uwx_group_level(group_id) >= 4 and level <= 4);
drop policy if exists uwx_group_role_access_read on public.uwx_group_role_access;
create policy uwx_group_role_access_read on public.uwx_group_role_access for select to authenticated using (public.uwx_group_level(group_id) >= 1);

drop policy if exists uwx_snapshots_read on public.uwx_group_snapshots;
create policy uwx_snapshots_read on public.uwx_group_snapshots for select to authenticated using (public.uwx_group_level(group_id) >= 1);
drop policy if exists uwx_events_read on public.uwx_group_events;
create policy uwx_events_read on public.uwx_group_events for select to authenticated using (public.uwx_group_level(group_id) >= 1);
drop policy if exists uwx_sync_read on public.uwx_group_sync_state;
create policy uwx_sync_read on public.uwx_group_sync_state for select to authenticated using (public.uwx_group_level(group_id) >= 1);

drop policy if exists uwx_cases_read on public.uwx_cases;
create policy uwx_cases_read on public.uwx_cases for select to authenticated using (public.uwx_group_level(group_id) >= 2);
drop policy if exists uwx_cases_insert on public.uwx_cases;
create policy uwx_cases_insert on public.uwx_cases for insert to authenticated with check (public.uwx_group_level(group_id) >= 2);
drop policy if exists uwx_cases_update on public.uwx_cases;
create policy uwx_cases_update on public.uwx_cases for update to authenticated using (public.uwx_group_level(group_id) >= 2) with check (public.uwx_group_level(group_id) >= 2);

drop policy if exists uwx_case_entries_read on public.uwx_case_entries;
create policy uwx_case_entries_read on public.uwx_case_entries for select to authenticated
  using (exists (select 1 from public.uwx_cases c where c.id = case_id and public.uwx_group_level(c.group_id) >= 2));
drop policy if exists uwx_case_entries_insert on public.uwx_case_entries;
create policy uwx_case_entries_insert on public.uwx_case_entries for insert to authenticated
  with check (created_by = auth.uid() and kind in ('note','action','evidence','appeal','appeal_decision')
    and exists (select 1 from public.uwx_cases c where c.id = case_id
                and public.uwx_group_level(c.group_id) >= case when kind = 'appeal_decision' then 3 else 2 end));

drop policy if exists uwx_notes_read on public.uwx_subject_notes;
create policy uwx_notes_read on public.uwx_subject_notes for select to authenticated using (public.uwx_group_level(group_id) >= 2);
drop policy if exists uwx_notes_insert on public.uwx_subject_notes;
create policy uwx_notes_insert on public.uwx_subject_notes for insert to authenticated with check (created_by = auth.uid() and public.uwx_group_level(group_id) >= 2);
drop policy if exists uwx_notes_hide on public.uwx_subject_notes;
create policy uwx_notes_hide on public.uwx_subject_notes for update to authenticated using (public.uwx_group_level(group_id) >= 2) with check (public.uwx_group_level(group_id) >= 2);

drop policy if exists uwx_access_log_read on public.uwx_access_log;
create policy uwx_access_log_read on public.uwx_access_log for select to authenticated using (public.uwx_group_level(group_id) >= 3);

drop policy if exists uwx_share_read on public.uwx_share_agreements;
create policy uwx_share_read on public.uwx_share_agreements for select to authenticated
  using (public.uwx_group_level(from_group) >= 3 or public.uwx_group_level(to_group) >= 3);

drop policy if exists uwx_claims_read on public.uwx_recruit_claims;
create policy uwx_claims_read on public.uwx_recruit_claims for select to authenticated
  using (recruiter_user_id = auth.uid() or public.uwx_group_level(group_id) >= 1);
drop policy if exists uwx_claims_insert on public.uwx_recruit_claims;
create policy uwx_claims_insert on public.uwx_recruit_claims for insert to authenticated
  with check (recruiter_user_id = auth.uid() and status = 'pending' and reviewed_by is null and join_event_id is null
              and exists (select 1 from public.uwx_groups g where g.id = group_id and g.status = 'active'));
drop policy if exists uwx_claims_withdraw on public.uwx_recruit_claims;
create policy uwx_claims_withdraw on public.uwx_recruit_claims for delete to authenticated
  using (recruiter_user_id = auth.uid() and status = 'pending');

-- Functions: signed-in users only (each one checks the level itself).
revoke all on function public.uwx_group_level(uuid, uuid) from public, anon;
revoke all on function public.uwx_my_groups() from public, anon;
revoke all on function public.uwx_register_group(text, text, text, int) from public, anon;
revoke all on function public.uwx_update_group(uuid, int, int, boolean) from public, anon;
revoke all on function public.uwx_set_role_access(uuid, text, smallint) from public, anon;
revoke all on function public.uwx_ingest_group_data(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.uwx_purge_case(uuid, text) from public, anon;
revoke all on function public.uwx_apply_retention(uuid) from public, anon;
revoke all on function public.uwx_subject_overview(uuid, text) from public, anon;
revoke all on function public.uwx_set_sharing(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.uwx_network_lookup(uuid, text) from public, anon;
revoke all on function public.uwx_review_recruit_claim(uuid, boolean, text) from public, anon;
revoke all on function public.uwx_recruit_leaderboard(uuid, text) from public, anon;
revoke all on function public.uwx_group_staff(uuid) from public, anon;
grant execute on function public.uwx_group_level(uuid, uuid), public.uwx_my_groups(), public.uwx_register_group(text, text, text, int),
  public.uwx_update_group(uuid, int, int, boolean), public.uwx_set_role_access(uuid, text, smallint), public.uwx_ingest_group_data(uuid, jsonb, jsonb),
  public.uwx_purge_case(uuid, text), public.uwx_apply_retention(uuid), public.uwx_subject_overview(uuid, text), public.uwx_set_sharing(uuid, uuid, text, boolean),
  public.uwx_network_lookup(uuid, text), public.uwx_review_recruit_claim(uuid, boolean, text), public.uwx_recruit_leaderboard(uuid, text),
  public.uwx_group_staff(uuid) to authenticated;

-- Trial Staff role (spec: Owner / Director / Admin / Moderator / Staff / Trial Staff).
insert into public.role_definitions (slug, name, category, authority_rank, description, is_assignment_only)
values ('trial_staff', 'Trial Staff', 'staff', 50, 'New staff on a trial period. Read-only Group Intelligence by default.', true)
on conflict do nothing;

-- ───────────────────────── evidence storage (private) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uwx-evidence', 'uwx-evidence', false, 15728640, array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','text/plain','application/pdf'])
on conflict (id) do nothing;

-- cases/{group uuid}/{case uuid}/{file}   — group moderators
-- recruit/{group uuid}/{user uuid}/{file} — the recruiter, and group managers
drop policy if exists uwx_evidence_read on storage.objects;
create policy uwx_evidence_read on storage.objects for select to authenticated using (
  bucket_id = 'uwx-evidence' and (
    ((storage.foldername(name))[1] = 'cases' and public.uwx_group_level(public.uwx_try_uuid((storage.foldername(name))[2])) >= 2)
    or ((storage.foldername(name))[1] = 'recruit' and ((storage.foldername(name))[3] = auth.uid()::text
         or public.uwx_group_level(public.uwx_try_uuid((storage.foldername(name))[2])) >= 3))));
drop policy if exists uwx_evidence_write on storage.objects;
create policy uwx_evidence_write on storage.objects for insert to authenticated with check (
  bucket_id = 'uwx-evidence' and (
    ((storage.foldername(name))[1] = 'cases' and public.uwx_group_level(public.uwx_try_uuid((storage.foldername(name))[2])) >= 2
      and exists (select 1 from public.uwx_cases c where c.id = public.uwx_try_uuid((storage.foldername(name))[3]) and c.group_id = public.uwx_try_uuid((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'recruit' and (storage.foldername(name))[3] = auth.uid()::text
      and exists (select 1 from public.uwx_groups g where g.id = public.uwx_try_uuid((storage.foldername(name))[2])))));

-- Hub check-ins, attendance streaks, event badges and account Silk.
-- UWX notices you're in an UnderWeb hub world and checks you in after 10 minutes there (one visit per day).
-- Silk is an append-only ledger; every award has a unique (user, reason, ref) so nothing is paid twice.
-- Safe to run twice.

-- ───────── which worlds count as "the hub" ─────────
create table if not exists public.uw_hub_worlds (
  world_id text primary key check (world_id ~ '^wrld_[0-9a-f-]{36}$'),
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.uw_hub_worlds enable row level security;
drop policy if exists uw_hub_worlds_read on public.uw_hub_worlds;
create policy uw_hub_worlds_read on public.uw_hub_worlds for select to authenticated using (true);

-- Owner / Director: add, rename or switch off a hub world (UWX: "use the world I'm in").
create or replace function public.uw_hub_world_set(p_world_id text, p_name text, p_active boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.uw_max_role_rank(auth.uid(), null), 0) < 90 then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.uw_hub_worlds (world_id, name, active) values (p_world_id, left(trim(p_name), 80), coalesce(p_active, true))
  on conflict (world_id) do update set name = excluded.name, active = excluded.active;
end $$;

-- ───────── visits ─────────
create table if not exists public.uw_hub_visits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,                                   -- America/Detroit calendar day
  world_id text not null,
  first_at timestamptz not null default now(),
  confirmed_at timestamptz,                            -- set after 10+ minutes in the hub
  event_id uuid,
  unique (user_id, day)
);
create index if not exists uw_hub_visits_user on public.uw_hub_visits (user_id, day desc);
alter table public.uw_hub_visits enable row level security;
drop policy if exists uw_hub_visits_own on public.uw_hub_visits;
create policy uw_hub_visits_own on public.uw_hub_visits for select to authenticated using (user_id = auth.uid());

-- ───────── Silk ledger ─────────
create table if not exists public.uw_silk_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount int not null check (amount between -100000 and 100000 and amount <> 0),
  reason text not null check (reason in ('hub_visit','event','streak','recruit','photo','grant','spend')),
  ref text not null,
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref)
);
create index if not exists uw_silk_ledger_user on public.uw_silk_ledger (user_id, created_at desc);
create index if not exists uw_silk_ledger_time on public.uw_silk_ledger (created_at desc);
alter table public.uw_silk_ledger enable row level security;
drop policy if exists uw_silk_ledger_own on public.uw_silk_ledger;
create policy uw_silk_ledger_own on public.uw_silk_ledger for select to authenticated using (user_id = auth.uid());

create or replace function public.uw_silk_award(p_user uuid, p_amount int, p_reason text, p_ref text, p_note text default '')
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.uw_silk_ledger (user_id, amount, reason, ref, note, created_by)
  values (p_user, p_amount, p_reason, p_ref, left(coalesce(p_note, ''), 200), auth.uid())
  on conflict (user_id, reason, ref) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.uw_silk_award(uuid, int, text, text, text) from public, anon, authenticated;

-- Consecutive weeks (Mon–Sun, Detroit time) with at least one confirmed hub visit, ending this week or last.
create or replace function public.uw_visit_streak(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  with weeks as (
    select distinct date_trunc('week', day::timestamp)::date as wk from public.uw_hub_visits
    where user_id = p_user and confirmed_at is not null
  ),
  latest as (select max(wk) as m from weeks),
  cur as (select date_trunc('week', (now() at time zone 'America/Detroit'))::date as c)
  select case
    when (select m from latest) is null or (select m from latest) < (select c from cur) - 7 then 0
    else (select count(*)::int from (
            select (select m from latest) - wk as diff, row_number() over (order by wk desc) as rn from weeks
          ) x where x.diff = (x.rn - 1) * 7)
  end
$$;

-- ───────── check-in ─────────
-- p_stage 'start' when you enter a hub world; 'confirm' once you've been there 10+ minutes.
create or replace function public.uw_hub_checkin(p_world_id text, p_stage text default 'start')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'America/Detroit')::date;
  visit_row public.uw_hub_visits%rowtype;
  v_event record;
  v_awards jsonb := '[]'::jsonb;
  v_streak int;
  v_first_of_week boolean;
begin
  if v_user is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.uw_hub_worlds where world_id = p_world_id and active) then
    return jsonb_build_object('status', 'not_hub');
  end if;
  if not exists (select 1 from public.network_connections where user_id = v_user and provider = 'vrchat' and verification_status = 'verified') then
    return jsonb_build_object('status', 'unverified');
  end if;

  insert into public.uw_hub_visits (user_id, day, world_id) values (v_user, v_day, p_world_id)
  on conflict (user_id, day) do nothing;
  select * into visit_row from public.uw_hub_visits where user_id = v_user and day = v_day;

  if p_stage <> 'confirm' then
    return jsonb_build_object('status', case when visit_row.confirmed_at is null then 'started' else 'already' end,
                              'confirm_after', visit_row.first_at + interval '10 minutes');
  end if;
  if visit_row.confirmed_at is not null then
    return jsonb_build_object('status', 'already', 'streak', public.uw_visit_streak(v_user));
  end if;
  if now() < visit_row.first_at + interval '10 minutes' then
    return jsonb_build_object('status', 'too_soon', 'confirm_after', visit_row.first_at + interval '10 minutes');
  end if;

  -- Was a published UnderWeb event on? (30 min before start to its end, or 5 h if no end time)
  select id, title into v_event from public.network_events
  where status = 'published' and cancelled_at is null
    and now() between starts_at - interval '30 minutes' and coalesce(ends_at, starts_at + interval '5 hours')
  order by starts_at limit 1;

  v_first_of_week := not exists (
    select 1 from public.uw_hub_visits where user_id = v_user and confirmed_at is not null
      and date_trunc('week', day::timestamp) = date_trunc('week', v_day::timestamp));

  update public.uw_hub_visits set confirmed_at = now(), event_id = v_event.id where id = visit_row.id;

  if public.uw_silk_award(v_user, 25, 'hub_visit', v_day::text, 'Hub visit') then
    v_awards := v_awards || jsonb_build_object('amount', 25, 'why', 'Hub visit');
  end if;
  if v_event.id is not null and public.uw_silk_award(v_user, 50, 'event', v_event.id::text, left('Event: ' || v_event.title, 200)) then
    v_awards := v_awards || jsonb_build_object('amount', 50, 'why', 'Event: ' || v_event.title);
  end if;
  v_streak := public.uw_visit_streak(v_user);
  if v_first_of_week and v_streak >= 2
     and public.uw_silk_award(v_user, least(50, 10 * v_streak), 'streak', to_char(v_day, 'IYYY-IW'), v_streak || '-week streak') then
    v_awards := v_awards || jsonb_build_object('amount', least(50, 10 * v_streak), 'why', v_streak || '-week streak');
  end if;

  return jsonb_build_object('status', 'checked_in', 'awards', v_awards, 'streak', v_streak,
    'event', v_event.title, 'balance', (select coalesce(sum(amount), 0) from public.uw_silk_ledger where user_id = v_user));
end $$;

-- ───────── your Silk ─────────
create or replace function public.uw_silk_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'balance', coalesce((select sum(amount) from public.uw_silk_ledger where user_id = auth.uid()), 0),
    'week', coalesce((select sum(amount) from public.uw_silk_ledger where user_id = auth.uid() and amount > 0
                      and created_at >= date_trunc('week', now() at time zone 'America/Detroit') at time zone 'America/Detroit'), 0),
    'streak', public.uw_visit_streak(auth.uid()),
    'visits', (select count(*) from public.uw_hub_visits where user_id = auth.uid() and confirmed_at is not null),
    'today', (select jsonb_build_object('first_at', first_at, 'confirmed_at', confirmed_at) from public.uw_hub_visits
              where user_id = auth.uid() and day = (now() at time zone 'America/Detroit')::date),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('event', e.title, 'at', e.starts_at) order by e.starts_at desc)
                        from public.uw_hub_visits v join public.network_events e on e.id = v.event_id
                        where v.user_id = auth.uid() and v.confirmed_at is not null), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r order by r.created_at desc) from (
                        select amount, reason, note, created_at from public.uw_silk_ledger where user_id = auth.uid()
                        order by created_at desc limit 25) r), '[]'::jsonb),
    'worlds', coalesce((select jsonb_agg(jsonb_build_object('world_id', world_id, 'name', name)) from public.uw_hub_worlds where active), '[]'::jsonb)
  )
  where auth.uid() is not null
$$;

-- Weekly leaderboard: Silk earned in the last p_days, people with a public profile only.
create or replace function public.uw_silk_leaderboard(p_days int default 7)
returns table (display_name text, username text, earned bigint, me boolean)
language sql stable security definer set search_path = public as $$
  select p.display_name, p.username, sum(l.amount)::bigint, l.user_id = auth.uid()
  from public.uw_silk_ledger l join public.profiles p on p.id = l.user_id
  where l.amount > 0 and l.created_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
    and (p.public_profile or l.user_id = auth.uid()) and auth.uid() is not null
  group by l.user_id, p.display_name, p.username
  order by 3 desc
  limit 20
$$;

-- Owner / Director: give or take Silk (refunds, prizes, corrections). Always leaves a ledger line.
create or replace function public.uw_silk_grant(p_username text, p_amount int, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if coalesce(public.uw_max_role_rank(auth.uid(), null), 0) < 90 then raise exception 'not_allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'a reason is required'; end if;
  select id into v_user from public.profiles where lower(username) = lower(trim(both '@' from trim(p_username))) limit 1;
  if v_user is null then raise exception 'no UnderWeb account with that username'; end if;
  perform public.uw_silk_award(v_user, p_amount, 'grant', gen_random_uuid()::text, p_note);
  return (select coalesce(sum(amount), 0) from public.uw_silk_ledger where user_id = v_user);
end $$;

-- Recent ledger lines for leadership (who got what).
create or replace function public.uw_silk_recent(p_limit int default 50)
returns table (display_name text, username text, amount int, reason text, note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.display_name, p.username, l.amount, l.reason, l.note, l.created_at
  from public.uw_silk_ledger l left join public.profiles p on p.id = l.user_id
  where coalesce(public.uw_max_role_rank(auth.uid(), null), 0) >= 90
  order by l.created_at desc limit greatest(1, least(p_limit, 200))
$$;

-- ───────── automatic awards from things that already happen ─────────
-- Bring a friend: a verified Road to 500 recruit pays the recruiter.
create or replace function public.uw_silk_on_recruit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    perform public.uw_silk_award(new.recruiter_user_id, 100, 'recruit', new.id::text, left('Recruit: ' || coalesce(new.recruit_name, 'new member'), 200));
  end if;
  return new;
end $$;
drop trigger if exists uw_silk_on_recruit on public.uwx_recruit_claims;
create trigger uw_silk_on_recruit after update on public.uwx_recruit_claims for each row execute function public.uw_silk_on_recruit();

-- Approved photos/work: +10 each, up to 3 a day.
create or replace function public.uw_silk_on_photo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.moderation_status = 'approved' and old.moderation_status is distinct from 'approved'
     and (select count(*) from public.uw_silk_ledger where user_id = new.user_id and reason = 'photo'
          and created_at >= now() - interval '1 day') < 3 then
    perform public.uw_silk_award(new.user_id, 10, 'photo', new.id::text, left('Approved: ' || coalesce(new.title, 'photo'), 200));
  end if;
  return new;
end $$;
drop trigger if exists uw_silk_on_photo on public.creator_showcase;
create trigger uw_silk_on_photo after update on public.creator_showcase for each row execute function public.uw_silk_on_photo();

revoke all on function public.uw_hub_world_set(text, text, boolean) from public, anon;
revoke all on function public.uw_visit_streak(uuid) from public, anon, authenticated;
revoke all on function public.uw_hub_checkin(text, text) from public, anon;
revoke all on function public.uw_silk_summary() from public, anon;
revoke all on function public.uw_silk_leaderboard(int) from public, anon;
revoke all on function public.uw_silk_grant(text, int, text) from public, anon;
revoke all on function public.uw_silk_recent(int) from public, anon;
grant execute on function public.uw_hub_world_set(text, text, boolean), public.uw_hub_checkin(text, text), public.uw_silk_summary(),
  public.uw_silk_leaderboard(int), public.uw_silk_grant(text, int, text), public.uw_silk_recent(int) to authenticated;

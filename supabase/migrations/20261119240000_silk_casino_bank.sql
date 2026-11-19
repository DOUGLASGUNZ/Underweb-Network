-- One Silk balance: the hub casino is the bank, underweb.cloud is the window.
--
-- A VRChat world can only download text, never send it. So:
--   * Casino -> site: the world writes everyone's balance to the VRChat log; UWX reads the log and calls
--     uw_casino_report(). That fills uw_casino_balances (a mirror the site shows).
--   * Site -> casino: Silk earned or spent on the site becomes a numbered transfer in uw_silk_transfers.
--     The silk-bank feed (copied to GitHub Pages, which VRChat trusts) lists them; the world applies every
--     transfer with a number above the one it saved for that player, so nothing is ever applied twice.
-- Every ledger line (check-ins, events, streaks, recruits, photos, grants) turns into a transfer
-- automatically, scaled by website_multiplier so site rewards are worth something next to casino money.
-- Safe to run twice.

-- ───────── settings ─────────
create table if not exists public.uw_silk_bank_config (
  id boolean primary key default true check (id),
  website_multiplier int not null default 1000 check (website_multiplier between 1 and 1000000),
  feed_days int not null default 30 check (feed_days between 7 and 90),
  updated_at timestamptz not null default now()
);
insert into public.uw_silk_bank_config (id) values (true) on conflict (id) do nothing;
alter table public.uw_silk_bank_config enable row level security;
drop policy if exists uw_silk_bank_config_read on public.uw_silk_bank_config;
create policy uw_silk_bank_config_read on public.uw_silk_bank_config for select to authenticated using (true);

create or replace function public.uw_silk_multiplier()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select website_multiplier from public.uw_silk_bank_config where id), 1000)
$$;

-- ───────── transfers the casino applies ─────────
create table if not exists public.uw_silk_transfers (
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount <> 0 and amount between -1000000000000 and 1000000000000),
  source text not null check (source in ('carryover','hub_visit','event','streak','recruit','photo','grant','spend','purchase')),
  ledger_id bigint unique references public.uw_silk_ledger(id) on delete set null,
  note text not null default '' check (char_length(note) <= 80),
  status text not null default 'pending' check (status in ('pending','applied','declined','cancelled')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_world text,
  reported_by uuid references auth.users(id) on delete set null
);
create index if not exists uw_silk_transfers_user on public.uw_silk_transfers (user_id, seq desc);
create index if not exists uw_silk_transfers_feed on public.uw_silk_transfers (status, created_at desc);
alter table public.uw_silk_transfers enable row level security;
drop policy if exists uw_silk_transfers_own on public.uw_silk_transfers;
create policy uw_silk_transfers_own on public.uw_silk_transfers for select to authenticated using (user_id = auth.uid());

-- One-time carry-over of Silk earned on the site before today (before the trigger exists, so no doubles).
insert into public.uw_silk_transfers (user_id, amount, source, note)
select l.user_id, sum(l.amount)::bigint * public.uw_silk_multiplier(), 'carryover', 'Silk earned on the site before the casino link'
from public.uw_silk_ledger l
where not exists (select 1 from public.uw_silk_transfers t where t.user_id = l.user_id and t.source = 'carryover')
group by l.user_id
having sum(l.amount) > 0;

-- From now on every ledger line becomes a transfer.
create or replace function public.uw_silk_ledger_to_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.uw_silk_transfers (user_id, amount, source, ledger_id, note)
  values (new.user_id, new.amount::bigint * public.uw_silk_multiplier(), new.reason, new.id, left(coalesce(new.note, ''), 80))
  on conflict (ledger_id) do nothing;
  return new;
end $$;
drop trigger if exists uw_silk_ledger_to_transfer on public.uw_silk_ledger;
create trigger uw_silk_ledger_to_transfer after insert on public.uw_silk_ledger
  for each row execute function public.uw_silk_ledger_to_transfer();

-- ───────── casino balances, as last seen by UWX ─────────
create table if not exists public.uw_casino_balances (
  vrc_user_id text primary key check (vrc_user_id ~ '^usr_[A-Za-z0-9-]{5,40}$'),
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 64),
  balance bigint not null check (balance >= 0),
  whale_tier smallint not null default 0 check (whale_tier between 0 and 40),
  legacy_level smallint not null default 0 check (legacy_level between 0 and 20),
  last_seq bigint not null default 0 check (last_seq >= 0),
  world_id text not null,
  seen_at timestamptz not null,
  reported_at timestamptz not null default now(),
  reported_by uuid references auth.users(id) on delete set null
);
create index if not exists uw_casino_balances_user on public.uw_casino_balances (user_id);
create index if not exists uw_casino_balances_rank on public.uw_casino_balances (balance desc);
alter table public.uw_casino_balances enable row level security;
drop policy if exists uw_casino_balances_own on public.uw_casino_balances;
create policy uw_casino_balances_own on public.uw_casino_balances for select to authenticated using (user_id = auth.uid());

-- UWX: report the [UWSILK] SNAP lines it read from the log while in a hub world.
-- p_rows: [{vrc_user_id, display_name, balance, whale_tier, legacy_level, last_seq, seen_at, declined: [seq,...]}]
create or replace function public.uw_casino_report(p_world_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_vrc text; v_name text; v_bal numeric; v_seen timestamptz; v_user uuid; v_last bigint;
  n_ok int := 0; n_skip int := 0; n_applied int := 0; n_declined int := 0; k int;
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  if not public.uw_has_network_access() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.uw_hub_worlds where world_id = p_world_id and active) then
    return jsonb_build_object('status', 'not_hub');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'rows must be an array of at most 100';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_vrc  := r->>'vrc_user_id';
      v_name := left(btrim(coalesce(r->>'display_name', '')), 64);
      v_bal  := (r->>'balance')::numeric;
      v_seen := least(now(), coalesce((r->>'seen_at')::timestamptz, now()));
      v_last := greatest(0, coalesce((r->>'last_seq')::bigint, 0));
      if v_vrc !~ '^usr_[A-Za-z0-9-]{5,40}$' or v_name = '' or v_bal is null or v_bal < 0 or v_bal > 9000000000000000000
         or v_seen < now() - interval '6 hours' then
        n_skip := n_skip + 1; continue;
      end if;

      select nc.user_id into v_user from public.network_connections nc
      where nc.provider = 'vrchat' and nc.verification_status = 'verified' and nc.external_id = v_vrc
      limit 1;

      insert into public.uw_casino_balances as b (vrc_user_id, user_id, display_name, balance, whale_tier, legacy_level,
                                                  last_seq, world_id, seen_at, reported_at, reported_by)
      values (v_vrc, v_user, v_name, v_bal::bigint,
              least(40, greatest(0, coalesce((r->>'whale_tier')::int, 0))),
              least(20, greatest(0, coalesce((r->>'legacy_level')::int, 0))),
              v_last, p_world_id, v_seen, now(), auth.uid())
      on conflict (vrc_user_id) do update set
        user_id = coalesce(excluded.user_id, b.user_id), display_name = excluded.display_name, balance = excluded.balance,
        whale_tier = excluded.whale_tier, legacy_level = excluded.legacy_level,
        last_seq = greatest(b.last_seq, excluded.last_seq), world_id = excluded.world_id,
        seen_at = excluded.seen_at, reported_at = now(), reported_by = auth.uid()
      where excluded.seen_at > b.seen_at;
      if not found then n_skip := n_skip + 1; continue; end if;
      n_ok := n_ok + 1;

      if v_user is not null then
        update public.uw_silk_transfers set status = 'declined', applied_at = v_seen, applied_world = p_world_id, reported_by = auth.uid()
        where user_id = v_user and status = 'pending' and amount < 0
          and seq in (select (x)::bigint from jsonb_array_elements_text(coalesce(r->'declined', '[]'::jsonb)) x where x ~ '^[0-9]{1,18}$');
        get diagnostics k = row_count; n_declined := n_declined + k;

        update public.uw_silk_transfers set status = 'applied', applied_at = v_seen, applied_world = p_world_id, reported_by = auth.uid()
        where user_id = v_user and status = 'pending' and seq <= v_last;
        get diagnostics k = row_count; n_applied := n_applied + k;
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
      n_skip := n_skip + 1;
    end;
  end loop;

  return jsonb_build_object('status', 'ok', 'accepted', n_ok, 'skipped', n_skip, 'applied', n_applied, 'declined', n_declined);
end $$;

-- ───────── the feed the world downloads ─────────
-- UWSILK 1
-- # <generated at> <n>
-- seq<TAB>vrc_user_id<TAB>display name<TAB>amount<TAB>note
-- Pending transfers of any age, plus applied/declined ones from the last feed_days (the world skips anything
-- at or below the number it saved, so repeats are harmless). Verified VRChat accounts only.
create or replace function public.uw_silk_feed_text()
returns text language sql stable security definer set search_path = public as $$
  with cfg as (select coalesce((select feed_days from public.uw_silk_bank_config where id), 30) as days),
  rows as (
    select t.seq, nc.external_id as vrc,
           regexp_replace(coalesce(nullif(b.display_name, ''), nullif(nc.display_name, ''), nullif(p.vrc_display_name, ''), p.display_name), '[\t\r\n]+', '', 'g') as name,
           t.amount, regexp_replace(coalesce(nullif(t.note, ''), t.source), '[\t\r\n]+', ' ', 'g') as note
    from public.uw_silk_transfers t
    join public.network_connections nc on nc.user_id = t.user_id and nc.provider = 'vrchat' and nc.verification_status = 'verified'
    left join public.profiles p on p.id = t.user_id
    left join public.uw_casino_balances b on b.vrc_user_id = nc.external_id
    where t.status <> 'cancelled'
      and (t.status = 'pending' or t.created_at > now() - make_interval(days => (select days from cfg)))
  )
  select 'UWSILK 1' || E'\n' || '# ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' ' || (select count(*) from rows)
    || coalesce(E'\n' || (select string_agg(seq || E'\t' || vrc || E'\t' || replace(name, E'\t', ' ') || E'\t' || amount || E'\t' || left(note, 80), E'\n' order by seq) from rows where coalesce(name, '') <> ''), '')
    || E'\n'
$$;

-- ───────── what the site shows ─────────
create or replace function public.uw_casino_overview(p_limit int default 25)
returns jsonb language sql stable security definer set search_path = public as $$
  with live as (
    select b.*, p.username, coalesce(p.public_profile, false) as public_profile
    from public.uw_casino_balances b left join public.profiles p on p.id = b.user_id
    where b.seen_at > now() - interval '60 days'
  )
  select jsonb_build_object(
    'board', coalesce((select jsonb_agg(x order by x.balance desc) from (
        select display_name, case when public_profile then username end as username, balance, whale_tier, legacy_level,
               coalesce(user_id = auth.uid(), false) as me, seen_at
        from live order by balance desc limit greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'whales', coalesce((select jsonb_agg(x order by x.whale_tier desc, x.balance desc) from (
        select display_name, case when public_profile then username end as username, whale_tier, legacy_level, balance,
               coalesce(user_id = auth.uid(), false) as me
        from live where whale_tier > 0) x), '[]'::jsonb),
    'players', (select count(*) from live),
    'updated_at', (select max(reported_at) from live)
  )
  where auth.uid() is not null
$$;

-- Your Silk: the casino balance first, plus what's on its way and how to earn more.
create or replace function public.uw_silk_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid, public.uw_silk_multiplier() as m)
  select jsonb_build_object(
    'multiplier', (select m from me),
    'casino', (select jsonb_build_object('balance', b.balance, 'display_name', b.display_name, 'whale_tier', b.whale_tier,
                                         'legacy_level', b.legacy_level, 'seen_at', b.seen_at)
               from public.uw_casino_balances b where b.user_id = (select uid from me) order by b.seen_at desc limit 1),
    'vrchat_verified', exists (select 1 from public.network_connections where user_id = (select uid from me)
                               and provider = 'vrchat' and verification_status = 'verified'),
    'pending', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0))
                from public.uw_silk_transfers where user_id = (select uid from me) and status = 'pending'),
    'transfers', coalesce((select jsonb_agg(t order by t.seq desc) from (
                  select seq, amount, source, note, status, created_at, applied_at from public.uw_silk_transfers
                  where user_id = (select uid from me) order by seq desc limit 25) t), '[]'::jsonb),
    'week', coalesce((select sum(amount) from public.uw_silk_transfers where user_id = (select uid from me) and amount > 0
                      and source <> 'carryover'
                      and created_at >= date_trunc('week', now() at time zone 'America/Detroit') at time zone 'America/Detroit'), 0),
    -- UWX shows this number: last casino balance seen plus Silk on its way.
    'balance', coalesce((select b.balance from public.uw_casino_balances b where b.user_id = (select uid from me) order by b.seen_at desc limit 1), 0)
               + coalesce((select sum(amount) from public.uw_silk_transfers where user_id = (select uid from me) and status = 'pending'), 0),
    'streak', public.uw_visit_streak((select uid from me)),
    'visits', (select count(*) from public.uw_hub_visits where user_id = (select uid from me) and confirmed_at is not null),
    'today', (select jsonb_build_object('first_at', first_at, 'confirmed_at', confirmed_at) from public.uw_hub_visits
              where user_id = (select uid from me) and day = (now() at time zone 'America/Detroit')::date),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('event', e.title, 'at', e.starts_at) order by e.starts_at desc)
                        from public.uw_hub_visits v join public.network_events e on e.id = v.event_id
                        where v.user_id = (select uid from me) and v.confirmed_at is not null), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r order by r.created_at desc) from (
                        select amount, reason, note, created_at from public.uw_silk_ledger where user_id = (select uid from me)
                        order by created_at desc limit 25) r), '[]'::jsonb),
    'worlds', coalesce((select jsonb_agg(jsonb_build_object('world_id', world_id, 'name', name)) from public.uw_hub_worlds where active), '[]'::jsonb)
  )
  where auth.uid() is not null
$$;

-- Leadership: cancel a transfer the casino hasn't applied yet (a mistaken grant, say).
create or replace function public.uw_silk_cancel_transfer(p_seq bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(public.uw_max_role_rank(auth.uid(), null), 0) < 90 then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.uw_silk_transfers set status = 'cancelled' where seq = p_seq and status = 'pending';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Check-in: same rules, but UWX now shows casino-scale amounts ("+25,000 Silk") and the combined balance.
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
  v_m bigint := public.uw_silk_multiplier();
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

  select id, title into v_event from public.network_events
  where status = 'published' and cancelled_at is null
    and now() between starts_at - interval '30 minutes' and coalesce(ends_at, starts_at + interval '5 hours')
  order by starts_at limit 1;

  v_first_of_week := not exists (
    select 1 from public.uw_hub_visits where user_id = v_user and confirmed_at is not null
      and date_trunc('week', day::timestamp) = date_trunc('week', v_day::timestamp));

  update public.uw_hub_visits set confirmed_at = now(), event_id = v_event.id where id = visit_row.id;

  if public.uw_silk_award(v_user, 25, 'hub_visit', v_day::text, 'Hub visit') then
    v_awards := v_awards || jsonb_build_object('amount', 25 * v_m, 'why', 'Hub visit');
  end if;
  if v_event.id is not null and public.uw_silk_award(v_user, 50, 'event', v_event.id::text, left('Event: ' || v_event.title, 200)) then
    v_awards := v_awards || jsonb_build_object('amount', 50 * v_m, 'why', 'Event: ' || v_event.title);
  end if;
  v_streak := public.uw_visit_streak(v_user);
  if v_first_of_week and v_streak >= 2
     and public.uw_silk_award(v_user, least(50, 10 * v_streak), 'streak', to_char(v_day, 'IYYY-IW'), v_streak || '-week streak') then
    v_awards := v_awards || jsonb_build_object('amount', least(50, 10 * v_streak) * v_m, 'why', v_streak || '-week streak');
  end if;

  return jsonb_build_object('status', 'checked_in', 'awards', v_awards, 'streak', v_streak, 'event', v_event.title,
    'balance', coalesce((select b.balance from public.uw_casino_balances b where b.user_id = v_user order by b.seen_at desc limit 1), 0)
             + coalesce((select sum(amount) from public.uw_silk_transfers where user_id = v_user and status = 'pending'), 0));
end $$;
revoke all on function public.uw_hub_checkin(text, text) from public, anon;
grant execute on function public.uw_hub_checkin(text, text) to authenticated;

-- ───────── permissions ─────────
revoke all on function public.uw_silk_multiplier() from public, anon;
revoke all on function public.uw_silk_ledger_to_transfer() from public, anon, authenticated;
revoke all on function public.uw_casino_report(text, jsonb) from public, anon;
revoke all on function public.uw_silk_feed_text() from public, anon, authenticated;
revoke all on function public.uw_casino_overview(int) from public, anon;
revoke all on function public.uw_silk_summary() from public, anon;
revoke all on function public.uw_silk_cancel_transfer(bigint) from public, anon;
grant execute on function public.uw_silk_multiplier(), public.uw_casino_report(text, jsonb), public.uw_casino_overview(int),
  public.uw_silk_summary(), public.uw_silk_cancel_transfer(bigint) to authenticated;
grant execute on function public.uw_silk_feed_text() to service_role;

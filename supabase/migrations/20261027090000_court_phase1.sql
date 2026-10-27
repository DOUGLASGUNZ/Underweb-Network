-- UnderWeb Court, Phase 1 (guest-capable). FICTIONAL ROLEPLAY ONLY.
-- Kept separate from real moderation: no foreign keys to uwx_* or moderation tables.
-- Every participant is a court_parties row: linked UnderWeb account, Discord identity, or guest.
-- Nothing here references auth.users, so a guest never needs an account and deleting an account never erases court history.
-- Access: RLS is enabled on every table with NO policies for anon or authenticated. All reads and writes go through the
-- `court` edge function (service role). The only anon read is the public reasons list.

-- ---------------------------------------------------------------- reasons (filled from the court library)
create table if not exists public.court_reasons (
  id text primary key check (char_length(id) between 1 and 32),
  text text not null check (char_length(text) between 1 and 200),
  rating smallint not null default 0 check (rating in (0, 1)),    -- 0 PG-13, 1 mature. Adults-only entries are never stored.
  category text not null default 'General' check (char_length(category) <= 40),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- parties
create table if not exists public.court_parties (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('linked', 'discord', 'guest')),
  -- u:<linked user uuid> | d:<discord snowflake> | g:<random 32 hex, one per guest per result>
  ref_key text not null unique check (ref_key ~ '^(u:[0-9a-f-]{36}|d:[0-9]{17,20}|g:[0-9a-f]{32})$'),
  label text not null check (char_length(label) between 1 and 64),  -- a display snapshot. Never used for matching.
  linked_user_id uuid,   -- no FK on purpose: account deletion must not erase court history
  discord_user_id text check (discord_user_id ~ '^[0-9]{17,20}$'),
  accepting_suits boolean not null default true,                    -- "disable courtroom participation" switch
  created_at timestamptz not null default now(),
  check (
    (kind = 'linked'  and linked_user_id is not null and discord_user_id is null and ref_key = 'u:' || linked_user_id::text)
 or (kind = 'discord' and discord_user_id is not null and linked_user_id is null and ref_key = 'd:' || discord_user_id)
 or (kind = 'guest'   and linked_user_id is null and discord_user_id is null and accepting_suits = true)
  )
);
create unique index if not exists court_parties_one_linked on public.court_parties (linked_user_id) where kind = 'linked';

-- ---------------------------------------------------------------- cases
create table if not exists public.court_cases (
  id uuid primary key default gen_random_uuid(),
  case_no bigint generated always as identity unique,
  plaintiff_party_id uuid not null references public.court_parties(id),
  defendant_party_id uuid not null references public.court_parties(id),
  accusation_id text not null references public.court_reasons(id),
  accusation_text text not null check (char_length(accusation_text) between 1 and 200),  -- snapshot at filing
  damages_requested integer not null check (damages_requested between 0 and 50000),
  origin text not null check (origin in ('website', 'discord', 'vrchat_report')),
  reported_by_party_id uuid references public.court_parties(id),   -- the judge who submitted a vrchat_report
  countersuit_of uuid references public.court_cases(id),
  status text not null default 'filed'
    check (status in ('filed', 'accepted', 'declined', 'verdict_guilty', 'verdict_not_guilty', 'dismissed', 'settled')),
  publication text not null default 'private' check (publication in ('private', 'public')),
  publication_approved boolean not null default false,              -- set by a judge, only when both publish consents exist
  poll_closed boolean not null default false,                       -- judge can close the community poll early
  removal_requested boolean not null default false,
  settlement_amount integer check (settlement_amount between 0 and 50000),
  judge_party_id uuid references public.court_parties(id),
  verdict_at timestamptz,
  is_fictional boolean not null default true check (is_fictional),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (plaintiff_party_id <> defendant_party_id),
  check (publication = 'private' or publication_approved),
  check (countersuit_of is null or countersuit_of <> id)
);
-- one open case per plaintiff at a time (a countersuit is a new case where the old defendant is the plaintiff)
create unique index if not exists court_cases_one_open_per_plaintiff
  on public.court_cases (plaintiff_party_id) where status in ('filed', 'accepted');
create index if not exists court_cases_public_idx on public.court_cases (publication, created_at desc);

-- ---------------------------------------------------------------- consents (explicit yes/no, per party, per case)
create table if not exists public.court_consents (
  case_id uuid not null references public.court_cases(id) on delete cascade,
  party_id uuid not null references public.court_parties(id),
  kind text not null check (kind in ('participate', 'publish')),
  granted boolean not null,
  source text not null check (source in ('web', 'discord', 'in_world_result')),
  updated_at timestamptz not null default now(),
  primary key (case_id, party_id, kind)
);

-- ---------------------------------------------------------------- blocks (linked and Discord parties)
create table if not exists public.court_blocks (
  blocker_party_id uuid not null references public.court_parties(id) on delete cascade,
  blocked_party_id uuid not null references public.court_parties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_party_id, blocked_party_id),
  check (blocker_party_id <> blocked_party_id)
);

-- ---------------------------------------------------------------- claims (guest -> account). Separate from parties on purpose.
create table if not exists public.court_claims (
  guest_party_id uuid primary key references public.court_parties(id) on delete cascade,
  case_id uuid not null references public.court_cases(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),   -- HMAC with a server-side pepper. Never the code.
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  used_at timestamptz,
  claimant_party_id uuid references public.court_parties(id),
  check ((used_at is null) = (claimant_party_id is null))
);
create index if not exists court_claims_case_open on public.court_claims (case_id) where used_at is null;

-- ---------------------------------------------------------------- community poll (Discord only, separate from the jury)
create table if not exists public.court_community_votes (
  case_id uuid not null references public.court_cases(id) on delete cascade,
  voter_party_id uuid not null references public.court_parties(id),
  choice text not null check (choice in ('guilty', 'not_guilty')),
  changes integer not null default 0 check (changes between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (case_id, voter_party_id)
);

-- ---------------------------------------------------------------- official verdicts and settlements
create table if not exists public.court_verdicts (
  case_id uuid primary key references public.court_cases(id) on delete cascade,
  judge_party_id uuid not null references public.court_parties(id),
  verdict text not null check (verdict in ('guilty', 'not_guilty', 'dismissed', 'settled')),
  jury_guilty integer check (jury_guilty between 0 and 999),
  jury_not_guilty integer check (jury_not_guilty between 0 and 999),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- exported results (audit trail for in-world trials)
create table if not exists public.court_submissions (
  id uuid primary key default gen_random_uuid(),
  judge_party_id uuid not null references public.court_parties(id),
  local_ref text not null check (local_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  payload jsonb not null,
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  case_id uuid references public.court_cases(id),
  created_at timestamptz not null default now(),
  unique (judge_party_id, local_ref)
);

-- ---------------------------------------------------------------- fictional exhibits (website cases; generated once)
create table if not exists public.court_evidence (
  case_id uuid not null references public.court_cases(id) on delete cascade,
  slot smallint not null check (slot between 1 and 6),
  kind text not null check (kind in ('chat_log', 'witness_statement', 'incident_report', 'defense', 'surprise')),
  title text not null,
  body text not null check (char_length(body) <= 2000),
  label text not null default 'FICTIONAL ROLEPLAY EXHIBIT',
  primary key (case_id, slot)
);

-- ---------------------------------------------------------------- Discord posts queue (poll, verdict, settlement)
create table if not exists public.court_announcements (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.court_cases(id) on delete cascade,
  kind text not null check (kind in ('poll', 'verdict', 'settlement')),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  message_id text check (message_id ~ '^[0-9]{17,20}$'),
  unique (case_id, kind)
);

-- ---------------------------------------------------------------- rate limiting
create table if not exists public.court_rate_limits (
  bucket text primary key check (char_length(bucket) <= 120),
  window_start timestamptz not null,
  hits integer not null default 0
);

-- ---------------------------------------------------------------- row level security: deny by default
alter table public.court_reasons enable row level security;
alter table public.court_parties enable row level security;
alter table public.court_cases enable row level security;
alter table public.court_consents enable row level security;
alter table public.court_blocks enable row level security;
alter table public.court_claims enable row level security;
alter table public.court_community_votes enable row level security;
alter table public.court_verdicts enable row level security;
alter table public.court_submissions enable row level security;
alter table public.court_evidence enable row level security;
alter table public.court_announcements enable row level security;
alter table public.court_rate_limits enable row level security;

create policy court_reasons_public_read on public.court_reasons for select to anon, authenticated using (enabled);

-- Court tables only. (Do not touch other tables in this schema.)
grant select on public.court_reasons to anon, authenticated;
revoke all on public.court_parties, public.court_cases, public.court_consents, public.court_blocks, public.court_claims,
  public.court_community_votes, public.court_verdicts, public.court_submissions, public.court_evidence,
  public.court_announcements, public.court_rate_limits from anon, authenticated;

-- ---------------------------------------------------------------- SQL helpers (service role only)
-- Worker check: the same bot credential check the Verify flow uses.
create or replace function public.court_worker_ok(p_token_hash text, p_guild text)
returns boolean language sql stable security definer set search_path = '' as $$
  select uw_discord.worker_ok(p_token_hash, p_guild)
$$;

-- Fixed-window rate limit. Returns true while the caller is within the limit.
create or replace function public.court_rate_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hits integer;
begin
  insert into public.court_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Atomic claim redemption. Locks the case, checks the code against the open claims, and marks it used once.
-- Wrong codes count against every open claim on the case; five misses lock them until a judge reissues.
create or replace function public.court_redeem_claim(p_case_no bigint, p_code_hash text, p_claimant_party uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_case_id uuid;
  v_claim public.court_claims%rowtype;
begin
  select c.id into v_case_id from public.court_cases c where c.case_no = p_case_no for update;
  if v_case_id is null then return jsonb_build_object('ok', false, 'error', 'WRONG_CODE'); end if;

  select * into v_claim from public.court_claims cl
   where cl.case_id = v_case_id and cl.used_at is null and cl.code_hash = p_code_hash
   for update;

  if not found then
    update public.court_claims set attempts = attempts + 1 where case_id = v_case_id and used_at is null;
    return jsonb_build_object('ok', false, 'error', 'WRONG_CODE');
  end if;
  if v_claim.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'LOCKED'); end if;
  if v_claim.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'EXPIRED'); end if;

  update public.court_claims set used_at = now(), claimant_party_id = p_claimant_party
   where guest_party_id = v_claim.guest_party_id;
  return jsonb_build_object('ok', true, 'guest_party_id', v_claim.guest_party_id);
end $$;

revoke all on function public.court_worker_ok(text, text) from public, anon, authenticated;
revoke all on function public.court_rate_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.court_redeem_claim(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.court_worker_ok(text, text) to service_role;
grant execute on function public.court_rate_hit(text, integer, integer) to service_role;
grant execute on function public.court_redeem_claim(bigint, text, uuid) to service_role;

-- Patreon supporters (2026-10-20)
-- Patreon tells the `supporters` edge function about pledges (webhook) and the Owner can pull the
-- full list on demand. Each patron is kept here so they can be matched to an UnderWeb account later
-- (by the Discord they linked on Patreon, or the same email). A matched, active patron gets an
-- inner_web_memberships row (provider 'patreon'), which is what UWX updates check.
--
-- Only the server (service role) reads or writes this table: no policies are granted to members.

create table if not exists public.patreon_members (
    member_id        text primary key,               -- Patreon member id
    patreon_user_id  text,
    full_name        text,
    email            text,                           -- for account matching only; never shown publicly
    discord_user_id  text,                           -- from the patron's Patreon → Discord connection
    patron_status    text,                           -- active_patron | declined_patron | former_patron | null
    tier_titles      text[] not null default '{}',
    entitled_cents   integer not null default 0,
    matched_user_id  uuid references auth.users(id) on delete set null,
    last_event       text,
    updated_at       timestamptz not null default now()
);

create index if not exists patreon_members_discord_idx on public.patreon_members (discord_user_id);
create index if not exists patreon_members_email_idx on public.patreon_members (lower(email));
create index if not exists patreon_members_matched_idx on public.patreon_members (matched_user_id);

alter table public.patreon_members enable row level security;
revoke all on public.patreon_members from anon, authenticated;

comment on table public.patreon_members is
    'Patreon patrons as reported by Patreon (webhook / owner sync). Server-only; matched to accounts for UWX access.';

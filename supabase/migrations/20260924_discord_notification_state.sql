-- Durable state for the single UnderWeb Discord bot process.
-- The service-role credential is used only by the bot and never by the website.
create table if not exists public.discord_notification_state (
  id text primary key,
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint discord_notification_state_revision_positive check (revision > 0)
);

alter table public.discord_notification_state enable row level security;
revoke all on public.discord_notification_state from public, anon, authenticated;
grant select, insert, update on public.discord_notification_state to service_role;
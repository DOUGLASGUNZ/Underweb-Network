-- Apply through the UnderWeb Supabase SQL editor before testing saved Signal
-- details on the draft website branch. No change to existing event RPCs,
-- event columns, approval rules, or Discord publishing.
begin;

create table if not exists public.network_event_signals (
  event_id uuid primary key references public.network_events(id) on delete cascade,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- The event creator reads and writes via the narrowly scoped functions below.
-- Do not expose saved instance URLs via the public network_events API.
alter table public.network_event_signals enable row level security;
revoke all on public.network_event_signals from public, anon, authenticated;

create or replace function public.uw_event_signal_ready()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before saving Signal details' using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function public.uw_get_event_signal(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.network_events
    where id = p_event_id and created_by = auth.uid()
  ) then
    raise exception 'Event not available to this account' using errcode = '42501';
  end if;
  select details into result from public.network_event_signals
  where event_id = p_event_id;
  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.uw_save_event_signal(p_event_id uuid, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  field text;
  field_value text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.network_events
    where id = p_event_id and created_by = auth.uid() and status = 'pending'
  ) then
    raise exception 'Only the creator can edit a pending event Signal' using errcode = '42501';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Signal details must be an object' using errcode = '22023';
  end if;
  for field, field_value in select key, value from jsonb_each_text(p_details) loop
    if field not in ('host', 'partner', 'doors', 'platform', 'genres',
                     'performers', 'groupUrl', 'eventUrl', 'instanceUrl')
       or jsonb_typeof(p_details -> field) <> 'string'
       or length(field_value) > case when field = 'performers' then 3000 else 2048 end
    then
      raise exception 'Invalid Signal detail: %', field using errcode = '22023';
    end if;
  end loop;
  insert into public.network_event_signals (event_id, details, updated_at)
  values (p_event_id, p_details, now())
  on conflict (event_id) do update
    set details = excluded.details, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.uw_event_signal_ready() from public, anon;
revoke all on function public.uw_get_event_signal(uuid) from public, anon;
revoke all on function public.uw_save_event_signal(uuid, jsonb) from public, anon;
grant execute on function public.uw_event_signal_ready() to authenticated;
grant execute on function public.uw_get_event_signal(uuid) to authenticated;
grant execute on function public.uw_save_event_signal(uuid, jsonb) to authenticated;

commit;
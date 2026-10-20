-- Project Blackscreen (UnderWeb Cinema) phase 1: a catalog that keeps metadata-only listings apart from
-- authorized, verified, playable media. File URLs never leave the server: the world gets a slot number and plays
-- https://.../functions/v1/blackscreen/s/NNN, which redirects only while the entry is authorized + verified.
-- (Applied to production Oct 20 2026.)
create table if not exists public.cinema_titles (
  id            serial primary key,
  kind          text not null default 'movie' check (kind in ('movie','tv','episode')),
  parent_id     int references public.cinema_titles(id) on delete cascade,
  season        int,
  episode       int,
  title         text not null check (length(title) between 1 and 160),
  year          int check (year between 1870 and 2100),
  category      text not null default 'Other',
  synopsis      text not null default '',
  runtime_min   int,
  slot          int unique check (slot between 0 and 999),
  file_url      text check (file_url is null or file_url ~ '^https://'),
  rights_basis  text check (rights_basis in ('public_domain','creative_commons','owned_original','licensed','creator_permission')),
  rights_note   text not null default '',
  verified_ok   boolean not null default false,
  verified_at   timestamptz,
  verify_note   text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind <> 'episode' or parent_id is not null),
  check ((slot is null) = (file_url is null)),
  check (file_url is null or rights_basis is not null)
);
create index if not exists cinema_titles_parent on public.cinema_titles(parent_id);
alter table public.cinema_titles enable row level security;

create or replace function public.blackscreen_status(t public.cinema_titles) returns text language sql stable as $$
  select case
    when t.file_url is null or t.rights_basis is null then 'I'
    when t.verified_ok and t.verified_at > now() - interval '7 days' then 'P'
    else 'U' end
$$;

create or replace function public.blackscreen_feed() returns text language sql stable security definer set search_path = public as $$
  with rows as (
    select t.*, public.blackscreen_status(t) as st from public.cinema_titles t where t.active
  )
  select 'BLACKSCREEN 1' || E'\t' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || E'\t' || count(*)::text
      || coalesce(E'\n' || string_agg(
           id::text || E'\t' || kind || E'\t' || coalesce(parent_id::text,'') || E'\t' || coalesce(season::text,'') || E'\t' || coalesce(episode::text,'')
           || E'\t' || regexp_replace(title, '[\t\r\n]', ' ', 'g') || E'\t' || coalesce(year::text,'')
           || E'\t' || regexp_replace(category, '[\t\r\n]', ' ', 'g') || E'\t' || coalesce(runtime_min::text,'')
           || E'\t' || st || E'\t' || case when st = 'I' then '' else slot::text end
           || E'\t' || coalesce(rights_basis,'')
           || E'\t' || left(regexp_replace(synopsis, '[\t\r\n]+', ' ', 'g'), 300),
           E'\n' order by coalesce(parent_id, id), coalesce(season,0), coalesce(episode,0), id), '')
  from rows
$$;
revoke all on function public.blackscreen_feed() from public, anon, authenticated;
grant execute on function public.blackscreen_feed() to service_role;
revoke all on function public.blackscreen_status(public.cinema_titles) from public, anon, authenticated;
grant execute on function public.blackscreen_status(public.cinema_titles) to service_role;

-- World Media Manager
-- Lets UnderWeb leadership upload images on underweb.cloud and publish them to
-- poster / billboard / frame / screen slots inside VRChat worlds.
--
-- Flow: originals go to the private `world-media` bucket → an assignment links an
-- image to a slot (optionally scheduled) → the `world-media-publish` edge function
-- copies whatever is currently due into a GitHub Pages repo at a FIXED address per
-- slot (VRChat only loads images from allow-listed hosts like *.github.io, and a
-- world can't build URLs at runtime). The world downloads those fixed addresses.

-- Who may manage world media: admin rank and above (owner, director, admin).
create or replace function public.uw_can_manage_world_media()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(public.uw_max_role_rank() >= 80, false) and public.uw_has_network_access();
$$;
revoke execute on function public.uw_can_manage_world_media() from public, anon;
grant execute on function public.uw_can_manage_world_media() to authenticated;

create table if not exists public.world_media_worlds (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
    name text not null check (length(btrim(name)) between 1 and 80),
    vrchat_world_id text check (vrchat_world_id is null or vrchat_world_id ~ '^wrld_[0-9a-f-]{36}$'),
    created_by uuid references auth.users(id) default auth.uid(),
    created_at timestamptz not null default now()
);

create table if not exists public.world_media_slots (
    id uuid primary key default gen_random_uuid(),
    world_id uuid not null references public.world_media_worlds(id) on delete cascade,
    slot_key text not null check (slot_key ~ '^[A-Z0-9][A-Z0-9_]{1,47}$'),
    label text not null default '',
    room text not null default '',
    kind text not null default 'single' check (kind in ('single', 'gallery')),
    gallery_size int not null default 1 check (gallery_size between 1 and 20),
    rotate_seconds int not null default 12 check (rotate_seconds between 3 and 600),
    aspect_w int not null default 16 check (aspect_w between 1 and 64),
    aspect_h int not null default 9 check (aspect_h between 1 and 64),
    max_px int not null default 2048 check (max_px between 256 and 2048),
    sort_order int not null default 0,
    created_at timestamptz not null default now(),
    unique (world_id, slot_key)
);

create table if not exists public.world_media_assets (
    id uuid primary key default gen_random_uuid(),
    storage_path text not null unique,
    title text not null default '',
    category text not null default 'other'
        check (category in ('group', 'avatar', 'shader', 'event', 'creator', 'announcement', 'artwork', 'other')),
    width int,
    height int,
    bytes int,
    uploaded_by uuid references auth.users(id) default auth.uid(),
    created_at timestamptz not null default now(),
    archived boolean not null default false
);

-- Every assignment is kept (history + revert). "Current" = the newest assignment
-- for a slot+position whose schedule window contains now and isn't unpublished.
create table if not exists public.world_media_assignments (
    id uuid primary key default gen_random_uuid(),
    slot_id uuid not null references public.world_media_slots(id) on delete cascade,
    asset_id uuid not null references public.world_media_assets(id) on delete restrict,
    position int not null default 1 check (position between 1 and 20),
    caption text not null default '' check (length(caption) <= 120),
    starts_at timestamptz,
    ends_at timestamptz,
    unpublished_at timestamptz,
    created_by uuid references auth.users(id) default auth.uid(),
    created_at timestamptz not null default now(),
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists world_media_assignments_slot_idx on public.world_media_assignments (slot_id, position, created_at desc);

create table if not exists public.world_media_publish_log (
    id uuid primary key default gen_random_uuid(),
    actor uuid references auth.users(id) default auth.uid(),
    action text not null,
    world_id uuid references public.world_media_worlds(id) on delete set null,
    slot_id uuid references public.world_media_slots(id) on delete set null,
    asset_id uuid references public.world_media_assets(id) on delete set null,
    detail jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.world_media_worlds enable row level security;
alter table public.world_media_slots enable row level security;
alter table public.world_media_assets enable row level security;
alter table public.world_media_assignments enable row level security;
alter table public.world_media_publish_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['world_media_worlds','world_media_slots','world_media_assets','world_media_assignments'] loop
    execute format('drop policy if exists "%1$s manage" on public.%1$s', t);
    execute format('create policy "%1$s manage" on public.%1$s for all to authenticated using (public.uw_can_manage_world_media()) with check (public.uw_can_manage_world_media())', t);
  end loop;
end $$;

drop policy if exists "world_media_publish_log read" on public.world_media_publish_log;
create policy "world_media_publish_log read" on public.world_media_publish_log
    for select to authenticated using (public.uw_can_manage_world_media());
drop policy if exists "world_media_publish_log insert" on public.world_media_publish_log;
create policy "world_media_publish_log insert" on public.world_media_publish_log
    for insert to authenticated with check (public.uw_can_manage_world_media() and actor = auth.uid());

-- Private bucket for originals. Public copies only ever exist on the GitHub Pages
-- host after an explicit Publish.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('world-media', 'world-media', false, 20971520, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "world-media managers read" on storage.objects;
create policy "world-media managers read" on storage.objects
    for select to authenticated using (bucket_id = 'world-media' and public.uw_can_manage_world_media());
drop policy if exists "world-media managers write" on storage.objects;
create policy "world-media managers write" on storage.objects
    for insert to authenticated with check (bucket_id = 'world-media' and public.uw_can_manage_world_media());
drop policy if exists "world-media managers delete" on storage.objects;
create policy "world-media managers delete" on storage.objects
    for delete to authenticated using (bucket_id = 'world-media' and public.uw_can_manage_world_media());

-- What each slot should show right now (used by the publisher and the dashboard).
create or replace view public.world_media_current
with (security_invoker = true) as
select distinct on (a.slot_id, a.position)
    a.slot_id, a.position, a.asset_id, a.caption, a.id as assignment_id, a.starts_at, a.ends_at, a.created_at
from public.world_media_assignments a
where a.unpublished_at is null
  and (a.starts_at is null or a.starts_at <= now())
  and (a.ends_at is null or a.ends_at > now())
order by a.slot_id, a.position, a.created_at desc;

-- What the publisher last put on the public host (written only by the edge function
-- with the service role; managers can read it to show "live" vs "draft").
create table if not exists public.world_media_published (
    slot_id uuid not null references public.world_media_slots(id) on delete cascade,
    position int not null,
    asset_id uuid not null references public.world_media_assets(id) on delete cascade,
    commit_sha text,
    published_at timestamptz not null default now(),
    primary key (slot_id, position)
);
alter table public.world_media_published enable row level security;
drop policy if exists "world_media_published read" on public.world_media_published;
create policy "world_media_published read" on public.world_media_published
    for select to authenticated using (public.uw_can_manage_world_media());

-- Optional: apply schedules automatically every 15 minutes. Requires pg_cron + pg_net
-- and the WORLD_MEDIA_CRON_SECRET edge secret; run once by hand after filling in the secret.
-- select cron.schedule('world-media-schedule', '*/15 * * * *', $$
--   select net.http_post(
--     url := 'https://pxipclkptxpqukefwexh.supabase.co/functions/v1/world-media-publish',
--     headers := jsonb_build_object('Content-Type','application/json','x-world-media-cron','<WORLD_MEDIA_CRON_SECRET>'),
--     body := '{}'::jsonb);
-- $$);

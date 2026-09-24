-- Explicit public announcements from the UnderWeb website.
-- Existing staff_announcements remain internal and are not copied into this feed.
-- The browser uses its authenticated Supabase session; no service-role key is sent.

create table if not exists public.website_public_announcement_publications (
  id uuid primary key default gen_random_uuid(),
  announcement_key uuid not null unique,
  activity_id uuid unique references public.network_activity(id),
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now()
);

alter table public.website_public_announcement_publications enable row level security;
revoke all on public.website_public_announcement_publications from public, anon, authenticated;

create or replace function public.publish_public_announcement(
  p_announcement_key uuid,
  p_title text,
  p_body text,
  p_public_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  publication_id uuid;
  existing_activity_id uuid;
  new_activity_id uuid;
  announcement_body text;
begin
  -- The website only permits active Owner, Director, or Admin roles.
  -- The database repeats this check because client-side visibility is not security.
  if auth.role() is distinct from 'service_role' and not exists (
    select 1
    from public.user_roles ur
    join public.role_definitions rd on rd.slug = ur.role_slug
    where ur.user_id = auth.uid()
      and ur.status = 'active'
      and rd.active = true
      and rd.slug in ('owner', 'director', 'admin')
  ) then
    raise exception 'Only active UnderWeb admins can publish public announcements'
      using errcode = '42501';
  end if;

  if p_announcement_key is null then
    raise exception 'Announcement idempotency key is required';
  end if;
  if nullif(trim(p_title), '') is null or length(trim(p_title)) > 240 then
    raise exception 'Announcement title must be 1-240 characters';
  end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 3300 then
    raise exception 'Announcement body must be 1-3300 characters';
  end if;
  if nullif(trim(coalesce(p_public_url, '')), '') is not null and
     (length(trim(p_public_url)) > 500 or
      trim(p_public_url) !~ '^https://(www\.)?underweb\.cloud(/|$)') then
    raise exception 'Announcement URL must be an UnderWeb HTTPS link';
  end if;

  insert into public.website_public_announcement_publications (
    announcement_key, published_by
  )
  values (
    p_announcement_key, auth.uid()
  )
  on conflict (announcement_key) do nothing
  returning id into publication_id;

  if publication_id is null then
    select publication.activity_id
      into existing_activity_id
      from public.website_public_announcement_publications publication
     where publication.announcement_key = p_announcement_key;
    if existing_activity_id is null then
      raise exception 'Existing announcement has no activity event; contact an administrator';
    end if;
    return existing_activity_id;
  end if;

  announcement_body := trim(p_body);
  if nullif(trim(coalesce(p_public_url, '')), '') is not null then
    announcement_body := announcement_body || E'\n\n' || trim(p_public_url);
  end if;

  insert into public.network_activity (
    user_id, kind, title, body, object_type, object_id, public
  )
  values (
    auth.uid(), 'website_announcement', trim(p_title), announcement_body,
    'website_announcement', publication_id, true
  )
  returning id into new_activity_id;

  update public.website_public_announcement_publications
     set activity_id = new_activity_id
   where id = publication_id;

  return new_activity_id;
end;
$$;

revoke all on function public.publish_public_announcement(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.publish_public_announcement(uuid, text, text, text)
  to authenticated, service_role;
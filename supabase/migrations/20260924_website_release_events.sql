-- Review and apply through the normal UnderWeb Supabase migration process.
-- Do not expose the service-role key in the website browser.
-- network_activity.object_id is UUID in the live website schema, so a release
-- gets its own stable UUID while release_key remains human-readable and unique.

create table if not exists public.website_release_publications (
  id uuid primary key default gen_random_uuid(),
  release_key text not null unique,
  activity_id uuid unique references public.network_activity(id),
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now()
);

alter table public.website_release_publications enable row level security;
revoke all on public.website_release_publications from public, anon, authenticated;

create or replace function public.publish_website_release(
  p_release_key text,
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
  release_id uuid;
  existing_activity_id uuid;
  new_activity_id uuid;
  release_body text;
begin
  -- The website calls this as an authenticated Owner, Director, or Admin.
  -- Server-side automation may call it as service_role. Staff-only posts never
  -- reach this function unless an authorized admin explicitly publishes them.
  if auth.role() is distinct from 'service_role' and not exists (
    select 1
    from public.user_roles ur
    join public.role_definitions rd on rd.slug = ur.role_slug
    where ur.user_id = auth.uid()
      and ur.status = 'active'
      and rd.active = true
      and rd.slug in ('owner', 'director', 'admin')
  ) then
    raise exception 'Only active UnderWeb admins can publish releases'
      using errcode = '42501';
  end if;

  if p_release_key is null or trim(p_release_key) !~ '^[a-z0-9][a-z0-9._-]{0,79}$' then
    raise exception 'Use a lowercase release key (letters, digits, dot, dash, underscore; max 80)';
  end if;
  if nullif(trim(p_title), '') is null or length(trim(p_title)) > 240 then
    raise exception 'Release title must be 1-240 characters';
  end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 3300 then
    raise exception 'Release body must be 1-3300 characters';
  end if;
  if nullif(trim(coalesce(p_public_url, '')), '') is not null and
     (length(trim(p_public_url)) > 500 or
      trim(p_public_url) !~ '^https://(www\.)?underweb\.cloud(/|$)') then
    raise exception 'Release URL must be an UnderWeb HTTPS link';
  end if;

  insert into public.website_release_publications (release_key, published_by)
  values (trim(p_release_key), auth.uid())
  on conflict (release_key) do nothing
  returning id into release_id;

  if release_id is null then
    select wr.activity_id into existing_activity_id
    from public.website_release_publications wr
    where wr.release_key = trim(p_release_key);
    if existing_activity_id is null then
      raise exception 'Existing release has no activity event; contact an administrator';
    end if;
    return existing_activity_id;
  end if;

  -- Keep the editorial release key with the public activity event so the bot
  -- can match it to a GitHub tag without guessing from prose or a UUID.
  release_body := 'Release key: ' || trim(p_release_key) || E'\n\n' || trim(p_body);
  if nullif(trim(coalesce(p_public_url, '')), '') is not null then
    release_body := release_body || E'\n\n' || trim(p_public_url);
  end if;

  insert into public.network_activity (
    user_id, kind, title, body, object_type, object_id, public
  )
  values (
    auth.uid(), 'website_release', trim(p_title), release_body,
    'website_release', release_id, true
  )
  returning id into new_activity_id;

  update public.website_release_publications
  set activity_id = new_activity_id
  where id = release_id;

  return new_activity_id;
end;
$$;

revoke all on function public.publish_website_release(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.publish_website_release(text, text, text, text)
  to authenticated, service_role;
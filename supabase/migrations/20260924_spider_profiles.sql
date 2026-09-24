-- REVIEW ONLY. Apply to the existing UnderWeb Supabase project in its SQL editor
-- before enabling bot mirroring or merging the website pull request.
-- This does not move the bot's existing local cooldown/event/roulette state.

create table if not exists public.discord_spider_collections (
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  collection jsonb not null default '{}'::jsonb check (jsonb_typeof(collection) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (guild_id, discord_user_id)
);

create table if not exists public.spider_profile_showcases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  spider_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.discord_spider_collections enable row level security;
alter table public.spider_profile_showcases enable row level security;
revoke all on public.discord_spider_collections from public, anon, authenticated;
revoke all on public.spider_profile_showcases from public, anon, authenticated;
grant select, insert, update on public.discord_spider_collections to service_role;
grant select, insert, update on public.spider_profile_showcases to service_role;

-- Direct profile updates must not let a browser impersonate another Discord ID.
-- Existing redeem_discord_link_token(text) is SECURITY DEFINER; the trigger
-- runs with its owner as current_user during redemption, but with authenticated
-- as current_user for a direct browser update. Review any other privileged
-- profile-writing functions before applying this guard.
create or replace function public.uw_guard_discord_link_column()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_redeem_owner text;
begin
  select pg_get_userbyid(proowner) into v_redeem_owner
    from pg_proc
    where oid = 'public.redeem_discord_link_token(text)'::regprocedure;
  if old.discord_user_id is distinct from new.discord_user_id and
     auth.role() is distinct from 'service_role' and
     (v_redeem_owner is null or current_user <> v_redeem_owner) then
    raise exception 'Discord links must be changed through the verified link flow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.uw_guard_discord_link_column() from public, anon, authenticated;
drop trigger if exists uw_guard_discord_link_column on public.profiles;
create trigger uw_guard_discord_link_column
  before update of discord_user_id on public.profiles
  for each row execute function public.uw_guard_discord_link_column();

-- Monotonic merge: a stale mirror writer can never reduce a newer count.
create or replace function public.uw_spider_max_counts(p_existing jsonb, p_incoming jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(spider_id, maximum), '{}'::jsonb)
  from (
    select item.key as spider_id, max((item.value #>> '{}')::bigint) as maximum
    from (
      select * from jsonb_each(p_existing)
      union all
      select * from jsonb_each(p_incoming)
    ) item
    group by item.key
  ) totals;
$$;
revoke all on function public.uw_spider_max_counts(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.uw_merge_spider_collections(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_collection jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the UnderWeb bot can sync spider collections'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Expected an array of spider collections';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Expected one to one hundred spider collections';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_collection := v_row -> 'collection';
    if coalesce(v_row ->> 'guild_id', '') !~ '^[0-9]{17,20}$' or
       coalesce(v_row ->> 'discord_user_id', '') !~ '^[0-9]{17,20}$' or
       jsonb_typeof(v_collection) is distinct from 'object' then
      raise exception 'Invalid spider collection row';
    end if;
    if exists (
         select 1 from jsonb_each(v_collection) item
         where item.key <> all(array[
           'dustling','cable','pocket','server','glitch','hexbyte','static',
           'neon','chrome','spring','summer','autumn','winter','null','ceo'
         ])
           or (item.value #>> '{}') !~ '^[1-9][0-9]{0,15}$'
       ) then
      raise exception 'Invalid spider collection row';
    end if;
    insert into public.discord_spider_collections
      (guild_id, discord_user_id, collection, updated_at)
    values
      (v_row ->> 'guild_id', v_row ->> 'discord_user_id', v_collection, now())
    on conflict (guild_id, discord_user_id) do update
      set collection = public.uw_spider_max_counts(
        public.discord_spider_collections.collection, excluded.collection
      ),
      updated_at = now();
  end loop;
end;
$$;
revoke all on function public.uw_merge_spider_collections(jsonb) from public, anon, authenticated;
grant execute on function public.uw_merge_spider_collections(jsonb) to service_role;

-- Internal helper: never grant this by Discord ID to a browser role.
create or replace function public.uw_spider_owned_counts(p_discord_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(spider_id, total), '{}'::jsonb)
  from (
    select item.key as spider_id,
           sum(case when (item.value #>> '{}') ~ '^[0-9]{1,8}$'
                    then (item.value #>> '{}')::bigint else 0 end) as total
    from public.discord_spider_collections c
    cross join lateral jsonb_each(c.collection) item
    where c.discord_user_id = p_discord_id
      and item.key = any(array[
        'dustling','cable','pocket','server','glitch','hexbyte','static',
        'neon','chrome','spring','summer','autumn','winter','null','ceo'
      ])
    group by item.key
  ) totals
  where total > 0;
$$;
revoke all on function public.uw_spider_owned_counts(text) from public, anon, authenticated;

create or replace function public.uw_my_spiders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_discord text;
  v_owned jsonb := '{}'::jsonb;
  v_enabled boolean := false;
  v_ids text[] := '{}'::text[];
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your spiders' using errcode = '42501';
  end if;
  select discord_user_id into v_discord from public.profiles where id = auth.uid();
  if v_discord is not null then
    v_owned := public.uw_spider_owned_counts(v_discord);
    select enabled, spider_ids into v_enabled, v_ids
      from public.spider_profile_showcases where user_id = auth.uid();
  end if;
  return jsonb_build_object(
    'linked', v_discord is not null,
    'collection', v_owned,
    'showcase_enabled', coalesce(v_enabled, false),
    'showcase_ids', coalesce(to_jsonb(v_ids), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.uw_my_spiders() from public, anon;
grant execute on function public.uw_my_spiders() to authenticated;

create or replace function public.uw_set_spider_showcase(p_enabled boolean, p_spider_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discord text;
  v_owned jsonb;
  v_ids text[] := coalesce(p_spider_ids, '{}'::text[]);
  v_id text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to edit your showcase' using errcode = '42501';
  end if;
  select discord_user_id into v_discord from public.profiles where id = auth.uid();
  if v_discord is null then
    raise exception 'Link a Discord account before showcasing spiders';
  end if;
  if cardinality(v_ids) > 3 or array_position(v_ids, null) is not null or
     (select count(distinct x) from unnest(v_ids) as x) <> cardinality(v_ids) or
     (coalesce(p_enabled, false) and cardinality(v_ids) = 0) then
    raise exception 'Choose one to three distinct rare spiders to show';
  end if;
  v_owned := public.uw_spider_owned_counts(v_discord);
  foreach v_id in array v_ids loop
    if v_id <> all(array['neon','chrome','spring','summer','autumn','winter','null','ceo'])
       or not (v_owned ? v_id) then
      raise exception 'Only your own shiny, seasonal, or absurdly rare spiders can be shown';
    end if;
  end loop;

  insert into public.spider_profile_showcases (user_id, enabled, spider_ids, updated_at)
    values (auth.uid(), coalesce(p_enabled, false), v_ids, now())
    on conflict (user_id) do update
      set enabled = excluded.enabled,
          spider_ids = excluded.spider_ids,
          updated_at = excluded.updated_at;
  return public.uw_my_spiders();
end;
$$;
revoke all on function public.uw_set_spider_showcase(boolean, text[]) from public, anon;
grant execute on function public.uw_set_spider_showcase(boolean, text[]) to authenticated;

create or replace function public.uw_public_spiders(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_discord text;
  v_ids text[];
  v_owned jsonb;
  v_selected jsonb;
begin
  select p.discord_user_id, sc.spider_ids into v_discord, v_ids
    from public.profiles p
    join public.spider_profile_showcases sc on sc.user_id = p.id
    where p.id = p_user_id and p.public_profile is true and sc.enabled is true;
  if v_discord is null then
    return jsonb_build_object('spiders', '[]'::jsonb);
  end if;
  v_owned := public.uw_spider_owned_counts(v_discord);
  select coalesce(jsonb_agg(
    jsonb_build_object('id', spider_id, 'count', (v_owned ->> spider_id)::bigint)
  ), '[]'::jsonb) into v_selected
    from unnest(v_ids) spider_id
    where spider_id = any(array['neon','chrome','spring','summer','autumn','winter','null','ceo'])
      and v_owned ? spider_id;
  return jsonb_build_object('spiders', v_selected);
end;
$$;
revoke all on function public.uw_public_spiders(uuid) from public;
grant execute on function public.uw_public_spiders(uuid) to anon, authenticated;
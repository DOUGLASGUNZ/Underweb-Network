-- The Inner Web v0.1 — UnderWeb membership, Signal Drops and permanent artifact ownership.
create table if not exists public.inner_web_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 provider text not null default 'manual',
 provider_member_id text,
 tier text not null default 'none' check (tier in ('none','connected','signal','owner')),
 status text not null default 'inactive' check (status in ('inactive','active','past_due','cancelled')),
 started_at timestamptz,
 ends_at timestamptz,
 last_synced_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.inner_web_memberships enable row level security;
drop policy if exists "members read own inner web membership" on public.inner_web_memberships;
create policy "members read own inner web membership" on public.inner_web_memberships for select using (user_id=auth.uid());

create table if not exists public.signal_drops (
 id text primary key,
 name text not null,
 subtitle text,
 description text,
 starts_at timestamptz,
 ends_at timestamptz,
 required_tier text not null default 'connected' check(required_tier in ('free','connected','signal')),
 active boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.signal_drops enable row level security;
drop policy if exists "signal drops public read" on public.signal_drops;
create policy "signal drops public read" on public.signal_drops for select using (true);

create table if not exists public.vault_items (
 id text primary key,
 name text not null,
 description text,
 category text not null default 'artifact',
 required_tier text not null default 'connected' check(required_tier in ('free','connected','signal')),
 downloadable boolean not null default false,
 download_path text,
 collectible boolean not null default true,
 active boolean not null default true,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.vault_items enable row level security;
drop policy if exists "vault catalog public read" on public.vault_items;
create policy "vault catalog public read" on public.vault_items for select using (active=true);

create table if not exists public.signal_drop_items (
 signal_id text not null references public.signal_drops(id) on delete cascade,
 item_id text not null references public.vault_items(id) on delete cascade,
 sort_order int not null default 100,
 primary key(signal_id,item_id)
);
alter table public.signal_drop_items enable row level security;
drop policy if exists "signal item map public read" on public.signal_drop_items;
create policy "signal item map public read" on public.signal_drop_items for select using (true);

create table if not exists public.user_entitlements (
 user_id uuid not null references auth.users(id) on delete cascade,
 item_id text not null references public.vault_items(id) on delete cascade,
 source text not null default 'signal',
 granted_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb,
 primary key(user_id,item_id)
);
alter table public.user_entitlements enable row level security;
drop policy if exists "users read own artifact ownership" on public.user_entitlements;
create policy "users read own artifact ownership" on public.user_entitlements for select using(user_id=auth.uid());

insert into public.signal_drops(id,name,subtitle,description,starts_at,ends_at,required_tier,active) values
('signal_001','WEB OF THE DEAD','SIGNAL//001','The network was not built for what found it. The founding Halloween transmission of The Inner Web.','2026-10-01T00:00:00Z','2026-11-01T00:00:00Z','connected',false)
on conflict(id) do update set name=excluded.name,subtitle=excluded.subtitle,description=excluded.description;

insert into public.vault_items(id,name,description,category,required_tier,downloadable,collectible,metadata) values
('dead_signal_eyes','DEAD SIGNAL EYES','Animated UnderWeb Halloween eye material.','avatar_lab','signal',true,true,'{"signal":"001"}'),
('parasitic_web','PARASITIC WEB','Crawling web and tendril material preset.','materials','signal',true,true,'{"signal":"001"}'),
('grave_signal','GRAVE SIGNAL','Skeletal material with corrupted UnderWeb markings.','materials','signal',true,true,'{"signal":"001"}'),
('blacklight','BLACKLIGHT','Blacklight Halloween material preset.','materials','signal',true,true,'{"signal":"001"}'),
('marked_by_web','MARKED BY THE WEB','UnderWeb Halloween tattoo and decal collection.','creator_kits','signal',true,true,'{"signal":"001"}'),
('afterdark_creator_kit','AFTERDARK CREATOR KIT','Halloween overlays and creator graphics.','creator_kits','signal',true,true,'{"signal":"001"}'),
('web_of_dead_profile','WEB OF THE DEAD PROFILE SET','Signal 001 profile cosmetic set.','cosmetics','connected',false,true,'{"signal":"001"}'),
('signal_001_badge','SIGNAL//001','Signal 001 account collectible.','cosmetics','connected',false,true,'{"signal":"001"}'),
('founding_signal_2026','FOUNDING SIGNAL // 2026','Permanent founding-era Inner Web collectible.','legacy','connected',false,true,'{"signal":"001","limited":true}')
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,required_tier=excluded.required_tier;

insert into public.signal_drop_items(signal_id,item_id,sort_order) values
('signal_001','dead_signal_eyes',10),('signal_001','parasitic_web',20),('signal_001','grave_signal',30),('signal_001','blacklight',40),('signal_001','marked_by_web',50),('signal_001','afterdark_creator_kit',60),('signal_001','web_of_dead_profile',70),('signal_001','signal_001_badge',80),('signal_001','founding_signal_2026',90)
on conflict do nothing;

-- Safe client-side clearance reader. Owner override should be assigned server-side/admin-side only.
create or replace function public.uw_my_inner_web_status()
returns table(tier text,status text,started_at timestamptz,ends_at timestamptz)
language sql stable security definer set search_path=public as $$
 select coalesce(m.tier,'none'),coalesce(m.status,'inactive'),m.started_at,m.ends_at
 from (select auth.uid() uid) u left join public.inner_web_memberships m on m.user_id=u.uid;
$$;
revoke all on function public.uw_my_inner_web_status() from public;
grant execute on function public.uw_my_inner_web_status() to authenticated;

-- Permanent collection reader. This deliberately does not expose download paths.
create or replace function public.uw_my_artifact_collection()
returns table(item_id text,name text,description text,category text,granted_at timestamptz,metadata jsonb)
language sql stable security definer set search_path=public as $$
 select v.id,v.name,v.description,v.category,e.granted_at,v.metadata
 from public.user_entitlements e join public.vault_items v on v.id=e.item_id
 where e.user_id=auth.uid() order by e.granted_at desc;
$$;
revoke all on function public.uw_my_artifact_collection() from public;
grant execute on function public.uw_my_artifact_collection() to authenticated;

-- Claim a non-downloadable collectible the signed-in user currently qualifies for.
-- Downloadable files remain server-mediated so storage paths never become browser entitlements.
create or replace function public.uw_claim_artifact(p_item_id text)
returns table(item_id text,claimed boolean,reason text)
language plpgsql security definer set search_path=public as $
declare
 uid uuid:=auth.uid();
 v_item public.vault_items%rowtype;
 v_tier text:='none';
 v_status text:='inactive';
 v_rank int:=0;
 v_need int:=0;
 v_signal public.signal_drops%rowtype;
begin
 if uid is null then return query select p_item_id,false,'sign_in_required'; return; end if;
 select * into v_item from public.vault_items where id=p_item_id and active=true;
 if not found then return query select p_item_id,false,'not_found'; return; end if;
 if v_item.downloadable then return query select p_item_id,false,'download_requires_server'; return; end if;
 if not v_item.collectible then return query select p_item_id,false,'not_collectible'; return; end if;

 select coalesce(m.tier,'none'),coalesce(m.status,'inactive') into v_tier,v_status
 from (select uid) u left join public.inner_web_memberships m on m.user_id=u.uid;

 if v_tier='owner' then v_rank:=99;
 elsif v_status='active' and v_tier='signal' then v_rank:=2;
 elsif v_status='active' and v_tier='connected' then v_rank:=1;
 else v_rank:=0; end if;

 v_need:=case v_item.required_tier when 'signal' then 2 when 'connected' then 1 else 0 end;
 if v_rank<v_need then return query select p_item_id,false,'clearance_required'; return; end if;

 if coalesce(v_item.metadata->>'signal','')<>'' then
   select d.* into v_signal
   from public.signal_drop_items m join public.signal_drops d on d.id=m.signal_id
   where m.item_id=p_item_id order by d.starts_at desc nulls last limit 1;
   if found and v_tier<>'owner' then
     if not v_signal.active or (v_signal.starts_at is not null and now()<v_signal.starts_at)
        or (v_signal.ends_at is not null and now()>=v_signal.ends_at) then
       return query select p_item_id,false,'signal_closed'; return;
     end if;
   end if;
 end if;

 insert into public.user_entitlements(user_id,item_id,source,metadata)
 values(uid,p_item_id,'claim',jsonb_build_object('tier',v_tier))
 on conflict(user_id,item_id) do nothing;
 return query select p_item_id,true,'claimed';
end $;
revoke all on function public.uw_claim_artifact(text) from public;
grant execute on function public.uw_claim_artifact(text) to authenticated;

-- Catalog reader returns access state without exposing private storage paths.
create or replace function public.uw_inner_web_catalog()
returns table(item_id text,name text,description text,category text,required_tier text,downloadable boolean,collectible boolean,owned boolean,access_allowed boolean)
language sql stable security definer set search_path=public as $
 with me as (
   select auth.uid() uid,
          coalesce(m.tier,'none') tier,
          coalesce(m.status,'inactive') status
   from (select auth.uid() uid) u left join public.inner_web_memberships m on m.user_id=u.uid
 ), ranked as (
   select *,case when tier='owner' then 99 when status='active' and tier='signal' then 2 when status='active' and tier='connected' then 1 else 0 end rank from me
 )
 select v.id,v.name,v.description,v.category,v.required_tier,v.downloadable,v.collectible,
        exists(select 1 from public.user_entitlements e where e.user_id=ranked.uid and e.item_id=v.id),
        (ranked.rank>=case v.required_tier when 'signal' then 2 when 'connected' then 1 else 0 end)
 from public.vault_items v cross join ranked where v.active=true order by v.created_at,v.id;
$;
revoke all on function public.uw_inner_web_catalog() from public;
grant execute on function public.uw_inner_web_catalog() to anon,authenticated;

-- NOTE: claims, membership sync and signed download URLs belong in trusted server/Edge Function code.
-- Never place the Supabase service-role key in browser JavaScript.

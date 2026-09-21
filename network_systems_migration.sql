-- UnderWeb Network Systems v1
-- Unified activity, collaborations, milestones and identity support.

create table if not exists public.network_collaborators (
  id uuid primary key default gen_random_uuid(),
  object_type text not null check (object_type in ('event','project')),
  object_id uuid not null,
  collaborator_type text not null check (collaborator_type in ('user','partner')),
  user_id uuid references auth.users(id) on delete cascade,
  partner_id uuid references public.network_partners(id) on delete cascade,
  role_label text,
  added_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((collaborator_type='user' and user_id is not null and partner_id is null) or
         (collaborator_type='partner' and partner_id is not null and user_id is null))
);
create unique index if not exists network_collaborators_user_uidx on public.network_collaborators(object_type,object_id,user_id) where user_id is not null;
create unique index if not exists network_collaborators_partner_uidx on public.network_collaborators(object_type,object_id,partner_id) where partner_id is not null;
alter table public.network_collaborators enable row level security;
drop policy if exists "network collaborators public read" on public.network_collaborators;
create policy "network collaborators public read" on public.network_collaborators for select using (true);

create table if not exists public.network_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  partner_id uuid references public.network_partners(id) on delete cascade,
  kind text not null default 'network',
  title text not null,
  body text,
  object_type text,
  object_id uuid,
  public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists network_activity_user_idx on public.network_activity(user_id,created_at desc);
create index if not exists network_activity_partner_idx on public.network_activity(partner_id,created_at desc);
alter table public.network_activity enable row level security;
drop policy if exists "network activity public read" on public.network_activity;
create policy "network activity public read" on public.network_activity for select using (public=true or user_id=auth.uid());

create table if not exists public.network_milestone_definitions (
  slug text primary key,
  name text not null,
  description text,
  icon text not null default '◆',
  sort_order int not null default 100,
  active boolean not null default true
);
insert into public.network_milestone_definitions(slug,name,description,icon,sort_order) values
 ('founding_member','FOUNDING MEMBER','Part of the Network during its founding era.','✦',10),
 ('first_collab','FIRST COLLAB','Completed a first recorded Network collaboration.','⌁',20),
 ('first_event','FIRST EVENT','Participated in a first recorded Network event.','◈',30),
 ('ten_collabs','10 COLLABS','Reached ten recorded Network collaborations.','⬡',40),
 ('partner_owner','PARTNER OWNER','Owns an organization in the Partner Network.','♜',50),
 ('one_year','ONE YEAR','One year in the UnderWeb Network.','∞',60)
on conflict (slug) do update set name=excluded.name,description=excluded.description,icon=excluded.icon,sort_order=excluded.sort_order;

create table if not exists public.user_network_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_slug text not null references public.network_milestone_definitions(slug) on delete cascade,
  awarded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(user_id,milestone_slug)
);
alter table public.user_network_milestones enable row level security;
drop policy if exists "milestones public read" on public.user_network_milestones;
create policy "milestones public read" on public.user_network_milestones for select using (true);

-- Safe public profile activity reader.
create or replace function public.uw_profile_network_activity(p_user_id uuid, p_limit int default 20)
returns table(id uuid,kind text,title text,body text,object_type text,object_id uuid,created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select a.id,a.kind,a.title,a.body,a.object_type,a.object_id,a.created_at
  from public.network_activity a where a.user_id=p_user_id and a.public=true
  order by a.created_at desc limit greatest(1,least(coalesce(p_limit,20),50));
$$;
revoke all on function public.uw_profile_network_activity(uuid,int) from public;
grant execute on function public.uw_profile_network_activity(uuid,int) to anon,authenticated;

create or replace function public.uw_profile_milestones(p_user_id uuid)
returns table(slug text,name text,description text,icon text,awarded_at timestamptz)
language sql stable security definer set search_path=public as $$
 select d.slug,d.name,d.description,d.icon,u.awarded_at
 from public.user_network_milestones u join public.network_milestone_definitions d on d.slug=u.milestone_slug
 where u.user_id=p_user_id and d.active=true order by d.sort_order,u.awarded_at;
$$;
revoke all on function public.uw_profile_milestones(uuid) from public;
grant execute on function public.uw_profile_milestones(uuid) to anon,authenticated;

-- Partner affiliations used by Network Identity Cards.
alter table if exists public.network_partner_representatives add column if not exists is_primary boolean not null default false;

create or replace function public.uw_profile_partner_affiliations(p_user_id uuid)
returns table(partner_id uuid,partner_name text,partner_role text,is_primary boolean)
language sql stable security definer set search_path=public as $$
 select p.id,p.name,coalesce(r.partner_role,'representative'),coalesce(r.is_primary,false)
 from public.network_partner_representatives r
 join public.network_partners p on p.id=r.partner_id
 where r.user_id=p_user_id and coalesce(r.active,true)=true and p.status='active'
 order by coalesce(r.is_primary,false) desc,p.name;
$$;
revoke all on function public.uw_profile_partner_affiliations(uuid) from public;
grant execute on function public.uw_profile_partner_affiliations(uuid) to anon,authenticated;


-- Collaboration write helpers. Managers of the underlying object or network leadership should call these.
create or replace function public.uw_add_collaborator(p_object_type text,p_object_id uuid,p_collaborator_type text,p_user_id uuid default null,p_partner_id uuid default null,p_role_label text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_ok boolean:=false;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_object_type='project' then select exists(select 1 from public.network_projects p where p.id=p_object_id and p.created_by=auth.uid()) into v_ok;
 elsif p_object_type='event' then select exists(select 1 from public.network_events e where e.id=p_object_id and e.created_by=auth.uid()) into v_ok;
 end if;
 if not v_ok then
   select exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.status='active' and lower(ur.role_slug) in ('owner','director','admin')) into v_ok;
 end if;
 if not v_ok then raise exception 'Object management access required'; end if;
 insert into public.network_collaborators(object_type,object_id,collaborator_type,user_id,partner_id,role_label,added_by)
 values(p_object_type,p_object_id,p_collaborator_type,p_user_id,p_partner_id,nullif(trim(p_role_label),''),auth.uid()) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.uw_add_collaborator(text,uuid,text,uuid,uuid,text) from public;
grant execute on function public.uw_add_collaborator(text,uuid,text,uuid,uuid,text) to authenticated;


-- Record public activity automatically when core Network objects are created.
create or replace function public.uw_log_project_activity() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.network_activity(user_id,partner_id,kind,title,body,object_type,object_id,public)
 values(new.created_by,new.partner_id,'project','Posted a Network project',new.title,'project',new.id,true);
 return new;
end $$;
drop trigger if exists uw_project_activity_trg on public.network_projects;
create trigger uw_project_activity_trg after insert on public.network_projects for each row execute function public.uw_log_project_activity();

create or replace function public.uw_log_event_activity() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('approved','published','active') then
  insert into public.network_activity(user_id,partner_id,kind,title,body,object_type,object_id,public)
  values(new.created_by,new.partner_id,'event','Published a Network event',new.title,'event',new.id,true);
 end if;
 return new;
end $$;
drop trigger if exists uw_event_activity_trg on public.network_events;
create trigger uw_event_activity_trg after insert or update of status on public.network_events for each row execute function public.uw_log_event_activity();

create or replace function public.uw_log_partner_post_activity() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status='published' then
  insert into public.network_activity(user_id,partner_id,kind,title,body,object_type,object_id,public)
  values(new.created_by,new.partner_id,'partner','Partner posted an update',new.title,'partner_post',new.id,true);
 end if;
 return new;
end $$;
do $$ begin
 if to_regclass('public.network_partner_posts') is not null then
  execute 'drop trigger if exists uw_partner_post_activity_trg on public.network_partner_posts';
  execute 'create trigger uw_partner_post_activity_trg after insert on public.network_partner_posts for each row execute function public.uw_log_partner_post_activity()';
 end if;
end $$;

-- Refresh milestone awards from real Network records. Safe to run repeatedly.
create or replace function public.uw_refresh_my_network_milestones()
returns void language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); c int:=0;
begin
 if uid is null then raise exception 'Sign in required'; end if;
 if exists(select 1 from public.network_partner_representatives r where r.user_id=uid and r.active=true and r.partner_role='owner') then
  insert into public.user_network_milestones(user_id,milestone_slug) values(uid,'partner_owner') on conflict do nothing;
 end if;
 select count(*) into c from public.network_collaborators where user_id=uid;
 if c>=1 then insert into public.user_network_milestones(user_id,milestone_slug) values(uid,'first_collab') on conflict do nothing; end if;
 if c>=10 then insert into public.user_network_milestones(user_id,milestone_slug) values(uid,'ten_collabs') on conflict do nothing; end if;
 if exists(select 1 from public.network_collaborators where user_id=uid and object_type='event') then
  insert into public.user_network_milestones(user_id,milestone_slug) values(uid,'first_event') on conflict do nothing;
 end if;
end $$;
revoke all on function public.uw_refresh_my_network_milestones() from public;
grant execute on function public.uw_refresh_my_network_milestones() to authenticated;

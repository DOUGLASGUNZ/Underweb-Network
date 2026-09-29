-- Apply through the existing UnderWeb Supabase SQL editor before enabling
-- reviewer access in the website. Keeps Signal details private from visitors.
begin;

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
    select 1 from public.network_events e
    where e.id = p_event_id
      and (
        e.created_by = auth.uid()
        or (e.status = 'pending' and exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid() and ur.status = 'active'
            and lower(ur.role_slug) in ('owner', 'director', 'admin')
        ))
      )
  ) then
    raise exception 'Event not available to this account' using errcode = '42501';
  end if;
  select details into result from public.network_event_signals
  where event_id = p_event_id;
  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.uw_get_event_signal(uuid) from public, anon;
grant execute on function public.uw_get_event_signal(uuid) to authenticated;

commit;
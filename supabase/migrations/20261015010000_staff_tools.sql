-- Staff tools support for website v2.

-- 1. Pending events were only visible to the Owner, so Directors/Admins who are
--    allowed to approve them (uw_review_event requires rank 80 in the event's
--    scope) couldn't see the queue, and people couldn't see their own submissions.
drop policy if exists network_events_read on public.network_events;
create policy network_events_read on public.network_events
    for select to authenticated
    using (
        status = 'published'
        or created_by = auth.uid()
        or public.uw_can_access_event_scope(auth.uid(), group_scope, 80)
        or exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid() and ur.status = 'active' and ur.role_slug = 'owner'
        )
    );

-- 2. Staff review screens need applicants' names, but `profiles` is readable only
--    by its owner. Return just display name + username, to staff only.
create or replace function public.uw_staff_resolve_members(p_user_ids uuid[])
returns table (id uuid, username text, display_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if coalesce(public.uw_max_role_rank(), 0) < 55 or not public.uw_has_network_access() then
        raise exception 'Staff access required';
    end if;
    if coalesce(array_length(p_user_ids, 1), 0) > 200 then
        raise exception 'Too many member IDs requested';
    end if;
    return query
        select p.id, p.username, p.display_name, p.avatar_url
        from public.profiles p
        where p.id = any (p_user_ids);
end;
$$;
revoke execute on function public.uw_staff_resolve_members(uuid[]) from public, anon;
grant execute on function public.uw_staff_resolve_members(uuid[]) to authenticated;

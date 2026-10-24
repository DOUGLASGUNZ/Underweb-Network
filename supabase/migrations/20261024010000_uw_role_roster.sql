-- Staff Tools → People & roles: list everyone who holds a role (besides plain Member), for Owner / Director.
create or replace function public.uw_role_roster()
returns table (user_id uuid, display_name text, username text, roles jsonb, top_rank int)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.uw_max_role_rank(), 0) < 80 then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select ur.user_id, p.display_name, p.username,
           jsonb_agg(jsonb_build_object('role_slug', ur.role_slug, 'group_scope', ur.group_scope) order by coalesce(rd.authority_rank, 0) desc),
           max(coalesce(rd.authority_rank, 0))::int
      from public.user_roles ur
      left join public.role_definitions rd on rd.slug = ur.role_slug
      left join public.profiles p on p.id = ur.user_id
     where lower(coalesce(ur.status::text, 'active')) = 'active' and ur.role_slug::text <> 'member'
     group by ur.user_id, p.display_name, p.username
     order by 5 desc, 2 nulls last
     limit 500;
end;
$$;
revoke all on function public.uw_role_roster() from public, anon;
grant execute on function public.uw_role_roster() to authenticated;

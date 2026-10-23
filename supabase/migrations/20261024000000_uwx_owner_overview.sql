-- Owner dashboard: one read-only summary for Owner / Director (rank >= 90) on underweb.cloud.
-- Counts only; no notes, evidence, locations or instance links.
create or replace function public.uwx_owner_overview(p_group uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g public.uwx_groups;
  wk timestamptz := now() - interval '7 days';
  mo timestamptz := now() - interval '30 days';
  latest public.uwx_group_snapshots;
  r jsonb;
begin
  if coalesce(public.uw_max_role_rank(), 0) < 90 then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into g from public.uwx_groups
   where (p_group is null or id = p_group) and status = 'active' and role_scope not like 'partner:%'
   order by created_at limit 1;
  if g.id is null then
    return jsonb_build_object('group', null);
  end if;

  select * into latest from public.uwx_group_snapshots where group_id = g.id and member_count is not null
   order by bucket_at desc limit 1;

  r := jsonb_build_object(
    'group', jsonb_build_object('id', g.id, 'name', g.name, 'goal', coalesce(g.member_goal, 500)),
    'members', jsonb_build_object(
      'count', latest.member_count,
      'online', latest.online_count,
      'as_of', latest.captured_at,
      'week_ago', (select member_count from public.uwx_group_snapshots where group_id = g.id and member_count is not null and bucket_at <= wk order by bucket_at desc limit 1),
      'month_ago', (select member_count from public.uwx_group_snapshots where group_id = g.id and member_count is not null and bucket_at <= mo order by bucket_at desc limit 1),
      'tracked_since', (select min(bucket_at) from public.uwx_group_snapshots where group_id = g.id)
    ),
    'needs_you', jsonb_build_object(
      'partner_applications', (select count(*) from public.uwx_group_applications where status = 'pending'),
      'recruit_claims', (select count(*) from public.uwx_recruit_claims where group_id = g.id and status = 'pending'),
      'cases_open', (select count(*) from public.uwx_cases where group_id = g.id and status in ('open','under_review','appealed')),
      'cases_escalated', (select count(*) from public.uwx_cases where group_id = g.id and status = 'escalated'),
      'cases_unassigned', (select count(*) from public.uwx_cases where group_id = g.id and status in ('open','under_review','escalated','appealed') and assigned_to is null),
      'help_open', (select count(*) from public.uwx_help_requests where group_id = g.id and status <> 'closed' and created_at > now() - interval '24 hours')
    ),
    'on_duty', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(p.display_name, p.username, 'Staff'), 'since', s.started_at) order by s.started_at)
        from public.uwx_staff_shifts s left join public.profiles p on p.id = s.user_id
       where s.group_id = g.id and s.ended_at is null and s.started_at > now() - interval '12 hours'), '[]'::jsonb),
    'staff_week', coalesce((
      select jsonb_agg(x order by x->>'hours' desc) from (
        select jsonb_build_object(
          'name', coalesce(p.display_name, p.username, 'Staff'),
          'hours', round((sum(extract(epoch from (coalesce(s.ended_at, now()) - greatest(s.started_at, wk)))) / 3600)::numeric, 1)
        ) x
          from public.uwx_staff_shifts s left join public.profiles p on p.id = s.user_id
         where s.group_id = g.id and coalesce(s.ended_at, now()) > wk
         group by p.display_name, p.username, s.user_id) t), '[]'::jsonb),
    'moderation_week', jsonb_build_object(
      'bans', (select count(*) from public.uwx_group_events where group_id = g.id and occurred_at > wk and event_type = 'group.user.ban'),
      'unbans', (select count(*) from public.uwx_group_events where group_id = g.id and occurred_at > wk and event_type = 'group.user.unban'),
      'kicks', (select count(*) from public.uwx_group_events where group_id = g.id and occurred_at > wk and event_type in ('group.instance.kick','group.member.remove')),
      'warns', (select count(*) from public.uwx_group_events where group_id = g.id and occurred_at > wk and event_type = 'group.instance.warn'),
      'joins', (select count(*) from public.uwx_group_events where group_id = g.id and occurred_at > wk and event_type = 'group.member.join'),
      'leaves', (select count(*) from public.uwx_group_events where group_id = g.id and occurred_at > wk and event_type = 'group.member.leave'),
      'cases_closed', (select count(*) from public.uwx_cases where group_id = g.id and closed_at > wk),
      'last_event', (select max(occurred_at) from public.uwx_group_events where group_id = g.id)
    ),
    'discord', (select jsonb_build_object('last_post_at', d.last_post_at, 'last_error', d.last_error, 'backfilled_at', d.backfilled_at)
                  from public.uwx_discord_state d where d.group_id = g.id),
    'recruiting', jsonb_build_object(
      'verified_week', (select count(*) from public.uwx_recruit_claims where group_id = g.id and status = 'verified' and reviewed_at > wk),
      'verified_total', (select count(*) from public.uwx_recruit_claims where group_id = g.id and status = 'verified')
    ),
    'community_week', jsonb_build_object(
      'hub_visits', (select count(*) from public.uw_hub_visits where confirmed_at > wk),
      'hub_visitors', (select count(distinct user_id) from public.uw_hub_visits where confirmed_at > wk),
      'silk_earned', (select coalesce(sum(amount), 0) from public.uw_silk_ledger where amount > 0 and created_at > wk),
      'top_earners', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'earned', earned) order by earned desc) from (
          select coalesce(p.display_name, p.username, 'Member') name, sum(l.amount) earned
            from public.uw_silk_ledger l left join public.profiles p on p.id = l.user_id
           where l.amount > 0 and l.created_at > wk group by 1 order by 2 desc limit 5) t), '[]'::jsonb)
    ),
    'generated_at', now()
  );
  return r;
end;
$$;

revoke all on function public.uwx_owner_overview(uuid) from public, anon;
grant execute on function public.uwx_owner_overview(uuid) to authenticated;

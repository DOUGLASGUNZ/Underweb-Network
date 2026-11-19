-- ROLLBACK for 20261119230000_security_hardening.sql
-- Puts the database back exactly as it was on 2026-11-19 before the hardening.
-- Only run this if something broke after the hardening went in.

alter view public.network_partners_public reset (security_invoker);

grant execute on function public.handle_new_user() to public, anon;
grant execute on function public.has_permission(uuid,text) to public, anon;
grant execute on function public.is_group_staff(uuid) to public, anon;
grant execute on function public.is_underweb_owner(uuid) to public, anon;
grant execute on function public.is_underweb_staff(uuid) to public, anon;
grant execute on function public.owner_member_directory() to public, anon;
grant execute on function public.owner_revoke_all_memberships(uuid) to public, anon;
grant execute on function public.owner_set_membership(uuid,text,text) to public, anon;
grant execute on function public.save_my_staff_availability(text,text,text,text,jsonb) to public, anon;
grant execute on function public.uw_add_collaborator(text,uuid,text,uuid,uuid,text) to public, anon;
grant execute on function public.uw_apply_to_project_slot(uuid,text) to public, anon;
grant execute on function public.uw_archive_finished_events() to public, anon;
grant execute on function public.uw_award_badge(uuid,text,text,text) to public, anon;
grant execute on function public.uw_award_title(uuid,text,text) to public, anon;
grant execute on function public.uw_can_moderate() to public, anon;
grant execute on function public.uw_can_review_media() to public, anon;
grant execute on function public.uw_cancel_event(uuid,text) to public, anon;
grant execute on function public.uw_cancel_project(uuid,text) to public, anon;
grant execute on function public.uw_claim_artifact(text) to public, anon;
grant execute on function public.uw_claim_vrchat_profile(text) to public, anon;
grant execute on function public.uw_clear_title() to public, anon;
grant execute on function public.uw_director_set_role(uuid,text,boolean) to public, anon;
grant execute on function public.uw_grant_role(uuid,text,text,text) to public, anon;
grant execute on function public.uw_has_network_access() to public, anon;
grant execute on function public.uw_inner_web_catalog() to public, anon;
grant execute on function public.uw_invite_creator_to_project(uuid,uuid,text) to public, anon;
grant execute on function public.uw_is_owner_or_director() to public, anon;
grant execute on function public.uw_is_partner_rep(uuid) to public, anon;
grant execute on function public.uw_log_event_activity() to public, anon;
grant execute on function public.uw_log_partner_post_activity() to public, anon;
grant execute on function public.uw_log_profile_edit_pulse() to public, anon;
grant execute on function public.uw_log_project_activity() to public, anon;
grant execute on function public.uw_manage_event(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text) to public, anon;
grant execute on function public.uw_mark_all_notifications_read() to public, anon;
grant execute on function public.uw_max_role_rank() to public, anon;
grant execute on function public.uw_moderate_user(uuid,text,text,integer) to public, anon;
grant execute on function public.uw_moderation_resolve_members(uuid[]) to public, anon;
grant execute on function public.uw_moderation_search_members(text,integer) to public, anon;
grant execute on function public.uw_my_active_restriction() to public, anon;
grant execute on function public.uw_my_artifact_collection() to public, anon;
grant execute on function public.uw_my_inner_web_status() to public, anon;
grant execute on function public.uw_network_access_state() to public, anon;
grant execute on function public.uw_notification_unread_count() to public, anon;
grant execute on function public.uw_notify(uuid,text,text,text,text,uuid) to public, anon;
grant execute on function public.uw_notify_application_event() to public, anon;
grant execute on function public.uw_notify_ticket_event() to public, anon;
grant execute on function public.uw_partner_create_event(uuid,text,text,timestamp with time zone,timestamp with time zone,text) to public, anon;
grant execute on function public.uw_partner_create_project(uuid,text,text,text,text,text,integer) to public, anon;
grant execute on function public.uw_partner_publish_post(uuid,text,text,text) to public, anon;
grant execute on function public.uw_public_identity(uuid) to public, anon;
grant execute on function public.uw_public_verified_vrchat(uuid) to public, anon;
grant execute on function public.uw_refresh_my_network_milestones() to public, anon;
grant execute on function public.uw_repair_my_identity() to public, anon;
grant execute on function public.uw_request_vrchat_verification() to public, anon;
grant execute on function public.uw_require_network_access() to public, anon;
grant execute on function public.uw_respond_project_invite(uuid,text) to public, anon;
grant execute on function public.uw_review_project_application(uuid,text) to public, anon;
grant execute on function public.uw_review_role_application(uuid,text,text) to public, anon;
grant execute on function public.uw_review_showcase_media(uuid,boolean,text) to public, anon;
grant execute on function public.uw_review_vrchat_connection(uuid,boolean) to public, anon;
grant execute on function public.uw_revoke_role(uuid,text,text,text) to public, anon;
grant execute on function public.uw_search_people(text,integer) to public, anon;
grant execute on function public.uw_select_title(uuid) to public, anon;
grant execute on function public.uw_set_badge_showcase(uuid,boolean) to public, anon;
grant execute on function public.uw_set_cosmetic_equipped(text,boolean) to public, anon;
grant execute on function public.uw_set_event_cover(uuid,text) to public, anon;
grant execute on function public.uw_set_project_cover(uuid,text) to public, anon;
grant execute on function public.uw_showcase_review_queue() to public, anon;
grant execute on function public.uw_silk_on_photo() to public, anon;
grant execute on function public.uw_silk_on_recruit() to public, anon;
grant execute on function public.uw_staff_availability_directory() to public, anon;
grant execute on function public.uw_staff_roster_directory() to public, anon;
grant execute on function public.uw_vrchat_verification_queue() to public, anon;
grant execute on function public.uw_withdraw_role_application(uuid) to public, anon;
grant execute on function public.uwx_cases_after() to public, anon;
grant execute on function public.uwx_cases_before() to public, anon;
grant execute on function public.uwx_is_underweb_staff() to public, anon;
grant execute on function public.uwx_notes_guard() to public, anon;
grant execute on function public.uwx_review_safety_report(uuid,text,text,text,timestamp with time zone) to public, anon;

grant execute on function public.handle_new_user() to authenticated;
grant execute on function public.uw_log_event_activity() to authenticated;
grant execute on function public.uw_log_partner_post_activity() to authenticated;
grant execute on function public.uw_log_profile_edit_pulse() to authenticated;
grant execute on function public.uw_log_project_activity() to authenticated;
grant execute on function public.uw_notify_application_event() to authenticated;
grant execute on function public.uw_notify_ticket_event() to authenticated;
grant execute on function public.uw_silk_on_photo() to authenticated;
grant execute on function public.uw_silk_on_recruit() to authenticated;
grant execute on function public.uwx_cases_after() to authenticated;
grant execute on function public.uwx_cases_before() to authenticated;
grant execute on function public.uwx_notes_guard() to authenticated;

drop policy if exists "Visible creator profiles are public" on public.creator_profiles;
drop policy if exists "Visible creator profiles, or staff" on public.creator_profiles;
create policy "Creator profiles are publicly readable" on public.creator_profiles for select to anon, authenticated using (true);

create or replace function public.uw_has_network_access()
 returns boolean language sql stable security definer
 set search_path to 'public', 'auth'
as $function$
    select coalesce(
        exists (select 1 from public.user_roles ur where ur.user_id = auth.uid()
              and lower(btrim(ur.status)) = 'active' and lower(btrim(ur.role_slug)) in ('owner', 'director'))
        or exists (select 1 from public.network_connections nc where nc.user_id = auth.uid()
              and lower(btrim(nc.provider)) = 'vrchat' and lower(btrim(nc.verification_status)) = 'verified'),
        false);
$function$;
grant execute on function public.uw_has_network_access() to public, anon, authenticated;

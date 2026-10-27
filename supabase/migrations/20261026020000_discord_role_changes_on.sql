-- Run ONLY when you're ready for the bot to actually change roles (after testing in dry-run).
-- 1) Protects everyone who has Verified right now (the bot has seen them hold it), so nobody gets locked out.
-- 2) Turns role changes on. The worker also needs DRY_RUN=false on Railway.
begin;
insert into uw_discord.grants (discord_user_id, kind)
select j.discord_user_id, 'grandfathered'
  from uw_discord.sync_jobs j
 where j.last_outcome = 'dry_run'
   and not coalesce((uw_discord.job_snapshot(j.discord_user_id)->>'desiredVerified')::boolean, false)
   and not exists (select 1 from uw_discord.grants g where g.discord_user_id = j.discord_user_id and g.revoked_at is null);
update uw_discord.config set apply_enabled = true where singleton;
commit;
select (select count(*) from uw_discord.grants where kind = 'grandfathered' and revoked_at is null) as protected_members,
       (select apply_enabled from uw_discord.config where singleton) as role_changes_on;

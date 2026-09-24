# UnderWeb website spider collection

This work is **prepared, not activated**. The live website and Supabase schema must not be changed merely by restarting the bot.

## Files

- `supabase/20260924_spider_profiles.sql`: reviewed schema for private mirrored collections and owner-controlled, opt-in public showcases.
- `site/spider-collection.js` and `site/spider-collection.css`: standalone assets for the existing UnderWeb `index.html`.
- Bot mirror: `services/underweb-bot/src/services/spider-collection-sync.ts`. It mirrors counts only; cooldowns, event attempts, and roulette titles remain in the local bot file.

## Safe rollout order

1. Review and apply the SQL **to the existing UnderWeb Supabase project** through its normal SQL editor/migration process. Replit's built-in PostgreSQL is a different database. This SQL creates two tables and three browser-facing RPCs; direct browser access to the tables remains denied.
2. Confirm the Discord account-link path is published and a test account is linked. The private RPC resolves `auth.uid()` to `profiles.discord_user_id`; it never accepts a browser-supplied Discord ID.
3. Enable `UNDERWEB_SPIDER_SYNC_ENABLED=true` in the bot's environment **after** the migration. Restart the existing bot workflow and check for `Spider collections mirrored to Supabase`. Temporary database failures log a degraded mirror and retry every minute without taking Discord offline. If remote counts exceed the local file, the mirror blocks further writes until manual reconciliation; do not remove the local file or overwrite counts. Writes use a service-role-only monotonic merge RPC so a late sync cannot lower a count.
4. Merge the website PR after the migration and bot mirror are healthy. The new assets are loaded by `index.html` and use the existing authenticated Supabase client. Test signed-out, unlinked, linked/empty, linked/collected, opt-out, and selected rare-spider states on the site.

The bot's `.data/underweb-spiders.json` remains its authoritative source. This mirror makes counts readable by the website but does **not** make the bot state safe for an ephemeral host. Before moving the bot, migrate all economy state (including cooldowns and event attempts) to durable shared storage; never replace the local file with empty data. Spider counts are cosmetic, have no real-money value, and cannot be traded.
# UnderWeb Court: Phase 1 plan and as-built record

Fictional roleplay only. No Silk moves in Phase 1. No real moderation records are touched. Court tables have no foreign keys to `uwx_*` or moderation tables.

Status: **built and tested in the repositories. Not applied, deployed, or merged.** Branch `court-phase1` in both repositories.

---

## 1. Participation modes (launch requirement)

| Mode | Identity | Account needed | Can do |
|---|---|---|---|
| VRChat guest | random per-result guest ref, label marked unverified | No | File, respond, testify, jury vote in the world. The result reaches the site only through a judge. |
| Discord participant | Discord snowflake, from the bot's signed interaction | No | File, respond, block, vote, set courtroom participation on or off |
| Linked member | `auth.users` ID mapped to a `court_parties` row | Yes, only for this mode | Everything above, plus history and claiming guest records |

## 2. Approved decisions (27 Oct)

1. **Claim codes.** Single use, 10-minute expiry, 50 bits from a cryptographic random source. Shown only to the judge, once. Stored only as an HMAC (pepper in edge-function secrets). Redeemed atomically in SQL. Five wrong codes lock the record until a judge reissues. Redemption is rate-limited to 10 an hour per account. A code proves possession only. Claimed records are labelled "self-claimed". A claimant can view and withdraw consent, but cannot grant it. Claims grant no moderation, Silk, or other privilege.
2. **Judges.** Staff-approved people only. A public person may act as judge in the courtroom when staff have approved them for that session. A result reaches the website only when a linked staff member submits it. The submission uses the existing role system: the caller's own session runs `uw_max_role_rank()` and needs rank 55 or higher (the staff-tools threshold). The submitting staff member answers for the result.
   - Claim codes are never made in the courtroom. The website issues them on `/court/judge` after a result is submitted.
3. **Privacy.** Guest cases are private by default. Public only when both parties have consented to publish and a judge has approved. Declining ends a case. Players can block, and can turn courtroom participation off.
4. **Discord voting.** Community polls, one identity per vote, up to three changes, separate from the jury. Results are shown on the website. Verdict and poll posts go out only for public cases, and never mention anyone.
5. **Architecture.** `court_parties` holds every participant. Claims are a separate table, so cases stay valid when someone links an account later. No changes to UWX tables.

## 3. As built

### Database (`supabase/migrations/20261027090000_court_phase1.sql`, not applied)
- `court_parties`, `court_cases`, `court_consents`, `court_blocks`, `court_claims`, `court_community_votes`, `court_verdicts`, `court_submissions`, `court_evidence`, `court_announcements`, `court_rate_limits`, `court_reasons`
- Constraints: party refs match their kind; a case cannot be public without approval; one open case per plaintiff; one verdict per case; one submission per judge and local ref; one vote per voter per case; claim used-state is all-or-nothing.
- RLS on every table with **no policies** for anon or authenticated. Only the public reasons list is readable directly. Everything else goes through the edge function.
- SQL helpers (service role only): `court_worker_ok` (wraps the existing bot credential check), `court_rate_hit` (fixed window), `court_redeem_claim` (locks the case, counts misses, marks used once).

### Seed (`supabase/seed/court_reasons.sql`, run once after the migration)
- 75 reasons from `CourtLibrary/court_library.json`. The library has no rating field, so all are loaded as PG-13. The text was scanned for sexual and adult terms; none were found.

### Edge function (`supabase/functions/court/`)
- `logic.ts`: claim codes, canonical JSON checksums, strict result validation, filing, consent, and vote rules, and fictional exhibits. No Deno APIs.
- `handler.ts`: request routing and the rules. It works against any store that implements the `Store` interface.
- `store.ts`: the production store (service role). Maps constraint violations to our own error codes.
- `index.ts`: the entry point. Deploy with **Verify JWT off**, as `underweb-discord` is. The handler checks every caller.

### Website (`web/src`)
- `/court` (public record, your cases), `/court/case/:no` (case page, answer, publish consent, judge tools), `/court/file` (search public members, file or countersue), `/court/claim` (code redemption), `/court/judge` (paste an exported result; codes appear once).
- Routes are added to `router.js`. Nothing else in the site changed.

### Discord bot (`worker/court.ts`, `worker/court-logic.ts`, `worker/main.ts`)
- `/court file | respond | block | accepting | case`, with Accept, Decline and Block buttons in a DM to the defendant. Vote buttons on polls.
- A queue posts polls and verdicts for public cases only, then acknowledges each post.
- Enabled only when `UNDERWEB_COURT_API_URL` is set. With it empty, the bot behaves exactly as before.

## 4. Tests run

| Suite | Result |
|---|---|
| `node --test tests/court/court.test.mjs` (website repo): 23 tests against an in-memory store with the same constraints | **23 pass** |
| `node --test tests/discord-link.test.mjs` (website repo, existing) | 6 pass |
| `node --test tests/court.test.mjs` (bot repo, pure court helpers) | 6 pass |
| TypeScript strict check: `logic.ts`, `handler.ts`, `store.ts`, `fake-store.ts`, bot `court-logic.ts` | clean |
| TypeScript check of `index.ts` (ignoring Deno-only globals) | clean |
| `esbuild` syntax check of every court Vue script block and `lib/court.js` | clean |

What the tests cover: public privacy, filing, decline and blocking, the 24-hour cooldown, countersuits, participation switches, one open case per plaintiff, Discord play without an account, community votes (change limit, party restriction, closed poll), publication consent and approval (including the bot having no way to approve), removal requests, unpublish, announcements for public cases only, judge and bot gates, guest results (checksum, duplicates, unknown fields, private until approved), claim codes (single use, lockout, expiry, reissue, rate limit, no consent granted by a claimant), and that no Silk code exists in the court.

## 5. Not verified (be honest about these)

- **SQL has not been run.** No PostgreSQL server is available here, and no SQL parser could be installed. The migration was reviewed by hand. Apply it to a scratch project first.
- **The Vue pages have not been built or rendered.** The web dependencies could not be installed (the npm registry is unreachable from this environment). Script blocks parse. Templates are unchecked.
- **The Discord wiring is not compiled.** discord.js is not installed here. `court.ts` and `main.ts` need `npm run build` on a machine with dependencies.
- **Judge role check.** `uw_max_role_rank()` is called with no arguments, as the existing staff RPCs do. Its definition is in the live database, not in the repository, so confirm it on the project before launch.
- **Discord slash command registration** needs the bot invited with the `applications.commands` scope.
- **In-world (Unity) is not built.** Guest pickers, the private consent prompt, the result export (canonical JSON plus checksum, matching `logic.ts`), and the claim-code display are not written yet. The server accepts the format, but a guest cannot play the full courtroom from VRChat until the Unity side exists. This is the main launch blocker after the database is applied.
- **Discord account linking is not reused for court identity.** A Discord participant is identified by their snowflake. Linking to a website account is left separate, so records are not merged automatically.
- **A claim proves possession, not ownership.** Records are labelled accordingly.
- **Courtroom Unity scripts** in `unity/courtroom/` are written but not compiled or tested in Unity. They need VRChat SDK 3 Worlds and UdonSharp. The one-click builder (`Editor/CourtRoomBuilder.cs`) is also untested.
- **Known gaps in the room, to resolve before launch:**
  - `exported_at` uses VRChat's server time. The bench converts it to ISO 8601 without .NET date types. Test this.
  - The checksum uses a hand-written SHA-256 in UdonSharp (`CourtChecksum.cs`). Check it against the server's `sha256Hex` with a known test vector, then time it in-world.
  - Jury tallies are counts, not one vote per player, so a juror can vote twice.
  - Staff identity in-world is the instance owner or a display-name list. Display names can be copied. The website check remains the real gate.
  - Labels use display names, which are cleaned to ASCII before export.
  - The room has no damages input, so damages default to 0 until one is added.
  - `accusation_id` is set to `ROOM-<case no>`. It must be replaced with the real website accusation ID before submission.

## 6. Deployment checklist (do not run until approved)

1. Apply `20261027090000_court_phase1.sql` to a scratch project, then to `pxipclkptxpqukefwexh`.
2. Run `supabase/seed/court_reasons.sql` once.
3. Deploy the `court` function with Verify JWT off. Set secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UW_SITE_ORIGIN`, `DISCORD_GUILD_ID`, `COURT_CLAIM_PEPPER` (at least 32 random characters, never shared).
4. Bot environment: `UNDERWEB_COURT_API_URL` (the function URL), optionally `DISCORD_COURT_CHANNEL_ID`. Re-invite the bot with `applications.commands`.
5. Website: deploy after step 3, so the routes have a backend.
6. Smoke test: file, decline, poll, and a guest result with a claim, on a test guild and a scratch project.

## 7. Open questions

1. Should the claim redemption rate limit (10 an hour) be shorter?
2. Should Discord polls open automatically on public cases, or only when a judge opens them?
3. Should the judge threshold stay at the staff-tools level (55), or move to leadership (80)?

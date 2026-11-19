# One Silk balance: casino ⇄ underweb.cloud

The hub casino is the bank. underweb.cloud is the window.

A VRChat world can download text but can't send anything, so Silk moves in two directions over two paths:

| Direction | How |
| --- | --- |
| Site → casino (Silk earned or spent on the site) | Numbered **transfers** in `uw_silk_transfers` → `silk-bank` feed → GitHub Pages → the world downloads it and applies new transfers. |
| Casino → site (your balance on the site) | The world writes **snapshot lines** to the VRChat log → UWX reads them → `uw_casino_report()` → `uw_casino_balances`. |

Silk only lives in the world's save. The site never holds a second copy, so nothing can be duplicated.

## Feed the world downloads

`https://douglasgunz.github.io/Underweb-Network/feeds/silk-bank.txt` (refreshed every 10 minutes by `hub-feeds.yml`).
Source: `https://pxipclkptxpqukefwexh.supabase.co/functions/v1/silk-bank` (Supabase isn't on VRChat's trusted URL list, so the world uses the Pages copy).

```
UWSILK 1
# 2026-11-19T22:31:30Z 2
1<TAB>usr_a5d5a95f-…<TAB>Dаrko<TAB>340000<TAB>Silk earned on the site before the casino link
2<TAB>usr_11086c52-…<TAB>Shadow Ranger<TAB>30000<TAB>Silk earned on the site before the casino link
```

- Columns: `seq`, VRChat user id, VRChat display name, amount (signed 64-bit; negative = a charge), note (max 80 chars, no tabs).
- Rows are sorted by `seq`. `seq` only ever goes up.
- Lines starting with `#` are comments. Skip blank lines and anything that doesn't have 5 columns.
- The feed repeats rows for 30 days (and pending rows forever). **Repeats are expected.**

## World rules (patch build)

Per player, store one extra synced value in PlayerData: **`uwSilkSeq`** (long, starts at 0).

1. On join (and every 10 minutes while in the world), download the feed. VRChat allows one string download every 5 seconds per world, so share one download for everyone.
2. For the local player only, take rows where the display name equals `Networking.LocalPlayer.displayName` (exact, case-sensitive; Darko's name has a Cyrillic `а`, which works because it's compared as text, never typed) **and** `seq > uwSilkSeq`, in `seq` order:
   - amount > 0: add it to the player's Silk (respect the 64-bit overflow cap), show a small popup: "+340,000 Silk from underweb.cloud".
   - amount < 0: if the balance covers it, subtract it; otherwise skip it and remember the seq as declined.
   - Either way set `uwSilkSeq = seq` before moving on, so a row is never applied twice even if the world crashes mid-way.
3. Each player only ever applies their own rows (the owner of the PlayerData is the one who writes it).

## Log lines the world writes (UWX reads these)

Every 5 minutes, and right after the step above changes anything, the **instance master** logs one line per player in the instance:

```
[VRCX] UWSILK SNAP 1|<last seq applied>|<balance>|<whale tier 0-40>|<legacy level 0-20>|<declined seqs, comma separated or empty>|<display name>
```

Example: `Debug.Log("[VRCX] UWSILK SNAP 1|12|1234567890123|7|1||" + player.displayName);`

- Display name goes last so a `|` in a name can't shift the columns (take everything after the 6th `|`).
- Write it with `Debug.Log` so it lands in `output_log_*.txt`. The `[VRCX] ` prefix matters: VRCX/UWX forwards those lines to the app (same as the hub's `UWLike` and `UWRoot` lines).
- Whale tier: 0 = no plaque, 1 = 1M plaque … 10 = 1B plaque, 11+ for the planned tiers above 1B.

## UWX rules (UWX 0.6.14-rc40, `features/core/rc40-casino-silk.patch` in DOUGLASGUNZ/underwebx)

1. Only while the current world id is an active hub world (`uw_silk_summary().worlds`, already used for check-ins).
2. Read `UWSILK SNAP 1|…` lines (VRCX game-log type `vrcx`). Map each display name to a user id with the instance player list VRCX builds from `OnPlayerJoined` lines. Drop names it can't map.
3. Batch up to 100 rows, at most once a minute, and call:
   ```js
   rpc('uw_casino_report', { p_world_id, p_rows: [{ vrc_user_id, display_name, balance, whale_tier, legacy_level, last_seq, seen_at, declined: [seq,…] }] })
   ```
   `seen_at` = the log line's timestamp (UTC ISO). Rows older than 6 hours are ignored by the server, and so are rows older than the last report for that player.
4. Balances are sent as strings or numbers; they can be above 2^53, so send them as strings.
5. The **Share casino balances** switch next to "Count my visits" turns this off.

## Database (applied 2026-11-19)

- `uw_silk_bank_config`: `website_multiplier` (1000: a 25-point hub visit = 25,000 casino Silk), `feed_days` (30).
- `uw_silk_transfers`: every `uw_silk_ledger` insert becomes a transfer automatically (trigger). Old site Silk was carried over once.
- `uw_casino_balances`: last balance seen per VRChat user.
- `uw_casino_report(world, rows)`: UWX → mirror; marks transfers ≤ `last_seq` applied and listed declined charges declined.
- `uw_silk_summary()`: casino balance, pending transfers, history. Its `balance` = last casino balance + pending.
- `uw_casino_overview(limit)`: richest players + Hall of Whales for the site.
- `uw_silk_cancel_transfer(seq)`: leadership can cancel a transfer the casino hasn't applied.

### Trust

Any verified member running UWX can report balances, so a modified client could post a fake number. That only changes what the site **shows**. It can't create Silk in the casino, and the world ignores `applied` status (it uses its own saved `uwSilkSeq`), so it can't make anyone lose a deposit either. Every report records who sent it (`reported_by`).

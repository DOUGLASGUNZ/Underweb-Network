# Hub creator cards

Draws the creator cards that hang in the UnderWeb hub world and publishes them to GitHub Pages,
where the world loads them (VRChat only trusts `*.github.io` for images).

```
creator fills in "Your hub card" on their profile (underweb.cloud)
  → staff approve it (same panel, reviewers only)
  → hub-cards edge function lists approved, switched-on cards (public info only)
  → the "Hub feeds to GitHub Pages" workflow (every 10 min) runs render.py
  → https://douglasgunz.github.io/Underweb-Network/w/hub/<SLOT>/<n>.jpg + manifest.json
  → the hub's UnderWeb Media slots load them (refresh every 15 min)
```

## Slots it fills (world id `hub`)

| Slot | Size | Kind | What |
|---|---|---|---|
| `CREATOR_MARKET_01` … `08` | 1024×1280 (4:5) | single | Creator Market cards: art, name, headline, QR to their shop. More than 8 → the set rotates weekly. |
| `CREATOR_FEATURED_01` | 1920×1080 | single | Featured creator of the week (everyone with an approved card takes turns). |
| `STAGE_DJS` | 1920×1080 | gallery, up to 12 | Resident DJ cards for the Stage screen: logo/photo, name, QR to their music. |
| `CREATOR_WALL` | 1920×1080 | gallery, up to 12 | Approved showcase photos/art the owner ticked "show on the hub wall". |

Empty slots get `"active": []` in the manifest, so the world shows the slot's fallback texture.

In Unity: **Tools → UnderWeb → Bake Media URLs** with media host
`https://douglasgunz.github.io/Underweb-Network` and world id `hub`.

## Safety

- Everything is opt-in and staff-approved; editing a card sends it back to pending (enforced in the database).
- Card images must be the creator's own uploads on UnderWeb storage; the renderer only downloads from there.
- Links must be `https://`. QR codes go to the creator's link, or their profile (`underweb.cloud/#profile=<id>`).
- Emoji are dropped (no font has them); Cyrillic look-alikes (e.g. the "а" in "Dаrko") are drawn with the Latin shape.

## Run it locally

```
curl -s https://pxipclkptxpqukefwexh.supabase.co/functions/v1/hub-cards -o cards.json
pip install pillow fonttools
python tools/hub-cards/render.py cards.json out --world hub
```

Needs Node for the QR codes (`qr.js` uses the vendored `qrcode-generator`, MIT).
Fonts: Anton, Inter, JetBrains Mono (SIL Open Font License, see `fonts/OFL-*.txt`).

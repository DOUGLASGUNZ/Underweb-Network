# UnderWeb World Media — Unity side

Posters, frames, billboards and screens in your worlds that you update from **underweb.cloud → World Media Manager**, without reopening Unity or re-uploading the world.

## How it works (and why)

VRChat rules this is built around (from VRChat's creator docs, checked Oct 2026):

- Images only load from **allow-listed hosts** unless a player turns on "Allow Untrusted URLs". `*.github.io` (GitHub Pages) is allowed. Supabase Storage is not — so published images are copied to a GitHub Pages repo.
- **A world can't build URLs while running.** Every slot's address is baked in once (this tool does it), and publishing replaces the file behind the address.
- **One image (or text file) download every 5 seconds per world**, queued. 30 slots ≈ 2.5 minutes to load everything — keep slot counts sensible and put important posters first.
- **Max 2048×2048.** The website resizes and crops for you.
- **No redirects.** The baked addresses point straight at the files.
- GitHub Pages caches files ~10 minutes, so a publish shows up on the next world load or refresh after that.

Addresses: `https://<you>.github.io/underweb-media/w/<world-id>/<SLOT_ID>/<n>.jpg` plus `…/w/<world-id>/manifest.json` (which gallery images are active, rotation speed).

## Setup (once)

1. Copy the `UnderWebMedia` folder into your project's `Assets/`. Needs the VRChat Worlds SDK 3.5+ with UdonSharp.
2. **Tools → UnderWeb → Set Up Media Scripts** (creates the UdonSharp program assets).
3. On each poster object: **Add Component → UnderWeb Media Slot**.
   - **Slot ID**: same as on the website, e.g. `EVENT_BOARD_01`.
   - **Gallery Size**: 1 for a single poster, or the number of images for a rotating gallery (match the website).
   - **Target Renderer** + **Material Index**: the mesh showing the poster. **Texture Property**: usually `_MainTex` (Poiyomi/others may use a different name).
   - **Fallback**: a texture shown before loading or if a download fails.
4. **Tools → UnderWeb → Bake Media URLs**: enter your media host and the world id from the website, press **Bake**. It fills every slot's addresses and creates/updates one **UnderWeb Media** object that loads the manifest and refreshes slots (default every 15 min).
5. Upload the world. From now on, change posters on the website.

Re-run **Bake** only when you add, remove or rename slots (then upload the world again).

## Limits to know

- Players see new posters on join, or at the next refresh while they're in the world.
- If GitHub Pages is down, slots keep their current image or show the fallback.
- Images are public once published (anyone with the address can view them). Keep private material out of slots.

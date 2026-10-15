// Supabase Edge Function: world-media-publish
//
// Publishes what each world's poster slots should show *right now* to a GitHub
// Pages repo, at fixed addresses the VRChat world has baked in:
//
//   {MEDIA_BASE_URL}/w/{world-slug}/{SLOT_KEY}/{position}.jpg
//   {MEDIA_BASE_URL}/w/{world-slug}/manifest.json
//
// Why GitHub Pages: VRChat only downloads images (and strings) from an allow-list
// of hosts for players who haven't enabled "Allow Untrusted URLs"; *.github.io is
// on it, Supabase Storage is not. And Udon can't construct URLs at runtime, so the
// address per slot must never change — only the file behind it does.
//
// Callers:
//   - signed-in leadership from the dashboard (JWT checked with uw_can_manage_world_media)
//   - a cron job (header x-world-media-cron = WORLD_MEDIA_CRON_SECRET) to apply schedules
//
// Secrets (supabase secrets set …):
//   GITHUB_TOKEN            fine-grained token, Contents: read & write on MEDIA_REPO only
//   MEDIA_REPO              e.g. DOUGLASGUNZ/underweb-media
//   MEDIA_BRANCH            default "main"
//   WORLD_MEDIA_CRON_SECRET random string, only needed for scheduled publishing
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-world-media-cron",
};

const MAX_BYTES = 6 * 1024 * 1024;
const GH = "https://api.github.com";

type Slot = {
  id: string; world_id: string; slot_key: string; kind: string; gallery_size: number;
  rotate_seconds: number; aspect_w: number; aspect_h: number; max_px: number; label: string; room: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Read width/height from a JPEG or PNG without decoding it. */
export function imageSize(bytes: Uint8Array): { type: "jpeg" | "png"; width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    return { type: "png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { type: "jpeg", height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gh(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${Deno.env.get("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`github_${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** One commit with every changed file (git data API), so the world never sees a half-published state. */
async function commitFiles(files: { path: string; content: Uint8Array | string }[], message: string) {
  const repo = Deno.env.get("MEDIA_REPO")!;
  const branch = Deno.env.get("MEDIA_BRANCH") || "main";
  const ref = await gh(`/repos/${repo}/git/ref/heads/${branch}`);
  const parent = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    const blob = typeof f.content === "string"
      ? await gh(`/repos/${repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: f.content, encoding: "utf-8" }) })
      : await gh(`/repos/${repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: b64(f.content), encoding: "base64" }) });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh(`/repos/${repo}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree }) });
  const commit = await gh(`/repos/${repo}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [parent.sha] }) });
  await gh(`/repos/${repo}/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
  return commit.sha as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  try {
    if (!Deno.env.get("GITHUB_TOKEN") || !Deno.env.get("MEDIA_REPO")) return json({ error: "publisher_not_configured" }, 503);

    // --- who is calling ---
    let actor: string | null = null;
    const cronSecret = Deno.env.get("WORLD_MEDIA_CRON_SECRET");
    const isCron = Boolean(cronSecret) && req.headers.get("x-world-media-cron") === cronSecret;
    if (!isCron) {
      const auth = req.headers.get("Authorization");
      if (!auth) return json({ error: "sign_in_required" }, 401);
      const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: u } = await userClient.auth.getUser();
      if (!u?.user) return json({ error: "sign_in_required" }, 401);
      const { data: allowed, error } = await userClient.rpc("uw_can_manage_world_media");
      if (error || !allowed) return json({ error: "not_allowed" }, 403);
      actor = u.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const onlyWorld = typeof body?.world_id === "string" ? body.world_id : null;

    // --- what should be live ---
    let worldsQ = admin.from("world_media_worlds").select("id,slug,name");
    if (onlyWorld) worldsQ = worldsQ.eq("id", onlyWorld);
    const { data: worlds, error: wErr } = await worldsQ;
    if (wErr) throw wErr;
    if (!worlds?.length) return json({ error: "world_not_found" }, 404);

    const worldIds = worlds.map((w) => w.id);
    const { data: slots, error: sErr } = await admin.from("world_media_slots").select("*").in("world_id", worldIds).order("sort_order");
    if (sErr) throw sErr;
    const slotIds = (slots || []).map((s: Slot) => s.id);
    const { data: current, error: cErr } = slotIds.length
      ? await admin.from("world_media_current").select("slot_id,position,asset_id,caption").in("slot_id", slotIds)
      : { data: [], error: null };
    if (cErr) throw cErr;
    const assetIds = [...new Set((current || []).map((c) => c.asset_id))];
    const { data: assets } = assetIds.length
      ? await admin.from("world_media_assets").select("id,storage_path").in("id", assetIds)
      : { data: [] };
    const pathOf = Object.fromEntries((assets || []).map((a) => [a.id, a.storage_path]));

    // What's already on the host, so unchanged images aren't re-uploaded.
    const { data: published } = slotIds.length
      ? await admin.from("world_media_published").select("slot_id,position,asset_id").in("slot_id", slotIds)
      : { data: [] };
    const liveKey = new Set((published || []).map((p) => `${p.slot_id}:${p.position}:${p.asset_id}`));

    const files: { path: string; content: Uint8Array | string }[] = [];
    const nowPublished: { slot_id: string; position: number; asset_id: string }[] = [];
    const warnings: string[] = [];

    for (const world of worlds) {
      const manifest: Record<string, unknown> = {};
      for (const slot of (slots || []).filter((s: Slot) => s.world_id === world.id) as Slot[]) {
        const size = slot.kind === "gallery" ? slot.gallery_size : 1;
        const active: number[] = [];
        const captions: Record<string, string> = {};
        for (const c of (current || []).filter((c) => c.slot_id === slot.id && c.position <= size)) {
          const storagePath = pathOf[c.asset_id];
          if (!storagePath) continue;
          active.push(c.position);
          if (c.caption) captions[String(c.position)] = c.caption;
          nowPublished.push({ slot_id: slot.id, position: c.position, asset_id: c.asset_id });
          if (liveKey.has(`${slot.id}:${c.position}:${c.asset_id}`)) continue;
          const dl = await admin.storage.from("world-media").download(storagePath);
          if (dl.error || !dl.data) { warnings.push(`${slot.slot_key}#${c.position}: original missing`); active.pop(); continue; }
          const bytes = new Uint8Array(await dl.data.arrayBuffer());
          const info = imageSize(bytes);
          if (!info || info.type !== "jpeg") { warnings.push(`${slot.slot_key}#${c.position}: not a JPEG — re-upload from the dashboard`); active.pop(); continue; }
          if (info.width > 2048 || info.height > 2048 || bytes.length > MAX_BYTES) { warnings.push(`${slot.slot_key}#${c.position}: over VRChat's 2048px limit`); active.pop(); continue; }
          files.push({ path: `w/${world.slug}/${slot.slot_key}/${c.position}.jpg`, content: bytes });
        }
        active.sort((a, b) => a - b);
        manifest[slot.slot_key] = { kind: slot.kind, active, rotate: slot.rotate_seconds, captions };
      }
      files.push({
        path: `w/${world.slug}/manifest.json`,
        content: JSON.stringify({ world: world.slug, updated: new Date().toISOString(), slots: manifest }, null, 1),
      });
    }

    const sha = await commitFiles(files, `Publish world media (${worlds.map((w) => w.slug).join(", ")})${isCron ? " [schedule]" : ""}`);

    // Remember what is live now.
    for (const w of worlds) {
      const ids = (slots || []).filter((s: Slot) => s.world_id === w.id).map((s: Slot) => s.id);
      if (ids.length) await admin.from("world_media_published").delete().in("slot_id", ids);
    }
    if (nowPublished.length) await admin.from("world_media_published").insert(nowPublished.map((p) => ({ ...p, commit_sha: sha })));
    await admin.from("world_media_publish_log").insert(worlds.map((w) => ({
      actor, action: isCron ? "scheduled_publish" : "publish", world_id: w.id,
      detail: { commit: sha, images_uploaded: files.filter((f) => typeof f.content !== "string").length, warnings },
    })));

    return json({ ok: true, commit: sha, uploaded: files.length - worlds.length, warnings });
  } catch (error) {
    console.error(error);
    const msg = String((error as Error)?.message || error);
    return json({ error: msg.startsWith("github_") ? "github_publish_failed" : "publish_failed", detail: msg.slice(0, 300) }, 500);
  }
});

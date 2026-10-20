import { createClient } from "npm:@supabase/supabase-js@2";

// UWX updates for supporters only.
//   GET /uwx-releases   (Authorization: Bearer <UnderWeb session>)
// 200 -> GitHub-shaped release list (same fields UWX's updater already reads), newest first.
// 401 -> { error: "sign_in_required" }       402/403 -> { error: "supporter_required", patreon_url }
//
// Who counts as a supporter: an active Patreon/Inner Web membership (tier connected / signal / owner,
// not past ends_at), the Owner, and UnderWeb staff.
//
// Releases come from the underwebx repo. While it's public the normal download links are returned.
// Once it's private, set UWX_GITHUB_TOKEN (read-only, that repo only): each installer link is then
// a short-lived GitHub download link made for this request. UWX checks size + SHA-256 before installing.

const REPO = "DOUGLASGUNZ/underwebx";
const SETUP_NAME = /^UnderWebX_[\w.-]*_Setup\.exe$/i;
const RESOLVE_NEWEST = 3; // download links for the newest 3 Beta and newest 3 Stable releases
const STAFF_RANK = 55;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const token = Deno.env.get("UWX_GITHUB_TOKEN") || "";
const patreonUrl = Deno.env.get("UWX_PATREON_URL") || null;

type Asset = { id: number; name: string; size: number; digest?: string | null; state?: string; browser_download_url: string };
type Release = { tag_name: string; name: string | null; prerelease: boolean; draft: boolean; body: string | null; published_at: string | null; assets: Asset[] };

let cache: { at: number; releases: Release[] } | null = null;

async function gh(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "User-Agent": "UnderWeb-uwx-releases", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers as Record<string, string> || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetch(`https://api.github.com${path}`, { ...init, headers });
}

async function releases(): Promise<Release[]> {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.releases;
  const res = await gh(`/repos/${REPO}/releases?per_page=30`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`github_${res.status}`);
  const list = (await res.json()) as Release[];
  cache = { at: Date.now(), releases: list };
  return list;
}

/** A download link the PC can use without a GitHub login (private repo), or the public link. */
async function downloadUrl(asset: Asset): Promise<string | null> {
  if (!token) return asset.browser_download_url;
  const res = await gh(`/repos/${REPO}/releases/assets/${asset.id}`, { headers: { Accept: "application/octet-stream" }, redirect: "manual" });
  const loc = res.headers.get("location");
  await res.body?.cancel();
  if (res.status >= 300 && res.status < 400 && loc && loc.startsWith("https://")) return loc;
  return null;
}

async function isSupporter(userId: string): Promise<{ ok: boolean; why: string }> {
  const [mem, roles] = await Promise.all([
    admin.from("inner_web_memberships").select("tier,status,ends_at").eq("user_id", userId).maybeSingle(),
    admin.from("user_roles").select("role_slug,status").eq("user_id", userId).eq("status", "active"),
  ]);
  const m = mem.data as { tier: string; status: string; ends_at: string | null } | null;
  if (m && m.status === "active" && ["connected", "signal", "owner"].includes(m.tier) && (!m.ends_at || Date.parse(m.ends_at) > Date.now())) {
    return { ok: true, why: `membership:${m.tier}` };
  }
  const slugs = ((roles.data || []) as { role_slug: string }[]).map((r) => r.role_slug);
  if (slugs.includes("owner")) return { ok: true, why: "owner" };
  if (slugs.length) {
    const { data: defs } = await admin.from("role_definitions").select("slug,authority_rank").in("slug", slugs);
    if (((defs || []) as { authority_rank: number }[]).some((d) => Number(d.authority_rank) >= STAFF_RANK)) return { ok: true, why: "staff" };
  }
  return { ok: false, why: "none" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "sign_in_required", message: "Sign in to your UnderWeb account in UWX to get updates." }, 401);
  const { data: { user }, error: uErr } = await admin.auth.getUser(auth.slice(7));
  if (uErr || !user) return json({ error: "sign_in_required", message: "Sign in to your UnderWeb account in UWX to get updates." }, 401);

  let sup = await isSupporter(user.id);
  if (!sup.ok) {
    // Maybe they're a patron we haven't matched yet (e.g. just linked Discord): re-check once.
    try {
      await fetch(`${url}/functions/v1/supporters/me`, { method: "POST", headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } });
      sup = await isSupporter(user.id);
    } catch { /* keep the first answer */ }
  }
  if (!sup.ok) {
    return json({
      error: "supporter_required",
      message: "UWX updates are for UnderWeb Patreon supporters. Link the Discord you use on Patreon to your UnderWeb account, or ask staff.",
      patreon_url: patreonUrl,
    }, 403);
  }

  let list: Release[];
  try {
    list = await releases();
  } catch (e) {
    console.error("releases unavailable:", (e as Error).message);
    return json({ error: "releases_unavailable", message: "Couldn't reach the UWX release server. Try again later." }, 502);
  }

  const visible = list.filter((r) => !r.draft).sort((a, b) => Date.parse(b.published_at || "0") - Date.parse(a.published_at || "0"));
  const out = [];
  const seen = { beta: 0, stable: 0 };
  for (const r of visible) {
    const assets = [];
    const kind = r.prerelease ? "beta" : "stable";
    if (seen[kind]++ < RESOLVE_NEWEST) {
      for (const a of r.assets || []) {
        if (!SETUP_NAME.test(a.name) || (a.state && a.state !== "uploaded") || !/^sha256:[0-9a-f]{64}$/i.test(String(a.digest || ""))) continue;
        const link = await downloadUrl(a);
        if (link) assets.push({ name: a.name, size: a.size, digest: a.digest, state: "uploaded", browser_download_url: link });
      }
    }
    out.push({ tag_name: r.tag_name, name: r.name, prerelease: r.prerelease, draft: false, body: r.body, published_at: r.published_at, assets });
  }
  return json(out);
});

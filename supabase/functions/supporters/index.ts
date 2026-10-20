import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";

// UnderWeb supporters: who gets UWX (and Inner Web perks).
//
//   POST /supporters/webhook   Patreon → us. Signed with PATREON_WEBHOOK_SECRET (X-Patreon-Signature,
//                              HMAC-MD5 of the raw body). Records the patron and, if they match an
//                              UnderWeb account, turns their membership on/off.
//   POST /supporters/sync      Owner: pull every member from Patreon now (needs PATREON_CREATOR_TOKEN,
//                              optional PATREON_CAMPAIGN_ID) and re-match everyone.
//   GET  /supporters/list      Owner: patrons + memberships, for the Staff → Supporters tab.
//   POST /supporters/grant     Owner: { username, tier } manual membership (comps, friends, fixes).
//   POST /supporters/revoke    Owner: { user_id } turn a membership off.
//   POST /supporters/me        Signed in: re-check yourself (e.g. after linking Discord) → { supporter }.
//
// Matching: the Discord account the patron linked on Patreon = the Discord linked on UnderWeb;
// otherwise the same email address. Owner-tier and manual memberships are never touched by Patreon.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const WEBHOOK_SECRET = Deno.env.get("PATREON_WEBHOOK_SECRET") || "";
const CREATOR_TOKEN = Deno.env.get("PATREON_CREATOR_TOKEN") || "";
let CAMPAIGN_ID = Deno.env.get("PATREON_CAMPAIGN_ID") || "";
// Patreon tier titles (comma separated, case-insensitive) that get the higher "signal" tier.
const SIGNAL_TIERS = (Deno.env.get("PATREON_SIGNAL_TIERS") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const clip = (v: unknown, n: number) => (v == null ? null : String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) || null);

type Patron = {
  member_id: string; patreon_user_id: string | null; full_name: string | null; email: string | null;
  discord_user_id: string | null; patron_status: string | null; tier_titles: string[]; entitled_cents: number; last_event: string;
};
// deno-lint-ignore no-explicit-any
type Json = any;

// ---------- Patreon JSON:API → Patron ----------
function toPatron(member: Json, included: Json[], event: string): Patron | null {
  if (!member || member.type !== "member" || !member.id) return null;
  const a = member.attributes || {};
  const userRef = member.relationships?.user?.data;
  const user = userRef ? included.find((x) => x.type === "user" && x.id === userRef.id) : null;
  const tierIds: string[] = (member.relationships?.currently_entitled_tiers?.data || []).map((t: Json) => t.id);
  const tiers = included.filter((x) => x.type === "tier" && tierIds.includes(x.id)).map((t) => clip(t.attributes?.title, 80)).filter(Boolean) as string[];
  const discord = user?.attributes?.social_connections?.discord?.user_id;
  return {
    member_id: String(member.id),
    patreon_user_id: userRef?.id ? String(userRef.id) : null,
    full_name: clip(a.full_name, 120),
    email: clip(a.email, 254)?.toLowerCase() ?? null,
    discord_user_id: discord && /^\d{5,25}$/.test(String(discord)) ? String(discord) : null,
    patron_status: event === "members:delete" || event === "members:pledge:delete" ? "former_patron" : clip(a.patron_status, 40),
    tier_titles: tiers,
    entitled_cents: Number(a.currently_entitled_amount_cents) || 0,
    last_event: event,
  };
}

// ---------- matching + membership ----------
let emailIndex: Map<string, string> | null = null;
async function userIdByEmail(email: string): Promise<string | null> {
  if (!emailIndex) {
    emailIndex = new Map();
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data?.users?.length) break;
      for (const u of data.users) if (u.email) emailIndex.set(u.email.toLowerCase(), u.id);
      if (data.users.length < 1000) break;
    }
  }
  return emailIndex.get(email.toLowerCase()) || null;
}

async function matchUser(p: Patron): Promise<string | null> {
  if (p.discord_user_id) {
    const { data } = await admin.from("profiles").select("id").eq("discord_user_id", p.discord_user_id).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  if (p.email) return await userIdByEmail(p.email);
  return null;
}

const tierFor = (p: Patron) => (p.tier_titles.some((t) => SIGNAL_TIERS.includes(t.toLowerCase())) ? "signal" : "connected");
const statusFor = (p: Patron) =>
  p.patron_status === "active_patron" ? "active" : p.patron_status === "declined_patron" ? "past_due" : p.patron_status === "former_patron" ? "cancelled" : "inactive";

async function applyMembership(userId: string, p: Patron) {
  const { data: cur } = await admin.from("inner_web_memberships").select("provider,tier,status,started_at").eq("user_id", userId).maybeSingle();
  if (cur && (cur.tier === "owner" || (cur.provider === "manual" && cur.status === "active"))) return "kept";
  const status = statusFor(p);
  const now = new Date().toISOString();
  const { error } = await admin.from("inner_web_memberships").upsert({
    user_id: userId,
    provider: "patreon",
    provider_member_id: p.member_id,
    tier: status === "active" ? tierFor(p) : (cur?.tier && cur.tier !== "none" ? cur.tier : "connected"),
    status,
    started_at: cur?.started_at || (status === "active" ? now : null),
    ends_at: null,
    last_synced_at: now,
    updated_at: now,
  }, { onConflict: "user_id" });
  if (error) throw error;
  return status;
}

async function record(p: Patron) {
  const userId = await matchUser(p);
  const { error } = await admin.from("patreon_members").upsert({ ...p, matched_user_id: userId, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
  if (error) throw error;
  const result = userId ? await applyMembership(userId, p) : "unmatched";
  return { member_id: p.member_id, matched: Boolean(userId), result };
}

// ---------- auth helpers ----------
async function caller(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const { data: { user } } = await admin.auth.getUser(auth.slice(7));
  return user || null;
}
async function isOwner(userId: string) {
  const { data } = await admin.from("user_roles").select("role_slug").eq("user_id", userId).eq("role_slug", "owner").eq("status", "active").limit(1);
  return Boolean(data?.length);
}

// ---------- Patreon API (owner sync) ----------
async function patreon(path: string) {
  const res = await fetch(`https://www.patreon.com/api/oauth2/v2${path}`, { headers: { Authorization: `Bearer ${CREATOR_TOKEN}`, "User-Agent": "UnderWeb-supporters" } });
  if (!res.ok) throw new Error(`patreon_${res.status}`);
  return await res.json();
}
async function fullSync() {
  if (!CAMPAIGN_ID) {
    const c = await patreon("/campaigns");
    CAMPAIGN_ID = c?.data?.[0]?.id || "";
    if (!CAMPAIGN_ID) throw new Error("no_campaign");
  }
  const fields = "fields%5Bmember%5D=full_name,email,patron_status,currently_entitled_amount_cents&fields%5Buser%5D=social_connections&fields%5Btier%5D=title";
  let next: string | null = `/campaigns/${CAMPAIGN_ID}/members?include=user,currently_entitled_tiers&${fields}&page%5Bcount%5D=500`;
  const out = { seen: 0, matched: 0, active: 0 };
  while (next) {
    const page = await patreon(next);
    for (const m of page.data || []) {
      const p = toPatron(m, page.included || [], "sync");
      if (!p) continue;
      const r = await record(p);
      out.seen++;
      if (r.matched) out.matched++;
      if (p.patron_status === "active_patron") out.active++;
    }
    const link: string | undefined = page.links?.next;
    next = link ? link.replace("https://www.patreon.com/api/oauth2/v2", "") : null;
  }
  return out;
}

// ---------- routes ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";

  try {
    if (route === "webhook" && req.method === "POST") {
      if (!WEBHOOK_SECRET) return json({ error: "not_configured" }, 503);
      const raw = await req.text();
      const sig = (req.headers.get("X-Patreon-Signature") || "").trim().toLowerCase();
      const want = createHmac("md5", WEBHOOK_SECRET).update(raw).digest("hex");
      if (!sig || sig.length !== want.length || !timingSafeEqual(new TextEncoder().encode(sig), new TextEncoder().encode(want))) {
        return json({ error: "bad_signature" }, 401);
      }
      const body = JSON.parse(raw);
      const p = toPatron(body.data, body.included || [], String(req.headers.get("X-Patreon-Event") || "members:update"));
      if (!p) return json({ ok: true, ignored: true });
      return json({ ok: true, ...(await record(p)) });
    }

    const user = await caller(req);
    if (!user) return json({ error: "sign_in_required" }, 401);

    if (route === "me" && req.method === "POST") {
      // Re-match yourself against patrons we already know about (e.g. you just linked Discord).
      const { data: prof } = await admin.from("profiles").select("discord_user_id").eq("id", user.id).maybeSingle();
      let row: Json = null;
      if (prof?.discord_user_id) {
        const { data } = await admin.from("patreon_members").select("*").eq("discord_user_id", prof.discord_user_id).order("updated_at", { ascending: false }).limit(1);
        row = data?.[0] || null;
      }
      if (!row && user.email) {
        const { data } = await admin.from("patreon_members").select("*").eq("email", user.email.toLowerCase()).order("updated_at", { ascending: false }).limit(1);
        row = data?.[0] || null;
      }
      if (row) {
        await admin.from("patreon_members").update({ matched_user_id: user.id }).eq("member_id", row.member_id);
        await applyMembership(user.id, row as Patron);
      }
      const { data: m } = await admin.from("inner_web_memberships").select("tier,status,provider").eq("user_id", user.id).maybeSingle();
      return json({ ok: true, supporter: Boolean(m && m.status === "active" && m.tier !== "none"), membership: m || null });
    }

    if (!(await isOwner(user.id))) return json({ error: "owner_only" }, 403);

    if (route === "sync" && req.method === "POST") {
      if (!CREATOR_TOKEN) return json({ error: "not_configured", message: "Add PATREON_CREATOR_TOKEN in Supabase first." }, 503);
      return json({ ok: true, ...(await fullSync()) });
    }

    if (route === "list" && req.method === "GET") {
      const [patrons, members] = await Promise.all([
        admin.from("patreon_members").select("member_id,full_name,discord_user_id,patron_status,tier_titles,entitled_cents,matched_user_id,updated_at").order("updated_at", { ascending: false }).limit(500),
        admin.from("inner_web_memberships").select("user_id,provider,tier,status,started_at,last_synced_at").order("updated_at", { ascending: false }).limit(500),
      ]);
      const ids = [...new Set([...(members.data || []).map((m: Json) => m.user_id), ...(patrons.data || []).map((p: Json) => p.matched_user_id).filter(Boolean)])];
      const { data: profs } = ids.length ? await admin.from("profiles").select("id,display_name,username").in("id", ids) : { data: [] };
      const names = Object.fromEntries((profs || []).map((p: Json) => [p.id, { name: p.display_name || p.username || "", username: p.username || "" }]));
      return json({
        ok: true,
        configured: { webhook: Boolean(WEBHOOK_SECRET), sync: Boolean(CREATOR_TOKEN) },
        patrons: (patrons.data || []).map((p: Json) => ({ ...p, account: p.matched_user_id ? names[p.matched_user_id] || null : null })),
        memberships: (members.data || []).map((m: Json) => ({ ...m, account: names[m.user_id] || null })),
      });
    }

    if (route === "grant" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const username = String(body.username || "").replace(/^@/, "").trim().toLowerCase();
      const tier = body.tier === "signal" ? "signal" : "connected";
      if (!/^[a-z0-9_.-]{2,40}$/.test(username)) return json({ error: "username_required", message: "Enter their UnderWeb username." }, 400);
      const { data: prof } = await admin.from("profiles").select("id").eq("username", username).limit(1);
      const target = prof?.[0]?.id;
      if (!target) return json({ error: "not_found", message: "No UnderWeb account with that username." }, 404);
      const { data: cur } = await admin.from("inner_web_memberships").select("tier").eq("user_id", target).maybeSingle();
      if (cur?.tier === "owner") return json({ error: "owner_row", message: "That's an owner membership; leaving it alone." }, 409);
      const now = new Date().toISOString();
      const { error } = await admin.from("inner_web_memberships").upsert(
        { user_id: target, provider: "manual", provider_member_id: `granted-by:${user.id}`, tier, status: "active", started_at: now, ends_at: null, last_synced_at: now, updated_at: now },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      return json({ ok: true, user_id: target, tier });
    }

    if (route === "revoke" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const target = String(body.user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(target)) return json({ error: "user_id_required" }, 400);
      if (target === user.id) return json({ error: "self", message: "You can't revoke your own owner access." }, 409);
      const { error } = await admin.from("inner_web_memberships").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("user_id", target).neq("tier", "owner");
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("supporters error:", (e as Error)?.message || e);
    return json({ error: "server_error", message: (e as Error)?.message || "Something went wrong." }, 500);
  }
});

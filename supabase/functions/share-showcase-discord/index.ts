import { createClient } from "npm:@supabase/supabase-js@2";

// Post an already-approved showcase piece to the UnderWeb Discord, after the fact.
//   POST { media_id }  (signed in)
// Who: the person who posted it, or a media reviewer.
// What: only staff-approved items, and each item at most once (discord_posted_at is
// claimed atomically before posting, so double clicks can't double post).
// Same webhook and embed as approve-showcase-media.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

type Media = {
  id: string; user_id: string; title: string | null; caption: string | null; media_type: string | null;
  media_url: string | null; moderation_status: string; discord_posted_at: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const webhook = Deno.env.get("SHOWCASE_DISCORD_WEBHOOK_URL") || "";
  if (!DISCORD_WEBHOOK_RE.test(webhook)) return json({ error: "Discord sharing isn't set up" }, 503);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const token = auth.slice(7);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) return json({ error: "Invalid session" }, 401);

  const body = await req.json().catch(() => null);
  const mediaId = String(body?.media_id || "");
  if (!UUID.test(mediaId)) return json({ error: "media_id is required" }, 400);

  const { data: media, error: mErr } = await admin
    .from("creator_showcase")
    .select("id,user_id,title,caption,media_type,media_url,moderation_status,discord_posted_at")
    .eq("id", mediaId)
    .maybeSingle();
  if (mErr || !media) return json({ error: "Not found" }, 404);
  const m = media as Media;

  if (m.user_id !== user.id) {
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: canReview } = await userClient.rpc("uw_can_review_media");
    if (canReview !== true) return json({ error: "Only the poster or staff can share this" }, 403);
  }
  if (m.moderation_status !== "approved") return json({ error: "Staff need to approve it first" }, 409);
  if (m.discord_posted_at) return json({ ok: true, status: "already_posted" });
  const storagePrefix = `${url}/storage/v1/object/public/`;
  if (!String(m.media_url || "").startsWith(storagePrefix)) return json({ error: "Only UnderWeb uploads can be shared" }, 400);

  // Claim it first so two clicks can't post twice.
  const claimedAt = new Date().toISOString();
  const { data: claimed } = await admin
    .from("creator_showcase")
    .update({ discord_posted_at: claimedAt, share_to_discord: true })
    .eq("id", m.id)
    .is("discord_posted_at", null)
    .select("id");
  if (!claimed?.length) return json({ ok: true, status: "already_posted" });

  const { data: profile } = await admin.from("profiles").select("display_name,vrchat_username,username").eq("id", m.user_id).maybeSingle();
  const name = clip(profile?.vrchat_username || profile?.display_name || profile?.username || "An UnderWeb member", 80);
  const isImage = (m.media_type || "image") === "image";
  const embed: Record<string, unknown> = {
    title: clip(m.title || "Untitled", 200),
    url: `https://underweb.cloud/#profile=${encodeURIComponent(m.user_id)}`,
    color: 0x38ff72,
    author: { name: `📸 ${name}` },
    footer: { text: "UnderWeb showcase · approved by staff" },
    timestamp: claimedAt,
  };
  if (m.caption) embed.description = clip(m.caption, 1000);
  if (isImage) embed.image = { url: m.media_url };
  else embed.description = `${embed.description ? `${embed.description}\n\n` : ""}▶ ${m.media_url}`;

  const payload = JSON.stringify({ username: "UnderWeb Gallery", embeds: [embed], allowed_mentions: { parse: [] } });
  const post = () => fetch(`${webhook}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
  let ok = false;
  try {
    let res = await post();
    if (res.status === 429) {
      const retry = Number((await res.json().catch(() => ({})))?.retry_after) || 1;
      await new Promise((r) => setTimeout(r, Math.min(5, retry) * 1000));
      res = await post();
    }
    ok = res.ok;
    if (!ok) console.error("Discord share failed with status", res.status);
  } catch (e) {
    console.error("Discord share error:", (e as Error)?.message || e);
  }
  if (!ok) {
    // Release the claim so they can try again.
    await admin.from("creator_showcase").update({ discord_posted_at: null }).eq("id", m.id).eq("discord_posted_at", claimedAt);
    return json({ error: "Discord didn't take it — try again in a minute" }, 502);
  }
  return json({ ok: true, status: "posted" });
});

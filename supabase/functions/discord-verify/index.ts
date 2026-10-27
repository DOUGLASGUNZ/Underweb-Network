// UnderWeb Discord verification bot (Discord "Interactions Endpoint URL" — no always-on bot process).
//
// Flow
//   #verify has a panel with a "Verify" button (posted from Staff Tools → Owner).
//   Verify → a form asking for their VRChat profile link →
//     * that VRChat account is verified on underweb.cloud AND its UnderWeb account is linked to THIS Discord account
//         → they get the Verified role right away.
//     * anything else → a request in the staff channel with Approve / Deny buttons (who/what only — no private data).
//   Approve gives the Verified role; Deny just closes it (they can try again later).
//
// Secrets
//   DISCORD_PUBLIC_KEY        app's public key (Developer Portal → General Information)
//   DISCORD_BOT_TOKEN         bot token (Developer Portal → Bot)
//   DISCORD_GUILD_ID          the UnderWeb server id
//   DISCORD_VERIFIED_ROLE_ID  role that unlocks the server
//   DISCORD_STAFF_CHANNEL_ID  private channel where staff approve / deny
//   DISCORD_STAFF_ROLE_ID     role allowed to approve (people with Manage Roles / Administrator can too)
//   DISCORD_VERIFY_CHANNEL_ID channel the panel is posted in
//
// POST with a website session { action: "status" | "post_panel" } — Owner / Director (rank >= 90) only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) || "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const API = "https://discord.com/api/v10";
const SITE = "https://underweb.cloud";
const GREEN = 0x3df514, AMBER = 0xc98500, RED = 0xd55181;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

// ───────── Discord request signature (Ed25519) ─────────
const hex = (h: string) => new Uint8Array((h.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));
let keyPromise: Promise<CryptoKey> | null = null;
async function verifySignature(req: Request, body: string) {
  const sig = req.headers.get("X-Signature-Ed25519");
  const ts = req.headers.get("X-Signature-Timestamp");
  if (!sig || !ts || !env("DISCORD_PUBLIC_KEY")) return false;
  keyPromise ??= crypto.subtle.importKey("raw", hex(env("DISCORD_PUBLIC_KEY")), { name: "Ed25519" }, false, ["verify"]);
  try {
    return await crypto.subtle.verify("Ed25519", await keyPromise, hex(sig), new TextEncoder().encode(ts + body));
  } catch {
    return false;
  }
}

async function discord(path: string, init: RequestInit & { reason?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}`, "Content-Type": "application/json" };
  if (init.reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(init.reason);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok && res.status !== 204) throw new Error(`discord_${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : await res.json();
}
const giveVerifiedRole = (userId: string, reason: string) =>
  discord(`/guilds/${env("DISCORD_GUILD_ID")}/members/${userId}/roles/${env("DISCORD_VERIFIED_ROLE_ID")}`, { method: "PUT", reason });

// ───────── helpers ─────────
const ephemeral = (content: string) => json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
const VRC_ID = /usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const accountAge = (snowflake: string) => {
  const ms = Number((BigInt(snowflake) >> 22n) + 1420070400000n);
  const days = Math.floor((Date.now() - ms) / 86400000);
  return { ms, text: days < 1 ? "created today" : days < 60 ? `${days} days old` : `${Math.floor(days / 30)} months old` };
};
function isStaff(member: { roles?: string[]; permissions?: string }) {
  if (env("DISCORD_STAFF_ROLE_ID") && (member.roles || []).includes(env("DISCORD_STAFF_ROLE_ID"))) return true;
  const p = BigInt(member.permissions || "0");
  return (p & (1n << 3n)) !== 0n || (p & (1n << 28n)) !== 0n; // Administrator or Manage Roles
}
const clip = (s: unknown, n: number) => String(s ?? "").replace(/[`*_~|>@]/g, "").slice(0, n);

// ───────── interactions ─────────
type Interaction = {
  type: number; guild_id?: string;
  member?: { user: { id: string; username: string; global_name?: string }; roles?: string[]; permissions?: string };
  data?: { custom_id?: string; components?: Array<{ components: Array<{ custom_id: string; value: string }> }> };
  message?: { id: string; embeds?: Array<Record<string, unknown>> };
};

function verifyModal() {
  return json({
    type: 9,
    data: {
      custom_id: "uwv:modal",
      title: "Verify for The UnderWeb",
      components: [{
        type: 1,
        components: [{
          type: 4, custom_id: "vrc", style: 1, required: true, min_length: 10, max_length: 200,
          label: "Your VRChat profile link",
          placeholder: "https://vrchat.com/home/user/usr_...",
        }],
      }],
    },
  });
}

async function onSubmit(i: Interaction) {
  const user = i.member!.user;
  const raw = i.data?.components?.[0]?.components?.[0]?.value?.trim() || "";
  const vrc = (raw.match(VRC_ID)?.[0] || "").toLowerCase();
  if (!vrc) {
    return ephemeral("That doesn't look like a VRChat profile link. In VRChat or on vrchat.com, open your profile and copy the link — it has `usr_` in it.");
  }
  const vrcUrl = `https://vrchat.com/home/user/${vrc}`;

  // Already waiting on staff?
  const { data: pending } = await admin.from("discord_verify_requests").select("id").eq("discord_user_id", user.id).eq("outcome", "pending").maybeSingle();
  if (pending) return ephemeral("You're already waiting for staff to check you — hang tight, they'll let you in soon.");
  const { data: denied } = await admin.from("discord_verify_requests").select("id").eq("discord_user_id", user.id).eq("outcome", "denied")
    .gte("decided_at", new Date(Date.now() - 24 * 3600000).toISOString()).limit(1);
  if (denied?.length) return ephemeral("Staff didn't approve your last request. You can try again tomorrow, or message a staff member.");

  const { data: match } = await admin.rpc("uw_discord_verify_match", { p_vrc_user_id: vrc });
  const owner = Array.isArray(match) ? match[0] : null;
  const name = clip(user.global_name || user.username, 64);

  // 1) Verified on UnderWeb and it's their own Discord → straight in.
  if (owner && (owner.discord_ids || []).includes(user.id)) {
    try {
      await giveVerifiedRole(user.id, "Verified via underweb.cloud (VRChat + Discord match)");
    } catch (e) {
      console.error("role", String(e));
      return ephemeral("You matched, but I couldn't give you the role (a bot permission problem). Please ping a staff member.");
    }
    await admin.from("discord_verify_requests").insert({
      discord_user_id: user.id, discord_username: name, vrc_user_id: vrc, vrc_url: vrcUrl,
      underweb_user_id: owner.user_id, outcome: "auto_verified", reason: "VRChat verified on underweb.cloud and linked to this Discord",
      decided_at: new Date().toISOString(),
    });
    return ephemeral("✅ You're verified — welcome to The UnderWeb! The rest of the server is open now.");
  }

  // 2) Everything else → staff.
  const myAccount = (await admin.rpc("uw_discord_account_of", { p_discord_id: user.id })).data as string | null;
  let reason: string;
  let tip: string;
  if (owner && !(owner.discord_ids || []).length) {
    reason = "This VRChat account is verified on underweb.cloud, but that account has no Discord linked";
    tip = `Want in instantly next time? Sign in at ${SITE} and link your Discord, then press Verify again.`;
  } else if (owner) {
    reason = "⚠️ This VRChat account is verified on underweb.cloud by a DIFFERENT Discord account";
    tip = "Staff will check this.";
  } else if (myAccount) {
    reason = "Has an UnderWeb account, but this VRChat account isn't verified on it yet";
    tip = `Verify your VRChat on ${SITE} to get in instantly next time.`;
  } else {
    reason = "Not on underweb.cloud";
    tip = `Joining ${SITE} and verifying your VRChat gets you in instantly next time.`;
  }

  const { data: row, error } = await admin.from("discord_verify_requests").insert({
    discord_user_id: user.id, discord_username: name, vrc_user_id: vrc, vrc_url: vrcUrl,
    underweb_user_id: myAccount, outcome: "pending", reason,
  }).select("id").single();
  if (error || !row) {
    console.error("insert", error);
    return ephemeral("Something went wrong saving your request. Please try again in a minute.");
  }

  const age = accountAge(user.id);
  try {
    const msg = await discord(`/channels/${env("DISCORD_STAFF_CHANNEL_ID")}/messages`, {
      method: "POST",
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: "Verification request",
          color: owner ? RED : AMBER,
          fields: [
            { name: "Discord", value: `<@${user.id}> (${name})`, inline: true },
            { name: "Discord account", value: age.text + (Date.now() - age.ms < 7 * 86400000 ? " ⚠️" : ""), inline: true },
            { name: "VRChat", value: `[Open profile](${vrcUrl})`, inline: true },
            { name: "Why staff", value: reason },
          ],
          footer: { text: "Check their VRChat profile looks real (age, trust rank, not a known troublemaker) before approving." },
          timestamp: new Date().toISOString(),
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: "Approve", custom_id: `uwv:approve:${row.id}` },
            { type: 2, style: 4, label: "Deny", custom_id: `uwv:deny:${row.id}` },
          ],
        }],
      }),
    });
    await admin.from("discord_verify_requests").update({ staff_message_id: msg?.id || null }).eq("id", row.id);
  } catch (e) {
    // Staff never saw it: don't leave them stuck "waiting".
    console.error("staff post", String(e));
    await admin.from("discord_verify_requests").delete().eq("id", row.id);
    return ephemeral("I couldn't reach the staff channel (a bot setup problem). Please ping a staff member to let you in.");
  }
  return ephemeral(`Thanks! A staff member will check you shortly and let you in. ${tip}`);
}

async function onStaffDecision(i: Interaction, approve: boolean, id: string) {
  const staff = i.member!;
  if (!isStaff(staff)) return ephemeral("Only staff can do that.");
  const { data: r } = await admin.from("discord_verify_requests").select("*").eq("id", id).maybeSingle();
  if (!r) return ephemeral("I can't find that request anymore.");
  if (r.outcome !== "pending") return ephemeral(`Already ${r.outcome}.`);

  if (approve) {
    try {
      await giveVerifiedRole(r.discord_user_id, `Approved by ${staff.user.username}`);
    } catch (e) {
      const left = String(e).includes("discord_404");
      return ephemeral(left ? "They're not in the server anymore." : "I couldn't give the role — check the bot's role is above Verified.");
    }
  }
  const { data: updated } = await admin.from("discord_verify_requests").update({
    outcome: approve ? "approved" : "denied", decided_by_discord_id: staff.user.id, decided_at: new Date().toISOString(),
  }).eq("id", id).eq("outcome", "pending").select("id");
  if (!updated?.length) return ephemeral("Someone else just handled this one.");

  const embed = { ...(i.message?.embeds?.[0] || {}) } as Record<string, unknown>;
  embed.color = approve ? GREEN : RED;
  embed.title = approve ? "Verification approved" : "Verification denied";
  embed.footer = { text: `${approve ? "Approved" : "Denied"} by ${clip(staff.user.global_name || staff.user.username, 64)}` };
  return json({ type: 7, data: { embeds: [embed], components: [] } });
}

async function handleInteraction(req: Request) {
  const body = await req.text();
  if (!(await verifySignature(req, body))) return new Response("bad signature", { status: 401 });
  const i = JSON.parse(body) as Interaction;
  if (i.type === 1) return json({ type: 1 }); // PING
  if (!i.member || (env("DISCORD_GUILD_ID") && i.guild_id !== env("DISCORD_GUILD_ID"))) return ephemeral("This only works in The UnderWeb server.");

  const id = i.data?.custom_id || "";
  if (i.type === 3 && id === "uwv:start") {
    if ((i.member.roles || []).includes(env("DISCORD_VERIFIED_ROLE_ID"))) return ephemeral("You're already verified. 👍");
    return verifyModal();
  }
  if (i.type === 5 && id === "uwv:modal") return await onSubmit(i);
  const m = id.match(/^uwv:(approve|deny):([0-9a-f-]{36})$/);
  if (i.type === 3 && m) return await onStaffDecision(i, m[1] === "approve", m[2]);
  return ephemeral("That button is out of date.");
}

// ───────── website: status / post the panel (Owner / Director) ─────────
async function handleSite(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "sign_in_required" }, 401, cors);
  const { data: rank } = await userClient.rpc("uw_max_role_rank");
  if (Number(rank || 0) < 90) return json({ error: "not_allowed" }, 403, cors);

  const body = await req.json().catch(() => ({}));
  const required = ["DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_VERIFIED_ROLE_ID", "DISCORD_STAFF_CHANNEL_ID", "DISCORD_VERIFY_CHANNEL_ID"];
  const missing = required.filter((k) => !env(k));
  if (body?.action === "status") {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: rows } = await admin.from("discord_verify_requests").select("outcome").gte("created_at", since);
    const { count: waiting } = await admin.from("discord_verify_requests").select("id", { count: "exact", head: true }).eq("outcome", "pending");
    const week: Record<string, number> = {};
    for (const r of rows || []) week[r.outcome] = (week[r.outcome] || 0) + 1;
    let bot: string | null = null;
    if (env("DISCORD_BOT_TOKEN")) {
      try {
        bot = ((await discord("/users/@me")) as { username: string }).username;
      } catch {
        bot = null;
      }
    }
    return json({ missing, bot, waiting: waiting || 0, week }, 200, cors);
  }
  if (body?.action === "post_panel") {
    if (missing.length) return json({ error: "not_configured", missing }, 400, cors);
    try {
      await discord(`/channels/${env("DISCORD_VERIFY_CHANNEL_ID")}/messages`, {
        method: "POST",
        body: JSON.stringify({
          embeds: [{
            title: "Welcome to The UnderWeb",
            color: GREEN,
            description:
              "Press **Verify** and paste your **VRChat profile link** to get into the server.\n\n" +
              `• Already verified on **${SITE}** with this Discord linked? You're let in instantly.\n` +
              "• Otherwise a staff member checks you and lets you in — usually quickly.\n\n" +
              "Find your link: VRChat → your profile → Share, or vrchat.com → your profile (it has `usr_` in it).",
          }],
          components: [{ type: 1, components: [{ type: 2, style: 3, label: "Verify", custom_id: "uwv:start" }] }],
        }),
      });
      return json({ ok: true }, 200, cors);
    } catch (e) {
      return json({ error: "discord_failed", detail: String(e).slice(0, 200) }, 502, cors);
    }
  }
  return json({ error: "bad_request" }, 400, cors);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (req.headers.get("X-Signature-Ed25519")) return await handleInteraction(req);
  return await handleSite(req);
});

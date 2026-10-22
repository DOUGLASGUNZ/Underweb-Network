import { createClient } from "npm:@supabase/supabase-js@2";

// UnderWeb moderation log → a private staff Discord channel.
//   POST {}                    flush anything new (any staff member's UWX / website calls this; safe to call often)
//   POST { backfill: true }    one-time history summary (group owner level 4 only)
//   POST { status: true }      is it configured? when did it last post?
// Posts: VRChat bans / unbans / removals / instance kicks & warnings / join-request blocks (from the shared
// group archive) and case events (opened, status, recorded actions, appeals, decisions).
// Never posts: evidence, notes, free-text bodies, locations, instance links or IPs.
// Each item is posted at most once: cursors are advanced with compare-and-swap BEFORE posting.
// Only UnderWeb's own groups (not partner groups) post to this webhook.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const clip = (v: unknown, max: number) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const ts = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:f>`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const EVENT_TYPES: Record<string, { icon: string; label: string }> = {
  "group.user.ban": { icon: "⛔", label: "Banned" },
  "group.user.unban": { icon: "✅", label: "Unbanned" },
  "group.member.remove": { icon: "👢", label: "Removed from group" },
  "group.instance.kick": { icon: "🥾", label: "Kicked from instance" },
  "group.instance.warn": { icon: "⚠️", label: "Warned in instance" },
  "group.request.block": { icon: "🚫", label: "Join requests blocked" },
};
const STATUS: Record<string, string> = {
  open: "Open", under_review: "Under Review", escalated: "Escalated", resolved: "Resolved", dismissed: "Dismissed", appealed: "Appealed",
};
const ACTIONS: Record<string, string> = {
  warning: "Warning", kick: "Removed from group", ban: "Group ban", unban: "Unban", instance_kick: "Instance kick", instance_warn: "Instance warn", other: "Action",
};
const SEV: Record<string, string> = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" };

async function post(webhook: string, embeds: unknown[]) {
  for (let i = 0; i < embeds.length; i += 4) {
    const res = await fetch(`${webhook}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "UnderWeb Mod Log", allowed_mentions: { parse: [] }, embeds: embeds.slice(i, i + 4) }),
    });
    if (res.status === 429) {
      const retry = Number((await res.json().catch(() => ({})))?.retry_after || 2);
      await sleep(Math.min(10, retry) * 1000);
      i -= 4;
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${res.status}`);
    await sleep(800);
  }
}

/** Lines → embeds of at most ~3500 chars each. */
function pack(title: string, color: number, lines: string[], footer?: string) {
  const out: unknown[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length + 1 > 3500 && buf.length) {
      out.push({ title, color, description: buf.join("\n"), footer: footer ? { text: footer } : undefined });
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += line.length + 1;
  }
  if (buf.length) out.push({ title, color, description: buf.join("\n"), footer: footer ? { text: footer } : undefined });
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const webhook = (Deno.env.get("UWX_MOD_DISCORD_WEBHOOK") || "").trim();
  const configured = WEBHOOK_RE.test(webhook);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: mine, error: gErr } = await userClient.rpc("uwx_my_groups");
  if (gErr) return json({ error: "Group Intelligence isn't set up", detail: gErr.message }, 503);
  const { data: allGroups } = await admin.from("uwx_groups").select("id,name,role_scope").eq("status", "active");
  const own = new Set((allGroups || []).filter((g) => !String(g.role_scope).startsWith("partner:")).map((g) => g.id));
  const groups = (mine || []).filter((g: { id: string; level: number }) => own.has(g.id) && g.level >= 1);
  if (!groups.length) return json({ error: "No UnderWeb group you staff" }, 403);

  const body = await req.json().catch(() => ({}));

  if (body?.status) {
    const { data: st } = await admin.from("uwx_discord_state").select("*").in("group_id", groups.map((g: { id: string }) => g.id));
    return json({ configured, groups: st || [] });
  }
  if (!configured) return json({ error: "UWX_MOD_DISCORD_WEBHOOK isn't set (or isn't a Discord webhook URL)" }, 503);

  const results: unknown[] = [];
  for (const g of groups as { id: string; name: string; level: number }[]) {
    let { data: state } = await admin.from("uwx_discord_state").select("*").eq("group_id", g.id).maybeSingle();
    if (!state) {
      // First run: start from now so turning this on doesn't dump the whole archive (use backfill for that).
      const { data: maxEntry } = await admin.from("uwx_case_entries").select("id").order("id", { ascending: false }).limit(1);
      const init = { group_id: g.id, events_cursor: new Date().toISOString(), entries_cursor: maxEntry?.[0]?.id || 0 };
      await admin.from("uwx_discord_state").upsert(init, { onConflict: "group_id", ignoreDuplicates: true });
      ({ data: state } = await admin.from("uwx_discord_state").select("*").eq("group_id", g.id).maybeSingle());
    }

    try {
      // ── backfill: one summary of the saved history ──
      if (body?.backfill) {
        if (g.level < 4) { results.push({ group: g.name, backfill: "owner only" }); continue; }
        const { data: claimed } = await admin.from("uwx_discord_state").update({ backfilled_at: new Date().toISOString() })
          .eq("group_id", g.id).is("backfilled_at", null).select("group_id");
        if (!claimed?.length && !body?.force) { results.push({ group: g.name, backfill: "already done" }); continue; }
        const types = Object.keys(EVENT_TYPES);
        const { data: evs } = await admin.from("uwx_group_events").select("event_type,occurred_at,description")
          .eq("group_id", g.id).in("event_type", types).order("occurred_at", { ascending: true }).limit(20000);
        const list = evs || [];
        const totals = types.map((t) => `${EVENT_TYPES[t].icon} ${EVENT_TYPES[t].label}: **${list.filter((e) => e.event_type === t).length}**`);
        const byMonth = new Map<string, number>();
        for (const e of list) {
          const k = e.occurred_at.slice(0, 7);
          byMonth.set(k, (byMonth.get(k) || 0) + 1);
        }
        const { data: cases } = await admin.from("uwx_cases").select("case_number,title,status,severity,subject_name,created_at")
          .eq("group_id", g.id).in("status", ["open", "under_review", "escalated", "appealed"]).order("created_at").limit(50);
        const embeds = [
          {
            title: `📚 ${g.name} — moderation history`,
            color: 0x38ff72,
            description: list.length
              ? `From ${ts(list[0].occurred_at)} to ${ts(list[list.length - 1].occurred_at)} (what UWX staff have synced).\n\n${totals.join("\n")}`
              : "No synced moderation history yet. Staff UWX clients add it as they sync.",
            fields: byMonth.size ? [{ name: "Per month", value: clip([...byMonth].map(([m, n]) => `${m}: ${n}`).join(" · "), 1000) }] : undefined,
          },
          ...pack("Last 25 recorded", 0x2b2d31, list.slice(-25).reverse().map((e) => `${EVENT_TYPES[e.event_type].icon} ${ts(e.occurred_at)} — ${clip(e.description || EVENT_TYPES[e.event_type].label, 160)}`)),
          ...(cases?.length
            ? pack("Open cases", 0xfab219, cases.map((c) => `${SEV[c.severity] || ""} **#${c.case_number}** ${clip(c.title, 90)}${c.subject_name ? ` — ${clip(c.subject_name, 40)}` : ""} · ${STATUS[c.status]}`))
            : []),
        ];
        await post(webhook, embeds);
        results.push({ group: g.name, backfill: list.length });
        continue;
      }

      // ── VRChat audit events uploaded since the cursor ──
      const evCursor = state!.events_cursor || new Date().toISOString();
      const { data: evs } = await admin.from("uwx_group_events")
        .select("vrchat_event_id,occurred_at,uploaded_at,event_type,actor_name,description")
        .eq("group_id", g.id).in("event_type", Object.keys(EVENT_TYPES)).gt("uploaded_at", evCursor)
        .order("uploaded_at", { ascending: true }).limit(200);
      // ── case entries since the cursor ──
      const { data: ents } = await admin.from("uwx_case_entries")
        .select("id,case_id,kind,action_type,done_in_vrchat,from_value,to_value,created_by,created_at")
        .gt("id", state!.entries_cursor).in("kind", ["created", "status", "action", "appeal", "appeal_decision"])
        .order("id", { ascending: true }).limit(200);
      const caseIds = [...new Set((ents || []).map((e) => e.case_id))];
      const { data: cases } = caseIds.length
        ? await admin.from("uwx_cases").select("id,group_id,case_number,title,severity,subject_name").in("id", caseIds)
        : { data: [] };
      const caseById = new Map((cases || []).map((c) => [c.id, c]));
      const myEnts = (ents || []).filter((e) => caseById.get(e.case_id)?.group_id === g.id);

      const newEvCursor = evs?.length ? evs[evs.length - 1].uploaded_at : evCursor;
      // entries cursor is global id order; only advance past rows we've looked at
      const newEntCursor = ents?.length ? ents[ents.length - 1].id : state!.entries_cursor;
      if (newEvCursor === evCursor && newEntCursor === state!.entries_cursor) { results.push({ group: g.name, posted: 0 }); continue; }

      // Claim (compare-and-swap) before posting, so two callers can't double-post.
      const { data: claimed } = await admin.from("uwx_discord_state")
        .update({ events_cursor: newEvCursor, entries_cursor: newEntCursor, last_error: null })
        .eq("group_id", g.id).eq("entries_cursor", state!.entries_cursor).eq("events_cursor", evCursor)
        .select("group_id");
      if (!claimed?.length) { results.push({ group: g.name, posted: 0, note: "another sync is posting" }); continue; }

      const names = new Map<string, string>();
      const staffIds = [...new Set(myEnts.map((e) => e.created_by).filter(Boolean))];
      if (staffIds.length) {
        const { data: profs } = await admin.from("profiles").select("id,display_name,username").in("id", staffIds);
        for (const p of profs || []) names.set(p.id, p.display_name || p.username || "Staff");
      }

      const recent = (evs || []).filter((e) => Date.now() - Date.parse(e.occurred_at) < 24 * 3600e3);
      const older = (evs || []).length - recent.length;
      const evLines = recent.map((e) => `${EVENT_TYPES[e.event_type].icon} ${ts(e.occurred_at)} — ${clip(e.description || `${e.actor_name || "Staff"}: ${EVENT_TYPES[e.event_type].label}`, 180)}`);
      if (older > 0) evLines.push(`🗂️ +${older} older entr${older === 1 ? "y" : "ies"} added to the archive (not posted one by one)`);

      const caseLines = myEnts.map((e) => {
        const c = caseById.get(e.case_id)!;
        const head = `${SEV[c.severity] || ""} **Case #${c.case_number}** ${clip(c.title, 80)}${c.subject_name ? ` — ${clip(c.subject_name, 40)}` : ""}`;
        const who = names.get(e.created_by) || "Staff";
        switch (e.kind) {
          case "created": return `📂 ${head}\n  opened by ${who}`;
          case "status": return `🏷️ ${head}\n  ${STATUS[e.from_value] || e.from_value} → **${STATUS[e.to_value] || e.to_value}** by ${who}`;
          case "action": return `🔨 ${head}\n  ${ACTIONS[e.action_type] || "Action"} recorded by ${who}${e.done_in_vrchat ? " (done in VRChat)" : ""}`;
          case "appeal": return `📨 ${head}\n  appeal received (logged by ${who})`;
          default: return `⚖️ ${head}\n  appeal decision: **${clip(e.to_value, 30)}** by ${who}`;
        }
      });

      const embeds = [
        ...(evLines.length ? pack(`${g.name} — VRChat moderation`, 0xd55181, evLines, "From the group audit log, synced by staff UWX") : []),
        ...(caseLines.length ? pack(`${g.name} — cases`, 0x3987e5, caseLines, "Details are in UWX → Moderation or underweb.cloud → Staff → Cases") : []),
      ];
      if (embeds.length) {
        await post(webhook, embeds);
        await admin.from("uwx_discord_state").update({ last_post_at: new Date().toISOString() }).eq("group_id", g.id);
      }
      results.push({ group: g.name, posted: evLines.length + caseLines.length });
    } catch (e) {
      await admin.from("uwx_discord_state").update({ last_error: clip((e as Error).message, 300) }).eq("group_id", g.id);
      results.push({ group: g.name, error: (e as Error).message });
    }
  }
  return json({ ok: true, results });
});

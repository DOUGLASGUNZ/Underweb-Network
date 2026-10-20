import { createClient } from "npm:@supabase/supabase-js@2";

// Public event listing for underweb.cloud visitors (signed out).
//   GET /public-events?when=upcoming|past
// Only staff-published events, and only what a poster would show: title, time,
// world name, cover art and description. Instance links are never returned
// (anything URL-shaped in "location" is dropped). Cached 60s.
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60", ...cors } });

const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, n);
const looksLikeLink = (v: string) => /https?:\/\/|vrchat\.com|wrld_|~|launch\?/i.test(v);

type Row = { id: string; title: string | null; starts_at: string; ends_at: string | null; location: string | null; cover_url: string | null; description: string | null; group_scope: string | null };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "not found" }, 404);
  const when = new URL(req.url).searchParams.get("when") === "past" ? "past" : "upcoming";
  const cutoff = new Date(Date.now() - 4 * 3600 * 1000).toISOString();

  let q = supabase
    .from("network_events")
    .select("id,title,starts_at,ends_at,location,cover_url,description,group_scope")
    .eq("status", "published")
    .is("cancelled_at", null);
  q = when === "upcoming" ? q.gte("starts_at", cutoff).order("starts_at").limit(30) : q.lt("starts_at", cutoff).order("starts_at", { ascending: false }).limit(20);
  const { data, error } = await q;
  if (error) return json({ error: "events unavailable" }, 500);

  const events = ((data ?? []) as Row[]).map((e) => {
    const loc = clip(e.location, 80);
    const cover = String(e.cover_url || "");
    return {
      id: e.id,
      title: clip(e.title, 120) || "UnderWeb event",
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      location: loc && !looksLikeLink(loc) ? loc : "UnderWeb",
      cover_url: cover.startsWith("https://") ? cover : null,
      description: clip(e.description, 1200),
      group_scope: e.group_scope,
    };
  });
  return json({ v: 1, when, events });
});

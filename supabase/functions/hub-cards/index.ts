import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// UnderWeb hub: creator cards for the hub world.
//   GET /hub-cards -> JSON the GitHub Pages job renders into images for the hub's slots:
//     market: approved Creator Market cards   dj: approved Resident DJ cards
//     wall:   approved showcase photos/art the owner opted into the hub
//   every item carries `likes`: all-time ♥ from the hub's Creator Room (hub_card_likes)
// Only staff-approved, switched-on, public information is returned. Cached 60s.
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60", ...cors },
  });

const STORAGE = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/`;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const httpsOrNull = (v: unknown) => {
  try {
    const u = new URL(String(v ?? ""));
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
};
// "missing table/column" = migration not applied yet: return an empty list instead of failing.
const notReady = (e: { code?: string } | null) => !!e && ["42P01", "42703", "PGRST205", "PGRST204"].includes(String(e.code));

type CardRow = {
  user_id: string; kind: string; image_url: string | null; headline: string | null; link_url: string | null;
  link_label: string | null; extra_link_url: string | null; reviewed_at: string | null;
};
type WallRow = { id: string; user_id: string; title: string | null; media_url: string | null; media_type: string | null; reviewed_at: string | null };
type NameRow = { user_id?: string; id?: string; display_name?: string | null; username?: string | null };

async function names(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const [{ data: creators }, { data: profiles }] = await Promise.all([
    supabase.from("creator_profiles").select("user_id,display_name").in("user_id", ids),
    supabase.from("profiles").select("id,display_name,username").in("id", ids),
  ]);
  for (const p of (profiles ?? []) as NameRow[]) out.set(String(p.id), clip(p.display_name || p.username, 40));
  for (const c of (creators ?? []) as NameRow[]) if (c.display_name) out.set(String(c.user_id), clip(c.display_name, 40));
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "not found" }, 404);

  const [cardsRes, wallRes] = await Promise.all([
    supabase
      .from("hub_creator_cards")
      .select("user_id,kind,image_url,headline,link_url,link_label,extra_link_url,reviewed_at")
      .eq("status", "approved")
      .eq("enabled", true)
      .order("reviewed_at", { ascending: true }),
    supabase
      .from("creator_showcase")
      .select("id,user_id,title,media_url,media_type,reviewed_at")
      .eq("moderation_status", "approved")
      .eq("show_in_hub", true)
      .eq("media_type", "image")
      .order("reviewed_at", { ascending: false })
      .limit(20),
  ]);
  if (cardsRes.error && !notReady(cardsRes.error)) return json({ error: "cards unavailable" }, 500);
  if (wallRes.error && !notReady(wallRes.error)) return json({ error: "wall unavailable" }, 500);

  const cards: CardRow[] = cardsRes.error ? [] : (cardsRes.data ?? []) as CardRow[];
  const wall: WallRow[] = ((wallRes.error ? [] : wallRes.data ?? []) as WallRow[]).filter((w) => String(w.media_url || "").startsWith(STORAGE));
  const who = await names([...new Set([...cards.map((c) => c.user_id), ...wall.map((w) => w.user_id)])]);
  const likes = new Map<string, number>();
  {
    const { data, error } = await supabase.rpc("hub_like_counts");
    if (!error) for (const r of (data ?? []) as { card_id: string; likes: number }[]) likes.set(String(r.card_id), Number(r.likes) || 0);
  }

  const card = (c: CardRow) => ({
    id: c.user_id,
    name: who.get(c.user_id) || "UnderWeb creator",
    headline: clip(c.headline, 60),
    image_url: String(c.image_url || "").startsWith(STORAGE) ? c.image_url : null,
    link_url: httpsOrNull(c.link_url),
    link_label: clip(c.link_label, 40),
    extra_link_url: httpsOrNull(c.extra_link_url),
    profile_url: `https://underweb.cloud/#profile=${c.user_id}`,
    approved_at: c.reviewed_at,
    likes: likes.get(c.user_id) ?? 0,
  });

  return json({
    v: 1,
    generated_at: new Date().toISOString(),
    market: cards.filter((c) => c.kind === "market").map(card).filter((c) => c.image_url),
    dj: cards.filter((c) => c.kind === "dj").map(card).filter((c) => c.image_url),
    wall: wall.map((w) => ({ id: w.id, title: clip(w.title, 60) || "Untitled", by: who.get(w.user_id) || "UnderWeb member", image_url: w.media_url, likes: likes.get(String(w.id)) ?? 0 })),
  });
});

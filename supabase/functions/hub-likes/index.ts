import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// UnderWeb hub: likes from the Creator Room.
//   POST /hub-likes/report  {"name": "...", "card": "<card id>", "code": "123456-654321"}
// sent by UWX when it sees the world's "[VRCX] UWLike <name>\t<card>\t<code>" log line. The code is a keyed hash
// of name + card that only the world makes; the card must be in the hub right now. One like per name per card.
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SALT = "c7e2a94f1b385d60e9a4f2b7"; // must match UWCardLikes.likeSalt in the world

export function likeCode(name: string, card: string): string {
  const t = SALT + "|" + name + "|" + card;
  let h1 = 7, h2 = 11;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i); // UTF-16 code units, same as C# chars
    h1 = (h1 * 31 + c) % 999983;
    h2 = (h2 * 37 + c) % 999979;
  }
  return String(h1).padStart(6, "0") + "-" + String(h2).padStart(6, "0");
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...cors } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST" || !new URL(req.url).pathname.endsWith("/report")) return text("not found", 404);
  const raw = await req.text();
  if (raw.length > 512) return text("too large", 413);
  let body: any;
  try { body = JSON.parse(raw); } catch { return text("bad json", 400); }
  const name = typeof body?.name === "string" ? body.name : "";
  const card = typeof body?.card === "string" ? body.card.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (name.length < 1 || name.length > 64 || /[\t\r\n]/.test(name)) return text("bad name", 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(card)) return text("bad card", 400);
  if (!/^\d{6}-\d{6}$/.test(code) || code !== likeCode(name, card)) return text("bad code", 403);
  const { data, error } = await supabase.rpc("hub_like_report", { p_card: card, p_voter: name });
  if (error) return text("error", 500);
  return text(data === true ? "ok" : "not in the hub", data === true ? 200 : 404);
});

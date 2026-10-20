import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// UnderWeb Cinema - PROJECT BLACKSCREEN (phase 1). Public, read-only for the world.
//   GET  /blackscreen/feed       -> plain-text catalog (see blackscreen_feed()); never contains file URLs
//   GET  /blackscreen/s/NNN      -> 302 to the media for slot NNN, ONLY while it's authorized + verified (status P)
//   GET  /blackscreen/check      -> re-checks up to 8 authorized entries whose last check is over 24 h old
//   GET  /blackscreen/check/ID   -> re-checks one entry (at most once every 5 minutes)
// A check fetches the first 4 KB and only passes real video: an MP4/MOV (ftyp), WebM/MKV (EBML) or HLS (#EXTM3U)
// from a 200/206 response. Adding media / authorizing it is staff-only (database), never through this function.
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const text = (body: string, status = 200, cache = 60) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": cache ? `public, max-age=${cache}` : "no-store", "Access-Control-Allow-Origin": "*" },
  });

type Row = { id: number; slot: number | null; file_url: string | null; rights_basis: string | null; verified_ok: boolean; verified_at: string | null };
const FRESH_MS = 7 * 24 * 3600 * 1000;
const playable = (r: Row) => !!r.file_url && !!r.rights_basis && r.verified_ok && !!r.verified_at && Date.now() - Date.parse(r.verified_at) < FRESH_MS;

async function probe(url: string): Promise<{ ok: boolean; note: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-4095", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) UnderWebCinema-Check/1" }, redirect: "follow", signal: ctl.signal });
    if (res.status !== 200 && res.status !== 206) { await res.body?.cancel(); return { ok: false, note: `HTTP ${res.status}` }; }
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const reader = res.body?.getReader();
    let buf = new Uint8Array(0);
    while (reader && buf.length < 4096) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const n = new Uint8Array(buf.length + value.length); n.set(buf); n.set(value, buf.length); buf = n;
    }
    try { await reader?.cancel(); } catch { /* fine */ }
    const head = new TextDecoder("latin1").decode(buf.slice(0, 64));
    if (head.includes("ftyp")) return { ok: true, note: `mp4 (${type || "no type"})` };
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ok: true, note: `webm/mkv (${type || "no type"})` };
    if (head.startsWith("#EXTM3U")) return { ok: true, note: "hls playlist" };
    return { ok: false, note: `not a video (${type || "no type"}, starts "${head.slice(0, 12).replace(/[^\x20-\x7e]/g, ".")}")` };
  } catch (e) {
    return { ok: false, note: ctl.signal.aborted ? "timed out" : `fetch failed: ${String((e as Error)?.message ?? e).slice(0, 80)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function check(rows: Row[]) {
  const out: string[] = [];
  for (const r of rows) {
    if (!r.file_url || !r.rights_basis) continue;
    const p = await probe(r.file_url);
    await supabase.from("cinema_titles").update({ verified_ok: p.ok, verified_at: new Date().toISOString(), verify_note: p.note.slice(0, 200) }).eq("id", r.id);
    out.push(`${r.id}\t${p.ok ? "OK" : "FAIL"}\t${p.note}`);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return text("Method not allowed", 405, 0);
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const cols = "id,slot,file_url,rights_basis,verified_ok,verified_at";

  if (path.endsWith("/feed")) {
    const { data, error } = await supabase.rpc("blackscreen_feed");
    if (error) return text("BLACKSCREEN ERR", 500, 0);
    return text(String(data ?? "BLACKSCREEN 1"));
  }

  let m = path.match(/\/s\/(\d{1,3})(?:\.\w+)?$/);
  if (m) {
    const { data, error } = await supabase.from("cinema_titles").select(cols).eq("slot", parseInt(m[1], 10)).eq("active", true).maybeSingle();
    if (error || !data) return text("Nothing in this slot", 404, 0);
    if (!playable(data as Row)) return text("This title isn't available right now", 404, 0);
    return new Response(null, { status: 302, headers: { Location: (data as Row).file_url!, "Cache-Control": "no-store" } });
  }

  m = path.match(/\/check\/(\d+)$/);
  if (m) {
    const { data } = await supabase.from("cinema_titles").select(cols).eq("id", parseInt(m[1], 10)).maybeSingle();
    if (!data) return text("No such title", 404, 0);
    const r = data as Row;
    if (r.verified_at && Date.now() - Date.parse(r.verified_at) < 5 * 60 * 1000) return text(`${r.id}\t${r.verified_ok ? "OK" : "FAIL"}\t(checked recently)`, 200, 0);
    return text((await check([r])).join("\n") || "nothing to check", 200, 0);
  }
  if (path.endsWith("/check")) {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data } = await supabase.from("cinema_titles").select(cols).eq("active", true).not("file_url", "is", null)
      .or(`verified_at.is.null,verified_at.lt.${cutoff}`).order("verified_at", { ascending: true, nullsFirst: true }).limit(8);
    return text((await check((data ?? []) as Row[])).join("\n") || "all fresh", 200, 0);
  }
  return text("UnderWeb Cinema - Blackscreen", 404, 0);
});

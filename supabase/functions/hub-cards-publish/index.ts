// UnderWeb hub: push approved creator cards / photos into the hub world now.
// Starts the "Hub feeds to GitHub Pages" workflow (which renders cards into images the world loads),
// instead of waiting for GitHub's scheduled run (which GitHub often delays by hours).
//   POST {}            -> { status: "started" | "already_queued" }   staff only (rank >= 55)
//   POST {status:true} -> { last_run: {...} }                        staff only
// Secrets: HUB_DISPATCH_TOKEN (fine-grained token, Underweb-Network repo, Actions: read & write).
//          Falls back to GITHUB_TOKEN if that token can start workflows in this repo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const REPO = "DOUGLASGUNZ/Underweb-Network";
const WORKFLOW = "hub-feeds.yml";
const GH = "https://api.github.com";
const STAFF_RANK = 55;

async function gh(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("HUB_DISPATCH_TOKEN") || Deno.env.get("GITHUB_TOKEN");
  if (!token) throw new Error("not_configured");
  return await fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "underweb-hub-cards-publish",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "sign_in_required" }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "sign_in_required" }, 401);
  const { data: rank, error: rankErr } = await userClient.rpc("uw_max_role_rank");
  if (rankErr || Number(rank || 0) < STAFF_RANK) return json({ error: "not_allowed" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    const runsRes = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=5`);
    if (!runsRes.ok) return json({ error: "github_failed", detail: `runs_${runsRes.status}` }, 502);
    const runs = ((await runsRes.json()).workflow_runs || []) as Array<Record<string, string>>;
    const pick = (r?: Record<string, string>) =>
      r ? { status: r.status, conclusion: r.conclusion, started_at: r.run_started_at || r.created_at, updated_at: r.updated_at } : null;

    if (body?.status) return json({ last_run: pick(runs[0]) });

    // A run that hasn't started yet will pick up this approval too — don't stack more.
    if (runs.some((r) => r.status === "queued" || r.status === "pending" || r.status === "waiting")) {
      return json({ status: "already_queued" });
    }
    const res = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status === 204) return json({ status: "started" });
    return json({ error: "github_failed", detail: `dispatch_${res.status}` }, 502);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return json({ error: msg === "not_configured" ? "not_configured" : "publish_failed" }, msg === "not_configured" ? 503 : 500);
  }
});

// Supabase Edge Function: inner-web-download
// Verifies the caller, resolves Inner Web clearance server-side, and returns
// a short-lived signed URL for an eligible private Vault artifact.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) throw new Error("sign_in_required");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("sign_in_required");
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const itemId = String(body?.item_id || "").trim();
    if (!itemId) throw new Error("item_required");

    const { data: item, error: itemError } = await admin
      .from("vault_items")
      .select("id,required_tier,downloadable,download_path,active,metadata")
      .eq("id", itemId).eq("active", true).maybeSingle();
    if (itemError || !item) throw new Error("artifact_not_found");
    if (!item.downloadable) throw new Error("artifact_not_downloadable");
    if (!item.download_path) throw new Error("artifact_release_pending");

    const { data: membership } = await admin
      .from("inner_web_memberships")
      .select("tier,status")
      .eq("user_id", userId).maybeSingle();

    const tier = membership?.tier || "none";
    const status = membership?.status || "inactive";
    const rank = tier === "owner" ? 99 : status === "active" && tier === "signal" ? 2 : status === "active" && tier === "connected" ? 1 : 0;
    const needed = item.required_tier === "signal" ? 2 : item.required_tier === "connected" ? 1 : 0;
    if (rank < needed) throw new Error("clearance_required");

    if (item.metadata?.signal && tier !== "owner") {
      const { data: link } = await admin.from("signal_drop_items").select("signal_id").eq("item_id", itemId).limit(1).maybeSingle();
      if (link?.signal_id) {
        const { data: drop } = await admin.from("signal_drops").select("active,starts_at,ends_at").eq("id", link.signal_id).maybeSingle();
        const now = Date.now();
        if (!drop?.active || (drop.starts_at && now < Date.parse(drop.starts_at)) || (drop.ends_at && now >= Date.parse(drop.ends_at))) throw new Error("signal_closed");
      }
    }

    const slash = item.download_path.indexOf("/");
    if (slash < 1) throw new Error("invalid_vault_path");
    const bucket = item.download_path.slice(0, slash);
    const path = item.download_path.slice(slash + 1);

    const { data: signed, error: signedError } = await admin.storage.from(bucket).createSignedUrl(path, 60);
    if (signedError || !signed?.signedUrl) throw new Error("download_unavailable");

    return new Response(JSON.stringify({ ok: true, item_id: itemId, url: signed.signedUrl, expires_in: 60 }), {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "download_failed";
    const status = message === "sign_in_required" ? 401 : message === "clearance_required" ? 403 : 400;
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});

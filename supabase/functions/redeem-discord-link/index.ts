import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";
const expectedOrigin =
  Deno.env.get("UNDERWEB_SITE_ORIGIN") ?? "https://underweb.cloud";

const corsHeaders = {
  "access-control-allow-origin": expectedOrigin,
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function errorResponse(message: string, status: number) {
  return json(status, { linked: false, error: message });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return errorResponse("Use POST for Discord link redemption.", 405);
  }

  if (request.headers.get("origin") !== expectedOrigin) {
    return errorResponse(
      "This request did not come from the UnderWeb website.",
      403
    );
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase Edge Function environment is incomplete.");
    return errorResponse(
      "Discord linking is temporarily unavailable. Please try again later.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return errorResponse(
      "Please sign in to UnderWeb before linking Discord.",
      401
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("The request body is invalid.", 400);
  }

  const token =
    typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof body.token === "string"
      ? body.token.trim()
      : "";

  if (token.length < 32 || token.length > 256) {
    return errorResponse("A valid Discord verification token is required.", 400);
  }

  // This client carries the caller's Supabase bearer token. The database
  // function derives auth.uid() from that session and performs the transaction.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } }
  });

  const {
    data: { user },
    error: authError
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return errorResponse(
      "Please sign in to UnderWeb before linking Discord.",
      401
    );
  }

  const { data, error } = await userClient.rpc(
    "redeem_discord_link_token",
    { p_token_hash: await sha256Hex(token) }
  );

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("expired_or_used_token") || message.includes("invalid_token")) {
      return errorResponse(
        "This Discord verification link has expired or was already used.",
        400
      );
    }
    if (message.includes("discord_already_linked")) {
      return errorResponse(
        "This Discord account is already linked to another UnderWeb profile.",
        409
      );
    }
    if (message.includes("profile_already_linked")) {
      return errorResponse(
        "This UnderWeb profile is already linked to another Discord account.",
        409
      );
    }
    if (message.includes("profile_not_found")) {
      return errorResponse(
        "Your UnderWeb profile could not be resolved for linking.",
        409
      );
    }
    console.error("Discord link redemption failed:", error.code ?? "unknown");
    return errorResponse(
      "The Discord connection could not be completed. Please try again later.",
      500
    );
  }

  const linked = Array.isArray(data) ? data[0]?.linked : false;
  if (!linked) {
    return errorResponse(
      "The Discord connection could not be completed. Please try again later.",
      500
    );
  }

  console.info("Discord account linked", { userId: user.id });
  return json(200, {
    linked: true,
    message: "Your Discord account is now linked to UnderWeb."
  });
});
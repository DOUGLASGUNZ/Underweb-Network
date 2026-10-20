import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function clip(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Share an approved showcase photo to the UnderWeb Discord channel.
 * Only runs when the poster opted in. Never throws: Discord being down must
 * not undo or block an approval.
 */
async function shareToDiscord(
  // deno-lint-ignore no-explicit-any
  admin: any,
  media: {
    id: string;
    user_id: string;
    title: string | null;
    caption: string | null;
    media_type: string | null;
  },
  publicUrl: string,
): Promise<"posted" | "skipped" | "failed"> {
  const webhook = Deno.env.get("SHOWCASE_DISCORD_WEBHOOK_URL") || "";
  if (!DISCORD_WEBHOOK_RE.test(webhook)) return "skipped";
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name,vrchat_username,username")
      .eq("id", media.user_id)
      .maybeSingle();
    const name = clip(
      profile?.vrchat_username || profile?.display_name ||
        profile?.username || "An UnderWeb member",
      80,
    );
    const isImage = (media.media_type || "image") === "image";
    const embed: Record<string, unknown> = {
      title: clip(media.title || "Untitled", 200),
      url: `https://underweb.cloud/#profile=${encodeURIComponent(media.user_id)}`,
      color: 0x3df514,
      author: { name: `📸 ${name}` },
      footer: { text: "UnderWeb showcase · approved by staff" },
      timestamp: new Date().toISOString(),
    };
    if (media.caption) embed.description = clip(media.caption, 1000);
    if (isImage) embed.image = { url: publicUrl };
    else embed.description = `${embed.description ? `${embed.description}\n\n` : ""}▶ ${publicUrl}`;

    const body = JSON.stringify({
      username: "UnderWeb Gallery",
      embeds: [embed],
      allowed_mentions: { parse: [] },
    });
    let response = await fetch(`${webhook}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (response.status === 429) {
      const retry = Number((await response.json().catch(() => ({})))?.retry_after) || 1;
      await new Promise((r) => setTimeout(r, Math.min(5, retry) * 1000));
      response = await fetch(`${webhook}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    }
    if (!response.ok) {
      console.error("Discord share failed with status", response.status);
      return "failed";
    }
    await admin
      .from("creator_showcase")
      .update({ discord_posted_at: new Date().toISOString() })
      .eq("id", media.id);
    return "posted";
  } catch (error) {
    console.error("Discord share error:", (error as Error)?.message || error);
    return "failed";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error("Missing Supabase environment variables");
      return json({ error: "Server configuration error" }, 500);
    }

    // Get logged-in user's JWT
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.slice(7);

    // Server/admin client
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Verify the JWT and get the real user
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      console.error("Authentication failure:", userError);
      return json({ error: "Invalid session" }, 401);
    }

    // User-scoped client.
    // This makes auth.uid() inside our permission RPC equal
    // the person actually pressing Approve.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Verify reviewer permission
    const { data: canReview, error: permissionError } =
      await userClient.rpc("uw_can_review_media");

    if (permissionError) {
      console.error("Permission check failed:", permissionError);

      return json(
        { error: "Unable to verify reviewer authority" },
        403,
      );
    }

    if (canReview !== true) {
      return json(
        { error: "Media reviewer authority required" },
        403,
      );
    }

    // Read request body
    const body = await req.json().catch(() => null);

    const mediaId = body?.media_id;

    if (
      typeof mediaId !== "string" ||
      mediaId.trim().length === 0
    ) {
      return json({ error: "media_id is required" }, 400);
    }

    // Find pending showcase submission
    // (share_to_discord may not exist before the 2026-10-19 migration; fall back without it)
    let { data: media, error: mediaError } = await admin
      .from("creator_showcase")
      .select(
        "id,user_id,media_url,storage_path,media_type,moderation_status,title,caption,share_to_discord",
      )
      .eq("id", mediaId)
      .single();

    if (mediaError && /share_to_discord/.test(mediaError.message || "")) {
      ({ data: media, error: mediaError } = await admin
        .from("creator_showcase")
        .select(
          "id,user_id,media_url,storage_path,media_type,moderation_status,title,caption",
        )
        .eq("id", mediaId)
        .single());
    }

    if (mediaError || !media) {
      console.error("Media lookup failed:", mediaError);

      return json(
        { error: "Showcase submission not found" },
        404,
      );
    }

    if (media.moderation_status !== "pending") {
      return json(
        {
          error:
            `Submission is already ${media.moderation_status}`,
        },
        409,
      );
    }

    if (!media.storage_path) {
      return json(
        { error: "Pending storage path is missing" },
        409,
      );
    }

    // Make sure the object actually belongs to this creator's folder
    const expectedPrefix = `${media.user_id}/`;

    if (!media.storage_path.startsWith(expectedPrefix)) {
      console.error(
        "Storage ownership mismatch:",
        media.id,
        media.storage_path,
      );

      return json(
        { error: "Invalid pending storage path" },
        409,
      );
    }

    // Download private pending file
    const { data: pendingFile, error: downloadError } =
      await admin.storage
        .from("creator-showcase-pending")
        .download(media.storage_path);

    if (downloadError || !pendingFile) {
      console.error("Pending download failed:", downloadError);

      return json(
        { error: "Unable to read pending media" },
        500,
      );
    }

    // Promote it into public showcase storage.
    // Only the service role can do this now.
    const publicPath = media.storage_path;

    const { error: uploadError } = await admin.storage
      .from("creator-showcase")
      .upload(publicPath, pendingFile, {
        contentType:
          pendingFile.type ||
          media.media_type ||
          "application/octet-stream",

        upsert: false,
      });

    if (uploadError) {
      console.error("Public upload failed:", uploadError);

      return json(
        { error: "Unable to publish media" },
        500,
      );
    }

    // Generate public URL
    const { data: publicUrlData } = admin.storage
      .from("creator-showcase")
      .getPublicUrl(publicPath);

    const publicUrl = publicUrlData.publicUrl;

    if (!publicUrl) {
      // Clean up public object if something went wrong
      await admin.storage
        .from("creator-showcase")
        .remove([publicPath]);

      return json(
        { error: "Unable to create public media URL" },
        500,
      );
    }

    // Mark database row approved
    const { data: updatedRows, error: updateError } = await admin
      .from("creator_showcase")
      .update({
        media_url: publicUrl,
        storage_path: publicPath,
        moderation_status: "approved",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        denial_reason: null,
      })
      .eq("id", media.id)
      .eq("moderation_status", "pending")
      .select("id");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      console.error("Database approval failed:", updateError);

      // Don't leave an orphan public file
      await admin.storage
        .from("creator-showcase")
        .remove([publicPath]);

      return json(
        { error: "Unable to approve media" },
        500,
      );
    }

    // Delete private copy
    const { error: cleanupError } = await admin.storage
      .from("creator-showcase-pending")
      .remove([media.storage_path]);

    if (cleanupError) {
      console.error(
        "Approval succeeded but pending cleanup failed:",
        cleanupError,
      );
    }

    // Poster asked for it to go to the UnderWeb Discord too.
    // deno-lint-ignore no-explicit-any
    const discord = (media as any).share_to_discord === true
      ? await shareToDiscord(admin, media, publicUrl)
      : "skipped";

    return json({
      ok: true,
      media_id: media.id,
      media_url: publicUrl,
      cleanup_pending: !!cleanupError,
      discord,
    });
  } catch (error) {
    console.error(
      "Unexpected approve-showcase-media error:",
      error,
    );

    return json(
      { error: "Unexpected server error" },
      500,
    );
  }
});

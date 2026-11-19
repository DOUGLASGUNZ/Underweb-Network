import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public, read-only Silk transfer feed for the UnderWeb casino (VRCStringDownloader can't send auth headers).
// Lists Silk earned or spent on underweb.cloud that the casino should apply:
//   UWSILK 1
//   # <generated at> <count>
//   seq<TAB>vrc_user_id<TAB>display name<TAB>amount<TAB>note
// The world applies every row whose seq is above the last one it saved for that player.
// The hub-feeds workflow copies this to GitHub Pages, which VRChat trusts.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const { data, error } = await supabase.rpc("uw_silk_feed_text");
  if (error) return new Response("UWSILK ERR", { status: 500 });
  return new Response(String(data ?? "UWSILK 1\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

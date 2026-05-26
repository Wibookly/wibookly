// admin-secret-status — reports which project secrets are currently set in the
// Edge Function runtime. Values are NEVER returned, only presence + a masked
// preview (last 4 chars) so admins can confirm the key the system actually sees.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

const ALLOWED = [
  "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID", "TOKEN_ENCRYPTION_KEY",
  "TEAMS_BOT_APP_ID", "TEAMS_BOT_APP_PASSWORD", "TEAMS_BOT_TENANT_ID",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LOVABLE_API_KEY", "LOVABLE_SEND_URL", "DEEPGRAM_API_KEY",
  "SUPABASE_ACCESS_TOKEN",
];

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Invalid token" }, 401);

    // Platform-level operation: restricted to super admin only.
    // Org admins must NOT be able to view global project secrets.
    const isSuper = (userData.user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    const secrets: Record<string, { present: boolean; length: number; preview: string | null }> = {};
    for (const name of ALLOWED) {
      const v = Deno.env.get(name) ?? "";
      secrets[name] = {
        present: v.length > 0,
        length: v.length,
        preview: v.length >= 4 ? `••••${v.slice(-4)}` : (v.length > 0 ? "••••" : null),
      };
    }
    return json({ ok: true, secrets });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

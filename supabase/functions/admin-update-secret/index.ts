// admin-update-secret — updates a project secret via the Supabase Management API.
// Requires SUPABASE_ACCESS_TOKEN (a personal access token from the project owner).
// Allowlists which secret names can be set from the client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_PROJECT_REF = Deno.env.get("SUPABASE_PROJECT_REF") ?? "jbzctydskdpzrejvpwpn";
const MGMT_TOKEN = Deno.env.get("SUPABASE_ACCESS_TOKEN");
const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

const ALLOWED = new Set([
  "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID", "TOKEN_ENCRYPTION_KEY",
  "TEAMS_BOT_APP_ID", "TEAMS_BOT_APP_PASSWORD", "TEAMS_BOT_TENANT_ID",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LOVABLE_API_KEY", "LOVABLE_SEND_URL", "DEEPGRAM_API_KEY",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Invalid token" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const isSuper = (userData.user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    if (!isSuper) {
      const { data: r } = await admin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
      if (!r) return json({ error: "Forbidden" }, 403);
    }

    const { secret_name, secret_value } = await req.json();
    if (typeof secret_name !== "string" || typeof secret_value !== "string" || !secret_value) {
      return json({ ok: false, message: "secret_name and secret_value required" }, 400);
    }
    if (!ALLOWED.has(secret_name)) return json({ ok: false, message: `${secret_name} is not in the allowlist` }, 400);

    if (!MGMT_TOKEN) {
      return json({ ok: false, message: "SUPABASE_ACCESS_TOKEN not configured. Add it in Edge Function Secrets to enable in-app secret rotation." });
    }

    const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/secrets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MGMT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ name: secret_name, value: secret_value }]),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return json({ ok: false, message: `Management API HTTP ${r.status}: ${t.slice(0, 200)}` });
    }

    // Audit log (best-effort)
    try {
      await admin.from("admin_audit_log").insert({
        actor_user_id: userData.user.id,
        action: "update_secret",
        details: { secret_name },
      });
    } catch { /* table may not exist */ }

    return json({ ok: true, message: `Secret ${secret_name} updated. New value takes effect on next function cold start.` });
  } catch (e) {
    return json({ ok: false, message: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// admin-integration-action — catch-all dispatcher for admin-triggered
// actions on a single integration. Allowlisted actions only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

const ALLOWED_ACTIONS = new Set([
  "run_test", "force_refresh_token", "disconnect_mailbox",
  "renew_graph_subscriptions", "drain_email_queue", "replay_dlq",
  "reset_health_counters", "set_kill_switch",
]);

async function invoke(fn: string, body: unknown, authHeader: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { Authorization: authHeader, apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, data: j, status: r.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, message: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, message: "Invalid token" }, 401);

    // Platform-level operation: restricted to super admin only.
    // Actions like kill-switch / queue drain are system-wide, not per-org.
    const isSuper = (userData.user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    if (!isSuper) return json({ ok: false, message: "Forbidden" }, 403);

    const { integration_key, action, params } = await req.json();
    if (!ALLOWED_ACTIONS.has(action)) return json({ ok: false, message: `Unknown action ${action}` }, 400);

    let result: any = { ok: true, message: "" };
    switch (action) {
      case "run_test": {
        const r = await invoke("admin-integration-probe", { integration_key }, authHeader);
        result = { ok: r.ok, message: r.data?.message ?? "", data: r.data };
        break;
      }
      case "renew_graph_subscriptions": {
        const r = await invoke("cron-renew-graph-subscriptions", { triggered_by: "admin_action" }, authHeader);
        result = { ok: r.ok, message: r.ok ? "Renewal triggered" : `HTTP ${r.status}` };
        break;
      }
      case "drain_email_queue": {
        const r = await invoke("process-email-queue", { triggered_by: "admin_action" }, authHeader);
        result = { ok: r.ok, message: r.ok ? "Queue drain triggered" : `HTTP ${r.status}` };
        break;
      }
      case "disconnect_mailbox": {
        const r = await invoke("disconnect-mailbox", params ?? {}, authHeader);
        result = { ok: r.ok, message: r.ok ? "Disconnected" : `HTTP ${r.status}` };
        break;
      }
      case "force_refresh_token":
        result = { ok: false, message: "Force-refresh action wired in a follow-up." };
        break;
      case "replay_dlq":
        result = { ok: false, message: "Action not yet implemented" };
        break;
      case "reset_health_counters": {
        const key = params?.integration_key;
        const baseQ = admin.from("integration_health").update({
          status: "idle", message: "Reset by admin", latency_ms: null, last_checked_at: new Date().toISOString(),
        });
        const q = key ? baseQ.eq("integration_key", key) : baseQ.neq("integration_key", "");
        const { error } = await q;
        result = { ok: !error, message: error?.message ?? `Reset ${key ?? "all"} health counters` };
        break;
      }
      case "set_kill_switch": {
        const enabled = !!params?.enabled;
        const { error } = await admin.from("system_flags").upsert({
          flag_key: "ai_kill_switch", flag_value: { enabled }, updated_by: userData.user.id,
        }, { onConflict: "flag_key" });
        result = { ok: !error, message: error?.message ?? `AI kill switch ${enabled ? "ENABLED" : "DISABLED"}` };
        break;
      }
    }

    try {
      await admin.from("admin_audit_log").insert({
        actor_user_id: userData.user.id,
        action: `integration_action:${action}`,
        details: { integration_key, params, result_ok: result.ok },
      });
    } catch { /* table may not exist */ }

    return json(result);
  } catch (e) {
    return json({ ok: false, message: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// admin-send-test-alert — sends a test email + (optional) SMS to a recipient
// so admins can verify alert delivery without waiting for a real failure.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

async function sendSms(to: string, body: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !tok || !from) return { ok: false, message: "Twilio not configured" };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${tok}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const text = await r.text();
  return { ok: r.ok, message: r.ok ? "sent" : `HTTP ${r.status}: ${text.slice(0, 200)}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const isSuper = (userData.user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    if (!isSuper) {
      const { data: r } = await admin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
      if (!r) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const { email, phone, channel } = body as { email?: string; phone?: string; channel?: "email" | "sms" | "both" };

    const results: Record<string, any> = {};
    if ((channel === "email" || channel === "both") && email) {
      try {
        await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "integration-alert",
            recipientEmail: email,
            idempotencyKey: `test-alert-${email}-${Date.now()}`,
            templateData: {
              integrationKey: "test-integration",
              integrationName: "Test alert",
              status: "failed",
              message: "This is a test alert from the InboxIQ admin dashboard.",
              detectedAt: new Date().toISOString(),
            },
          },
        });
        results.email = { ok: true };
      } catch (e) { results.email = { ok: false, message: (e as Error).message }; }
    }
    if ((channel === "sms" || channel === "both") && phone) {
      results.sms = await sendSms(phone, "[InboxIQ] This is a test SMS alert from the admin dashboard.");
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

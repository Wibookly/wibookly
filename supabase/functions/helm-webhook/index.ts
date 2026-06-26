// helm-webhook
// Receives Microsoft Graph change notifications for /me/messages and /me/events.
// - Handles the initial Graph "validationToken" handshake (returns it as text/plain).
// - On notifications: validates clientState, then enqueues a background sync for the
//   affected user/connection (mail or calendar) so The Helm reflects the change.
// - Always responds 202 within a few seconds (Graph requirement).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function invokeBackground(fn: string, body: any, userJwt?: string) {
  // Fire and forget — Graph expects 202 within 30s. We use service-role
  // and pass the target user_id in body; downstream funcs accept that.
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userJwt ?? SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch { /* ignore */ }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    // Graph subscription handshake. MUST be text/plain echo within 10s.
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const notifications: any[] = body?.value ?? [];

  const seen = new Set<string>();
  for (const n of notifications) {
    const subId = n?.subscriptionId;
    const clientState = n?.clientState;
    if (!subId) continue;
    const { data: sub } = await admin
      .from("helm_subscriptions")
      .select("*")
      .eq("graph_subscription_id", subId)
      .maybeSingle();
    if (!sub) continue;
    if (sub.client_state && sub.client_state !== clientState) continue; // tampered
    const key = `${sub.user_id}:${sub.resource}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fn = sub.resource.includes("event") ? "helm-sync-calendar" : "helm-sync-mail";
    // background — do not await
    invokeBackground(fn, { user_id: sub.user_id, connection_id: sub.connection_id, source: "webhook" });
  }

  // Graph wants 202 quickly.
  return new Response("ok", { status: 202 });
});

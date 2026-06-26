// helm-subscribe
// Create or renew Microsoft Graph change-notification subscriptions for
// /me/messages and /me/events. Stores subscription metadata in helm_subscriptions.
//
// POST { mode?: "create" | "renew_all", connection_id?: string }
// - "create" (default): for the caller's outlook connection, ensures one active
//   sub per resource (messages, events). Reuses existing rows when not yet expired.
// - "renew_all": iterates ALL helm_subscriptions expiring within 24h and PATCHes
//   them to extend the lifetime. Called by cron with service-role.
//
// Lifetime caps (Graph): mail = 4230 min (~70.5h), events = 4230 min.
// We request 3 days (4320 too high) → 4200 min to stay under the limit.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
const NOTIFICATION_URL = `${SUPABASE_URL}/functions/v1/helm-webhook`;
const LIFETIME_MIN = 4200; // ~70h
const RENEW_WINDOW_MIN = 60 * 24; // renew if expiring within 24h

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s: number, d: unknown) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const RESOURCES = [
  { api: "mail" as const, resource: "/me/messages", change_type: "created,updated" },
  { api: "calendar" as const, resource: "/me/events", change_type: "created,updated,deleted" },
];

function randomState() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function createSubscription(
  userId: string,
  orgId: string,
  connectionId: string,
  apiName: "mail" | "calendar",
  resource: string,
  changeType: string,
  admin: any,
) {
  const expiry = new Date(Date.now() + LIFETIME_MIN * 60_000).toISOString();
  const clientState = randomState();
  const body = {
    changeType,
    notificationUrl: NOTIFICATION_URL,
    resource,
    expirationDateTime: expiry,
    clientState,
    latestSupportedTlsVersion: "v1_2",
  };
  const r = await callGraph<any>(userId, connectionId, apiName, "/subscriptions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.error };

  await admin.from("helm_subscriptions").insert({
    user_id: userId,
    organization_id: orgId,
    connection_id: connectionId,
    resource,
    graph_subscription_id: r.data.id,
    expires_at: r.data.expirationDateTime ?? expiry,
    client_state: clientState,
    change_type: changeType,
    notification_url: NOTIFICATION_URL,
  });

  await admin.from("activity_log").insert({
    user_id: userId,
    organization_id: orgId,
    action_type: "subscription_created",
    detail: `Subscribed to ${resource}`,
    action_key: `sub_create:${r.data.id}`,
  });
  return { ok: true, id: r.data.id, expires_at: r.data.expirationDateTime };
}

async function renewOne(row: any, admin: any) {
  const newExpiry = new Date(Date.now() + LIFETIME_MIN * 60_000).toISOString();
  const api: "mail" | "calendar" = row.resource.includes("event") ? "calendar" : "mail";
  const r = await callGraph<any>(
    row.user_id,
    row.connection_id,
    api,
    `/subscriptions/${encodeURIComponent(row.graph_subscription_id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: newExpiry }),
    },
  );
  if (!r.ok) {
    // If 404 — sub was lost on Graph side. Recreate.
    if (r.status === 404) {
      await admin.from("helm_subscriptions").delete().eq("id", row.id);
      return await createSubscription(
        row.user_id, row.organization_id, row.connection_id,
        api, row.resource, row.change_type ?? "created,updated", admin,
      );
    }
    return { ok: false, error: r.error };
  }
  await admin
    .from("helm_subscriptions")
    .update({ expires_at: r.data?.expirationDateTime ?? newExpiry, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  await admin.from("activity_log").insert({
    user_id: row.user_id,
    organization_id: row.organization_id,
    action_type: "subscription_renewed",
    detail: `Renewed ${row.resource}`,
    action_key: `sub_renew:${row.graph_subscription_id}:${Date.now()}`,
  });
  return { ok: true, id: row.graph_subscription_id, expires_at: newExpiry };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const payload = (await req.json().catch(() => ({}))) as {
    mode?: "create" | "renew_all";
    connection_id?: string;
  };
  const mode = payload.mode ?? "create";

  // ---- Cron path: renew everything expiring soon ----
  if (mode === "renew_all") {
    const horizon = new Date(Date.now() + RENEW_WINDOW_MIN * 60_000).toISOString();
    const { data: rows } = await admin
      .from("helm_subscriptions")
      .select("*")
      .lt("expires_at", horizon);
    const results: any[] = [];
    for (const row of rows ?? []) {
      results.push({ id: row.id, ...(await renewOne(row, admin)) });
    }
    return json(200, { renewed: results.length, results, project: PROJECT_REF });
  }

  // ---- User-initiated create ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "missing_jwt" });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json(401, { error: "invalid_jwt" });
  const userId = u.user.id;

  const { data: prof } = await admin
    .from("user_profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  const orgId = prof?.organization_id;
  if (!orgId) return json(400, { error: "no_organization" });

  let connectionId = payload.connection_id;
  if (!connectionId) {
    const { data: conn } = await admin
      .from("provider_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "outlook")
      .eq("is_connected", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    connectionId = conn?.id;
  }
  if (!connectionId) return json(400, { error: "no_outlook_connection" });

  const created: any[] = [];
  for (const r of RESOURCES) {
    // Check if an unexpired sub already exists for this resource+connection
    const horizon = new Date(Date.now() + 60 * 60_000).toISOString(); // 1h
    const { data: existing } = await admin
      .from("helm_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("connection_id", connectionId)
      .eq("resource", r.resource)
      .gt("expires_at", horizon)
      .maybeSingle();
    if (existing) {
      created.push({ resource: r.resource, status: "reused", id: existing.graph_subscription_id });
      continue;
    }
    const res = await createSubscription(
      userId, orgId, connectionId, r.api, r.resource, r.change_type, admin,
    );
    created.push({ resource: r.resource, ...res });
  }

  return json(200, { ok: true, subscriptions: created, notification_url: NOTIFICATION_URL });
});

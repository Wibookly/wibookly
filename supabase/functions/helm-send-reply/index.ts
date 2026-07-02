// helm-send-reply
// Sends (or saves) the approved AI reply through Microsoft Graph, preserving threading.
// POST { item_id, body, mode: "send" | "save_draft", auto?: boolean }
//
// Flow:
//   1. POST /me/messages/{graph_id}/createReply  -> draft Message in same thread
//   2. PATCH /me/messages/{draftId}              -> set HTML body
//   3. mode=send  -> POST /me/messages/{draftId}/send
//      mode=save_draft -> leave the draft in Outlook Drafts
//
// Idempotency: if helm_items.status === 'sent', short-circuit.
// Autonomy: auto=true (cron/background) is rejected unless the email's category
//           appears in helm_focus_rules.auto_reply_categories.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "missing_jwt" });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json(401, { error: "invalid_jwt" });
  const userId = u.user.id;

  const payload = (await req.json().catch(() => ({}))) as {
    item_id?: string;
    body?: string;
    mode?: "send" | "save_draft" | "schedule";
    auto?: boolean;
    scheduled_for?: string; // ISO timestamp, required when mode === "schedule"
  };
  const mode = payload.mode ?? "send";
  if (!payload.item_id || !payload.body || !payload.body.trim()) {
    return json(400, { error: "item_id_and_body_required" });
  }

  const { data: item } = await admin
    .from("helm_items")
    .select(
      "id, user_id, organization_id, graph_id, title, payload, status, sender_email",
    )
    .eq("id", payload.item_id)
    .maybeSingle();
  if (!item || item.user_id !== userId) return json(404, { error: "item_not_found" });
  if (!item.graph_id) return json(400, { error: "missing_graph_id" });

  // Idempotency
  if (item.status === "sent") {
    return json(200, { ok: true, already_sent: true });
  }

  // Schedule-send: enqueue and return — actual send happens via cron.
  if (mode === "schedule") {
    const when = payload.scheduled_for ? new Date(payload.scheduled_for) : null;
    if (!when || Number.isNaN(when.getTime())) {
      return json(400, { error: "invalid_scheduled_for" });
    }
    if (when.getTime() < Date.now() - 60_000) {
      return json(400, { error: "scheduled_for_in_past" });
    }
    const { data: row, error: insErr } = await admin
      .from("scheduled_outbox")
      .insert({
        user_id: userId,
        organization_id: item.organization_id,
        item_id: item.id,
        body: payload.body,
        scheduled_for: when.toISOString(),
        status: "queued",
      })
      .select("id, scheduled_for")
      .maybeSingle();
    if (insErr) return json(500, { error: "queue_failed", details: insErr.message });
    await admin
      .from("helm_items")
      .update({
        ai_draft: payload.body,
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    await admin.from("activity_log").insert({
      user_id: userId,
      organization_id: item.organization_id,
      action_type: "email_scheduled",
      detail: `Scheduled reply to "${(item.title ?? "(no subject)").slice(0, 120)}" for ${when.toISOString()}`,
      graph_id: item.graph_id,
      tier: "draft",
      action_key: `scheduled:${item.graph_id}:${row?.id ?? ""}`,
    });
    return json(200, { ok: true, mode, scheduled_for: row?.scheduled_for, queue_id: row?.id });
  }


  // Autonomy gate — auto-send requires explicit per-category opt-in
  if (mode === "send" && payload.auto === true) {
    const category = (item.payload as any)?.category ?? null;
    const { data: rules } = await admin
      .from("helm_focus_rules")
      .select("auto_reply_categories")
      .eq("user_id", userId)
      .maybeSingle();
    const allowed: string[] = rules?.auto_reply_categories ?? [];
    if (!category || !allowed.includes(category)) {
      return json(403, { error: "auto_reply_not_authorized_for_category" });
    }
  }

  const { data: conn } = await admin
    .from("provider_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .eq("is_connected", true)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn?.id) return json(400, { error: "no_outlook_connection" });

  // 1. createReply (re-use a saved draft if we already created one)
  let draftId: string | null = (item.payload as any)?.helm_draft_id ?? null;
  if (!draftId) {
    const r1 = await callGraph<any>(
      userId,
      conn.id,
      "mail",
      `/me/messages/${encodeURIComponent(item.graph_id)}/createReply`,
      { method: "POST" },
    );
    if (!r1.ok) return json(r1.status || 502, { error: "create_reply_failed", details: r1.error });
    draftId = r1.data?.id;
    if (!draftId) return json(502, { error: "no_draft_id_returned" });
  }

  // 2. PATCH body (always set both HTML + plain via Graph: HTML wins)
  // Append the user's saved signature if they haven't already included it.
  let bodyText = payload.body;
  try {
    const { data: prof } = await admin
      .from("user_profiles")
      .select("email_signature, signature_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    const sig = (prof?.email_signature ?? "").trim();
    const sigEnabled = prof?.signature_enabled !== false; // default on
    if (sig && sigEnabled) {
      const bodyLower = bodyText.toLowerCase();
      const sigFirstLine = sig.split(/\r?\n/)[0].trim().toLowerCase();
      if (sigFirstLine && !bodyLower.includes(sigFirstLine)) {
        bodyText = `${bodyText.replace(/\s+$/, "")}\n\n${sig}`;
      }
    }
  } catch { /* signature best-effort */ }
  const html = textToHtml(bodyText);
  const r2 = await callGraph<any>(
    userId,
    conn.id,
    "mail",
    `/me/messages/${encodeURIComponent(draftId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ body: { contentType: "HTML", content: html } }),
    },
  );
  if (!r2.ok) {
    return json(r2.status || 502, { error: "patch_body_failed", details: r2.error });
  }

  // Persist draftId so retries reuse it
  await admin
    .from("helm_items")
    .update({
      payload: { ...(item.payload as any ?? {}), helm_draft_id: draftId },
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  if (mode === "save_draft") {
    await admin
      .from("helm_items")
      .update({ status: "draft", ai_draft: payload.body })
      .eq("id", item.id);
    await admin.from("activity_log").insert({
      user_id: userId,
      organization_id: item.organization_id,
      action_type: "draft_saved",
      detail: `Saved draft reply to "${(item.title ?? "(no subject)").slice(0, 120)}"`,
      graph_id: item.graph_id,
      tier: "draft",
      action_key: `draft:${item.graph_id}`,
    });
    return json(200, { ok: true, mode, draft_id: draftId });
  }

  // 3. SEND
  const r3 = await callGraph<any>(
    userId,
    conn.id,
    "mail",
    `/me/messages/${encodeURIComponent(draftId)}/send`,
    { method: "POST" },
  );
  if (!r3.ok) {
    return json(r3.status || 502, { error: "send_failed", details: r3.error });
  }

  await admin
    .from("helm_items")
    .update({
      status: "sent",
      ai_draft: payload.body,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  await admin.from("activity_log").insert({
    user_id: userId,
    organization_id: item.organization_id,
    action_type: "email_sent",
    detail: `Replied to "${(item.title ?? "(no subject)").slice(0, 120)}" → ${item.sender_email ?? ""}`,
    graph_id: item.graph_id,
    tier: "draft",
    action_key: `sent:${item.graph_id}`,
  });

  return json(200, { ok: true, mode: "send", draft_id: draftId });
});

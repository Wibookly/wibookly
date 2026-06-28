// process-scheduled-outbox
// Runs on a minute-by-minute cron. Picks up due rows in `scheduled_outbox` and
// sends the AI-drafted reply through Microsoft Graph using the same flow as
// helm-send-reply (createReply -> patch body -> send). Idempotent per row.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, d: unknown) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

async function processOne(admin: any, row: any): Promise<{ id: string; status: string; error?: string }> {
  // Claim row
  const { data: claimed } = await admin
    .from("scheduled_outbox")
    .update({ status: "sending", attempts: (row.attempts ?? 0) + 1 })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (!claimed) return { id: row.id, status: "skipped" };

  try {
    const { data: item } = await admin
      .from("helm_items")
      .select("id, user_id, organization_id, graph_id, title, payload, status, sender_email")
      .eq("id", row.item_id)
      .maybeSingle();
    if (!item) throw new Error("helm_item_missing");
    if (item.status === "sent") {
      await admin
        .from("scheduled_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);
      return { id: row.id, status: "already_sent" };
    }
    if (!item.graph_id) throw new Error("missing_graph_id");

    const { data: conn } = await admin
      .from("provider_connections")
      .select("id")
      .eq("user_id", item.user_id)
      .eq("provider", "outlook")
      .eq("is_connected", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn?.id) throw new Error("no_outlook_connection");

    let draftId: string | null = (item.payload as any)?.helm_draft_id ?? null;
    if (!draftId) {
      const r1 = await callGraph<any>(
        item.user_id,
        conn.id,
        "mail",
        `/me/messages/${encodeURIComponent(item.graph_id)}/createReply`,
        { method: "POST" },
      );
      if (!r1.ok) throw new Error(`create_reply_failed:${r1.status}`);
      draftId = r1.data?.id;
      if (!draftId) throw new Error("no_draft_id_returned");
    }

    const html = textToHtml(row.body);
    const r2 = await callGraph<any>(
      item.user_id,
      conn.id,
      "mail",
      `/me/messages/${encodeURIComponent(draftId)}`,
      { method: "PATCH", body: JSON.stringify({ body: { contentType: "HTML", content: html } }) },
    );
    if (!r2.ok) throw new Error(`patch_body_failed:${r2.status}`);

    const r3 = await callGraph<any>(
      item.user_id,
      conn.id,
      "mail",
      `/me/messages/${encodeURIComponent(draftId)}/send`,
      { method: "POST" },
    );
    if (!r3.ok) throw new Error(`send_failed:${r3.status}`);

    await admin
      .from("helm_items")
      .update({ status: "sent", ai_draft: row.body, updated_at: new Date().toISOString() })
      .eq("id", item.id);

    await admin
      .from("scheduled_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString(), draft_id: draftId })
      .eq("id", row.id);

    await admin.from("activity_log").insert({
      user_id: item.user_id,
      organization_id: item.organization_id,
      action_type: "email_sent",
      detail: `Sent scheduled reply to "${(item.title ?? "(no subject)").slice(0, 120)}" → ${item.sender_email ?? ""}`,
      graph_id: item.graph_id,
      tier: "draft",
      action_key: `scheduled_sent:${item.graph_id}:${row.id}`,
    });

    return { id: row.id, status: "sent" };
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const attempts = (row.attempts ?? 0) + 1;
    const next = attempts >= 5 ? "failed" : "queued";
    await admin
      .from("scheduled_outbox")
      .update({ status: next, last_error: message })
      .eq("id", row.id);
    return { id: row.id, status: next, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: due, error } = await admin
    .from("scheduled_outbox")
    .select("id, user_id, item_id, body, attempts, scheduled_for, status")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(25);
  if (error) return json(500, { error: "query_failed", details: error.message });

  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of due ?? []) {
    results.push(await processOne(admin, row));
  }
  return json(200, { ok: true, processed: results.length, results });
});

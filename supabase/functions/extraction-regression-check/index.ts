// Scheduled regression test for attachment extraction.
// For each active Microsoft connection, finds up to 3 recent supported
// attachments and re-extracts them. Logs outcome to extraction_regression_log
// and alerts via m365_api_health when error_kind is set.
//
// Triggered by pg_cron daily, or manually via POST {} with service-role key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const EXTRACTABLE_EXT = /\.(pdf|docx|doc|xlsx|xls|pptx|csv|txt|md|json|rtf|html|htm|xml|log)$/i;
const MAX_PER_USER = 3;

async function probeOne(userId: string, connectionId: string, attachment: {
  message_id: string;
  attachment_id: string;
  name: string;
  contentType?: string;
  size?: number;
}, admin: any) {
  const started = Date.now();
  const externalId = `regression:${attachment.message_id}:${attachment.attachment_id}`;
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/m365-extract-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "x-internal-user-id": userId,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        connection_id: connectionId,
        source_type: "mail_attachment",
        external_id: externalId,
        title: attachment.name,
        mime_type: attachment.contentType,
        message_id: attachment.message_id,
        attachment_id: attachment.attachment_id,
        extra_metadata: { regression: true },
      }),
    });
    const json = await resp.json().catch(() => ({}));
    const duration = Date.now() - started;
    const status = resp.ok ? (json?.status || "completed") : "failed";
    const message = typeof json?.error === "string" ? json.error : (json?.error ? JSON.stringify(json.error) : null);
    const lower = (message || "").toLowerCase();
    const errorKind = !resp.ok
      ? (lower.includes("no valid access token") || lower.includes("token expired") ? "no_token"
        : lower.includes("forbidden") || lower.includes("insufficient privileges") ? "forbidden_scope"
        : resp.status === 401 ? "unauthorized" : "other")
      : null;

    await admin.from("extraction_regression_log").insert({
      user_id: userId,
      connection_id: connectionId,
      source_type: "mail_attachment",
      external_id: externalId,
      file_name: attachment.name,
      status,
      error_kind: errorKind,
      error_message: message?.slice(0, 500) ?? null,
      duration_ms: duration,
    });

    if (errorKind) {
      await admin.from("m365_api_health").insert({
        user_id: userId,
        connection_id: connectionId,
        api_name: "mail",
        status: "failed",
        endpoint: "extraction-regression-check",
        response_ms: duration,
        error_code: `REGRESSION_${errorKind.toUpperCase()}`,
        error_message: `regression ${attachment.name}: ${message?.slice(0, 200) || errorKind}`,
      });
    }
    return { ok: resp.ok, errorKind };
  } catch (e) {
    const duration = Date.now() - started;
    await admin.from("extraction_regression_log").insert({
      user_id: userId,
      connection_id: connectionId,
      source_type: "mail_attachment",
      external_id: externalId,
      file_name: attachment.name,
      status: "failed",
      error_kind: "other",
      error_message: String((e as Error)?.message || e).slice(0, 500),
      duration_ms: duration,
    });
    return { ok: false, errorKind: "other" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: service role key only (cron + admin).
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.includes(SERVICE_ROLE_KEY)) {
    return new Response(JSON.stringify({ error: "service role required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Pick active Outlook connections (limit 25 per run to keep latency bounded).
  const { data: conns, error: connErr } = await admin
    .from("provider_connections")
    .select("id, user_id, connected_email")
    .eq("provider", "outlook")
    .not("connected_email", "is", null)
    .limit(25);

  if (connErr) {
    return new Response(JSON.stringify({ error: connErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const summary = { connections: 0, attachments_tested: 0, failures: 0 };
  for (const c of conns || []) {
    summary.connections++;
    // Latest 10 messages with attachments
    const listed = await callGraph(c.user_id, c.id, "mail",
      `/me/messages?$top=10&$filter=hasAttachments eq true&$select=id,subject`);
    if (!listed.ok) {
      await admin.from("extraction_regression_log").insert({
        user_id: c.user_id, connection_id: c.id, source_type: "mail_attachment",
        file_name: "(listing)", status: "failed",
        error_kind: listed.error?.kind || "other",
        error_message: String(listed.error?.message || "list failed").slice(0, 500),
      });
      summary.failures++;
      continue;
    }

    let tested = 0;
    for (const m of listed.data?.value || []) {
      if (tested >= MAX_PER_USER) break;
      const attRes = await callGraph(c.user_id, c.id, "mail",
        `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,@odata.type`);
      if (!attRes.ok) continue;
      for (const att of attRes.data?.value || []) {
        if (tested >= MAX_PER_USER) break;
        const odataType = att["@odata.type"] || "";
        if (!odataType.includes("fileAttachment")) continue;
        if (!EXTRACTABLE_EXT.test(att.name || "")) continue;
        const r = await probeOne(c.user_id, c.id, {
          message_id: m.id, attachment_id: att.id,
          name: att.name, contentType: att.contentType, size: att.size,
        }, admin);
        tested++;
        summary.attachments_tested++;
        if (!r.ok) summary.failures++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

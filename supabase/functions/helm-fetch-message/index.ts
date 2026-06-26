// helm-fetch-message
// Fetches the original Outlook message body + recipients for a helm_items row.
// POST { item_id }
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

  const { item_id } = (await req.json().catch(() => ({}))) as { item_id?: string };
  if (!item_id) return json(400, { error: "item_id_required" });

  const { data: item } = await admin
    .from("helm_items")
    .select("id, user_id, graph_id, source")
    .eq("id", item_id)
    .maybeSingle();
  if (!item || item.user_id !== userId) return json(404, { error: "item_not_found" });
  if (item.source !== "email" || !item.graph_id) {
    return json(400, { error: "not_an_email_item" });
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

  const endpoint = `/me/messages/${encodeURIComponent(item.graph_id)}?$select=id,subject,body,bodyPreview,from,toRecipients,ccRecipients,conversationId,receivedDateTime`;
  const r = await callGraph<any>(userId, conn.id, "mail", endpoint);
  if (!r.ok) return json(r.status || 502, { error: "graph_failed", details: r.error });

  const m = r.data;
  return json(200, {
    ok: true,
    message: {
      id: m.id,
      subject: m.subject ?? "",
      from: m.from?.emailAddress ?? null,
      to: (m.toRecipients ?? []).map((x: any) => x.emailAddress),
      cc: (m.ccRecipients ?? []).map((x: any) => x.emailAddress),
      body_html:
        m.body?.contentType?.toLowerCase() === "html" ? (m.body?.content ?? "") : "",
      body_text:
        m.body?.contentType?.toLowerCase() === "text"
          ? (m.body?.content ?? "")
          : (m.bodyPreview ?? ""),
      received_at: m.receivedDateTime ?? null,
      conversation_id: m.conversationId ?? null,
    },
  });
});

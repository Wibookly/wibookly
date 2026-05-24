// admin-integration-probe — super-admin-only "Test" button backend for the
// Admin → Integrations tab. Runs a single minimal probe against a target
// service and returns { ok, latency_ms, message, details }.
//
// Graph probes use the super admin's own outlook connection (per product spec).
// AI probes call the project's llm-gateway / embed-text functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

type Service =
  | "mail" | "calendar" | "onedrive" | "sharepoint" | "teams"
  | "llm_gateway" | "embeddings" | "agent_orchestrator" | "chat_agent"
  | "ingest_emails" | "process_ai_emails" | "follow_ups" | "m365_sync"
  | "meeting_copilot_prep" | "meeting_copilot_suggestion" | "meeting_copilot_summary";

interface ProbeResult {
  ok: boolean;
  latency_ms: number;
  message: string;
  details?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const user = userData.user;
  if ((user.email || "").toLowerCase() !== SUPER_ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: "Forbidden — super admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { service: Service };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resolve the super admin's outlook connection for Graph probes
  async function adminConnection(): Promise<{ id: string } | null> {
    const { data } = await admin
      .from("provider_connections")
      .select("id, is_connected, connected_email")
      .eq("user_id", user.id)
      .eq("provider", "outlook")
      .eq("is_connected", true)
      .maybeSingle();
    return data ? { id: data.id } : null;
  }

  const start = Date.now();
  let result: ProbeResult = { ok: false, latency_ms: 0, message: "Unknown probe" };

  try {
    switch (body.service) {
      case "mail": {
        const c = await adminConnection();
        if (!c) { result = { ok: false, latency_ms: 0, message: "No active Outlook connection on super admin account." }; break; }
        const r = await callGraph(user.id, c.id, "mail", "/me/messages?$top=1&$select=id,subject,receivedDateTime");
        result = { ok: r.ok, latency_ms: Date.now() - start,
          message: r.ok ? `Fetched ${r.data?.value?.length ?? 0} message` : (r.error?.message || "Graph error"),
          details: r.ok ? { sample_subject: r.data?.value?.[0]?.subject } : { error: r.error } };
        break;
      }
      case "calendar": {
        const c = await adminConnection();
        if (!c) { result = { ok: false, latency_ms: 0, message: "No active Outlook connection." }; break; }
        const now = new Date();
        const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
        const r = await callGraph(user.id, c.id, "calendar",
          `/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}&$top=1&$select=subject,start`);
        result = { ok: r.ok, latency_ms: Date.now() - start,
          message: r.ok ? `Calendar reachable (${r.data?.value?.length ?? 0} upcoming in window)` : (r.error?.message || "Graph error"),
          details: r.ok ? undefined : { error: r.error } };
        break;
      }
      case "onedrive": {
        const c = await adminConnection();
        if (!c) { result = { ok: false, latency_ms: 0, message: "No active connection." }; break; }
        const r = await callGraph(user.id, c.id, "onedrive", "/me/drive/root?$select=id,name,webUrl");
        result = { ok: r.ok, latency_ms: Date.now() - start,
          message: r.ok ? `OneDrive root reachable (${r.data?.name})` : (r.error?.message || "Graph error"),
          details: r.ok ? undefined : { error: r.error } };
        break;
      }
      case "sharepoint": {
        const c = await adminConnection();
        if (!c) { result = { ok: false, latency_ms: 0, message: "No active connection." }; break; }
        const r = await callGraph(user.id, c.id, "sharepoint", "/search/query", {
          method: "POST",
          body: JSON.stringify({
            requests: [{ entityTypes: ["site"], query: { queryString: "*" }, from: 0, size: 1 }],
          }),
        });
        result = { ok: r.ok, latency_ms: Date.now() - start,
          message: r.ok ? "SharePoint search reachable" : (r.error?.message || "Graph error"),
          details: r.ok ? undefined : { error: r.error } };
        break;
      }
      case "teams": {
        const c = await adminConnection();
        if (!c) { result = { ok: false, latency_ms: 0, message: "No active connection." }; break; }
        // Teams calls share the user scope — joinedTeams requires Team.ReadBasic.All which may not be granted.
        const r = await callGraph(user.id, c.id, "user", "/me/joinedTeams?$select=id,displayName&$top=1");
        result = { ok: r.ok, latency_ms: Date.now() - start,
          message: r.ok ? `Teams reachable (${r.data?.value?.length ?? 0} joined)` : (r.error?.message || "Teams not authorized — Team.ReadBasic.All scope required"),
          details: r.ok ? undefined : { error: r.error } };
        break;
      }
      case "llm_gateway": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/llm-gateway`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: "Reply with just 'ok'." }],
            purpose: "admin:probe",
          }),
        });
        const j = await resp.json().catch(() => ({}));
        result = { ok: resp.ok && !j?.error, latency_ms: Date.now() - start,
          message: resp.ok ? `Model responded (${(j?.content || "").slice(0, 40)})` : (j?.error || `HTTP ${resp.status}`),
          details: { model: j?.model, usage: j?.usage } };
        break;
      }
      case "embeddings": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/embed-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
          body: JSON.stringify({ text: "integration probe" }),
        });
        const j = await resp.json().catch(() => ({}));
        const dim = Array.isArray(j?.embedding) ? j.embedding.length : null;
        result = { ok: resp.ok && dim !== null, latency_ms: Date.now() - start,
          message: resp.ok ? `Embedding generated (${dim} dims)` : (j?.error || `HTTP ${resp.status}`) };
        break;
      }
      case "agent_orchestrator": {
        const c = await adminConnection();
        if (!c) { result = { ok: false, latency_ms: 0, message: "Need an active Outlook connection." }; break; }
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/agent-orchestrator`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
          body: JSON.stringify({
            agent: "qa", connection_id: c.id,
            user_message: "Reply with just the word 'ok'. Do not call any tools.",
            max_steps: 1,
          }),
        });
        const j = await resp.json().catch(() => ({}));
        result = { ok: resp.ok && !j?.error, latency_ms: Date.now() - start,
          message: resp.ok ? `Agent responded (${(j?.reply || "").slice(0, 60)})` : (j?.error || `HTTP ${resp.status}`),
          details: { model: j?.model } };
        break;
      }
      case "chat_agent": {
        const c = await adminConnection();
        if (!c) { result = { ok: false, latency_ms: 0, message: "Need an active Outlook connection." }; break; }
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/chat-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
          body: JSON.stringify({ message: "Reply with just 'ok'. No tools.", connection_id: c.id }),
        });
        result = { ok: resp.ok, latency_ms: Date.now() - start,
          message: resp.ok ? "chat-agent SSE stream opened" : `HTTP ${resp.status}` };
        // Drain stream briefly
        try { await resp.body?.cancel(); } catch { /* noop */ }
        break;
      }
      case "m365_sync": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/m365-sync-all`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
          body: JSON.stringify({ triggered_by: "admin_probe" }),
        });
        const j = await resp.json().catch(() => ({}));
        result = { ok: resp.ok, latency_ms: Date.now() - start,
          message: resp.ok ? `Sync fan-out triggered (${j?.queued ?? 0} connections)` : `HTTP ${resp.status}`,
          details: j };
        break;
      }
      case "ingest_emails": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/cron-ingest-emails`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
          body: JSON.stringify({ triggered_by: "admin_probe" }),
        });
        result = { ok: resp.ok, latency_ms: Date.now() - start,
          message: resp.ok ? "cron-ingest-emails triggered" : `HTTP ${resp.status}` };
        break;
      }
      case "process_ai_emails": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/process-ai-emails`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
          body: JSON.stringify({ triggered_by: "admin_probe" }),
        });
        result = { ok: resp.ok, latency_ms: Date.now() - start,
          message: resp.ok ? "process-ai-emails triggered" : `HTTP ${resp.status}` };
        break;
      }
      case "follow_ups": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/cron-follow-ups`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
          body: JSON.stringify({ triggered_by: "admin_probe" }),
        });
        result = { ok: resp.ok, latency_ms: Date.now() - start,
          message: resp.ok ? "cron-follow-ups triggered" : `HTTP ${resp.status}` };
        break;
      }
      case "meeting_copilot_prep": {
        // Lightweight reachability probe — call the function with a deliberately
        // bogus meetingId so it short-circuits without invoking AI but still
        // proves the function is deployed & responding.
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/meeting-copilot-prep`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
          body: JSON.stringify({ meetingId: "__probe__" }),
        });
        const j = await resp.json().catch(() => ({}));
        const ok = resp.ok && (j?.error === "no_outlook_connection" || j?.error === "event_not_found" || !!j?.prep);
        result = { ok, latency_ms: Date.now() - start,
          message: ok ? "meeting-copilot-prep responding" : (j?.error || `HTTP ${resp.status}`) };
        break;
      }
      case "meeting_copilot_suggestion": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/meeting-copilot-suggestion`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
          body: JSON.stringify({ sessionId: "__probe__", intent: "say", transcript: "ping" }),
        });
        const j = await resp.json().catch(() => ({}));
        const ok = resp.ok && (j?.error === undefined || ["session_not_found", "no_transcript", "ai_unavailable"].includes(j?.error));
        result = { ok, latency_ms: Date.now() - start,
          message: ok ? "meeting-copilot-suggestion responding" : (j?.error || `HTTP ${resp.status}`) };
        break;
      }
      case "meeting_copilot_summary": {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/meeting-copilot-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
          body: JSON.stringify({ sessionId: "__probe__" }),
        });
        const j = await resp.json().catch(() => ({}));
        const ok = resp.ok && (j?.error === "session_not_found" || !!j?.summary);
        result = { ok, latency_ms: Date.now() - start,
          message: ok ? "meeting-copilot-summary responding" : (j?.error || `HTTP ${resp.status}`) };
        break;
      }
      default:
        result = { ok: false, latency_ms: 0, message: `Unknown service: ${body.service}` };
    }
  } catch (e) {
    result = { ok: false, latency_ms: Date.now() - start, message: (e as Error).message };
  }

  result.latency_ms = result.latency_ms || (Date.now() - start);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

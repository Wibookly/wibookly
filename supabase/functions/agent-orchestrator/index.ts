// Agent Orchestrator - wires retrieve-context + llm-gateway with a tool loop
// Supports Q&A and email-drafting agents with multi-turn tool execution
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceLimitsBeforeLLM, recordSpend, blockedResponse, detectProvider } from "../_shared/enforce-limits.ts";
import { callGraph } from "../_shared/graph-call.ts";
import { finalizeReply, isAuthRelatedToolError } from "./reply-guards.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string };

function normalizeToolCalls(value: unknown): any[] | undefined {
  return Array.isArray(value) && value.length > 0 ? value : undefined;
}

interface OrchestrateRequest {
  conversation_id?: string;
  connection_id: string;
  agent: "qa" | "email_draft";
  user_message: string;
  thread_id?: string;
  model?: string;
  max_steps?: number;
}

// Tool definitions exposed to the LLM (OpenAI function-calling shape; gateway converts for Anthropic)
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_context",
      description: "Hybrid search across the user's knowledge base and prior emails. Use to ground answers in real data before responding.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query." },
          top_k: { type: "number", description: "Number of results to return (default 8)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_email_thread",
      description: "Fetch the full message history of a specific email thread by id.",
      parameters: {
        type: "object",
        properties: { thread_id: { type: "string" } },
        required: ["thread_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_outlook_mail",
      description: "Search the user's live Outlook mailbox via Microsoft Graph. Returns subject, from, snippet, receivedDateTime, webLink. Set extract=true to also download and index supported attachments (PDF/DOCX/XLSX/TXT) so their full contents become searchable via search_context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search query (Graph $search syntax). Example: 'invoice gowithsupport'." },
          top: { type: "number", description: "Max results (default 10, max 25)." },
          extract: { type: "boolean", description: "If true, download + index attachments from matching messages." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_onedrive",
      description: "Search the user's OneDrive for files. Set extract=true to download + index supported file contents.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          top: { type: "number", description: "Default 10, max 25." },
          extract: { type: "boolean", description: "If true, download + index supported file contents." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_sharepoint",
      description: "Search SharePoint sites the user has access to. Set extract=true to download + index supported file contents.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          top: { type: "number", description: "Default 10, max 25." },
          extract: { type: "boolean", description: "If true, download + index supported file contents." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_calendar_events",
      description: "Fetch the user's calendar events in a time window. Use for 'what's on my calendar', 'meetings today/tomorrow/this week'.",
      parameters: {
        type: "object",
        properties: {
          start_iso: { type: "string", description: "ISO start datetime (UTC). Defaults to now." },
          end_iso: { type: "string", description: "ISO end datetime (UTC). Defaults to 7 days from start." },
          top: { type: "number", description: "Default 20, max 50." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compose_email_draft",
      description: "Produce the final email draft. Call this once you have enough context to write the reply. Returns the draft to the user (does NOT send).",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string" },
          body: { type: "string", description: "Plain-text or HTML body of the email." },
          to: { type: "array", items: { type: "string" } },
          cc: { type: "array", items: { type: "string" } },
        },
        required: ["subject", "body"],
      },
    },
  },
];

const QA_SYSTEM = `You are an InboxIQ assistant with full access to the user's Microsoft 365 data via tools.

Tool selection:
- For questions about emails, invoices, senders, receipts, conversations → call search_outlook_mail.
- For files, documents, PDFs, spreadsheets → call search_onedrive and/or search_sharepoint.
- For meetings, calendar, schedule → call get_calendar_events.
- For indexed knowledge base / prior synced threads → call search_context.
- You may call multiple tools in parallel or sequentially to gather evidence.
- Generic chit-chat or general-knowledge questions ("hi", "what is RAG?") do NOT need tools.

Reading file contents (invoices, contracts, spreadsheets):
- search_outlook_mail / search_onedrive / search_sharepoint only return SNIPPETS and metadata — not the full file body.
- When the user asks about something that lives INSIDE a file (e.g. "what was the invoice total", "what does the contract say about renewal", "summarize this PDF"), FIRST call the relevant search tool with extract=true. This downloads + indexes the file contents.
- THEN call search_context with a precise query to retrieve the actual extracted text. Cite the document title.

Rules:
- NEVER tell the user you "don't have access" to their email/files/calendar — you do, via tools. Call them.
- Only ask the user to reconnect if a tool result has error.kind of no_token, unauthorized, or forbidden_scope.
- If tools run successfully but return no matches, say you couldn't find a reliable match yet and ask for a narrower sender, filename, vendor name, invoice number, or date range.
- If mail/file search succeeds but the exact answer is still not visible, never blame connection state; explain what was or wasn't found.
- Cite sources inline with the subject/filename and link when available. Never fabricate.
- Be concise and structured.`;

const DRAFT_SYSTEM = `You are an InboxIQ email-drafting agent.
- Use search_outlook_mail and search_context to gather background on the recipient and prior threads.
- For files referenced by the user, use search_onedrive / search_sharepoint.
- If a thread_id is provided, call get_email_thread to read the conversation.
- When ready, call compose_email_draft with the final subject and body. Never send — drafts always go to the user for review.
- Match the user's writing style (concise, professional). Never invent facts.`;

async function callGateway(
  authHeader: string,
  body: Record<string, unknown>,
  userId?: string,
): Promise<any> {
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
  };
  // Prefer internal service-role call when we have a verified user id.
  // This bypasses JWT re-validation issues across function-to-function calls.
  if (userId) {
    headers["Authorization"] = `Bearer ${SERVICE_ROLE_KEY}`;
    headers["x-internal-user-id"] = userId;
  } else {
    headers["Authorization"] = authHeader;
  }
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/llm-gateway`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`llm-gateway ${resp.status}: ${t}`);
  }
  return await resp.json();
}

async function callRetrieve(
  authHeader: string,
  connection_id: string,
  query: string,
  top_k: number,
): Promise<any> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/retrieve-context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ connection_id, query, top_k }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { error: `retrieve-context ${resp.status}: ${t}`, results: [] };
  }
  return await resp.json();
}

async function callExtract(authHeader: string, payload: Record<string, unknown>): Promise<any> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/m365-extract-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: ANON_KEY },
      body: JSON.stringify(payload),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, status: resp.status, error: json?.error || `HTTP ${resp.status}` };
    return { ok: true, ...json };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

const EXTRACTABLE_EXT = /\.(pdf|docx|xlsx|txt|md|csv)$/i;

async function executeTool(
  name: string,
  args: any,
  ctx: { authHeader: string; connection_id: string; admin: any; user_id: string },
): Promise<any> {
  if (name === "search_context") {
    return await callRetrieve(ctx.authHeader, ctx.connection_id, String(args.query || ""), Number(args.top_k || 8));
  }
  if (name === "get_email_thread") {
    const { data: thread } = await ctx.admin
      .from("email_threads")
      .select("id, subject, participants, last_message_at")
      .eq("id", args.thread_id)
      .eq("user_id", ctx.user_id)
      .maybeSingle();
    if (!thread) return { error: "Thread not found" };
    const { data: messages } = await ctx.admin
      .from("email_messages")
      .select("from_email, to_emails, subject, body_clean, sent_at")
      .eq("thread_id", args.thread_id)
      .eq("user_id", ctx.user_id)
      .order("sent_at", { ascending: true })
      .limit(50);
    return { thread, messages: messages || [] };
  }
  if (name === "search_outlook_mail") {
    const q = String(args.query || "").trim();
    const top = Math.min(Math.max(Number(args.top) || 10, 1), 25);
    const extract = !!args.extract;
    if (!q) return { error: "query required" };
    const endpoint = `/me/messages?$search="${encodeURIComponent(q).replace(/"/g, '%22')}"&$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview,webLink,hasAttachments`;
    const res = await callGraph(ctx.user_id, ctx.connection_id, "mail", endpoint, {
      headers: { ConsistencyLevel: "eventual" },
    });
    if (!res.ok) return { error: res.error, hint: res.error?.kind === "forbidden_scope"
      ? "Mail.Read scope missing — ask user to reconnect Microsoft 365." : undefined };
    const items = (res.data?.value || []).map((m: any) => ({
      id: m.id,
      subject: m.subject,
      from: m.from?.emailAddress?.address,
      from_name: m.from?.emailAddress?.name,
      received: m.receivedDateTime,
      snippet: m.bodyPreview,
      has_attachments: m.hasAttachments,
      web_link: m.webLink,
    }));

    let extracted: any[] = [];
    if (extract) {
      for (const m of items) {
        if (!m.has_attachments) continue;
        // List attachments for this message
        const attRes = await callGraph(ctx.user_id, ctx.connection_id, "mail",
          `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,@odata.type`);
        if (!attRes.ok) continue;
        for (const att of attRes.data?.value || []) {
          const odataType = att["@odata.type"] || "";
          if (!odataType.includes("fileAttachment")) continue; // skip itemAttachment/referenceAttachment
          if (!EXTRACTABLE_EXT.test(att.name || "")) continue;
          const ex = await callExtract(ctx.authHeader, {
            connection_id: ctx.connection_id,
            source_type: "mail_attachment",
            external_id: `${m.id}:${att.id}`,
            title: att.name,
            mime_type: att.contentType,
            message_id: m.id,
            attachment_id: att.id,
            source_ref: m.web_link,
            extra_metadata: { message_subject: m.subject, from: m.from, received: m.received },
          });
          extracted.push({
            message_id: m.id, message_subject: m.subject,
            attachment_name: att.name, size: att.size,
            status: ex.status || (ex.ok ? "ok" : "error"),
            document_id: ex.document_id,
            extracted_metadata: ex.extracted_metadata,
            error: ex.error,
          });
        }
      }
    }

    return {
      count: items.length, results: items,
      ...(extract ? { extracted, next_step: "Call search_context with a specific query to retrieve full extracted content." } : {}),
    };
  }
  if (name === "search_onedrive") {
    const q = String(args.query || "").trim();
    const top = Math.min(Math.max(Number(args.top) || 10, 1), 25);
    const extract = !!args.extract;
    if (!q) return { error: "query required" };
    const endpoint = `/me/drive/root/search(q='${encodeURIComponent(q).replace(/'/g, "%27")}')?$top=${top}&$select=id,name,webUrl,size,lastModifiedDateTime,file,folder`;
    const res = await callGraph(ctx.user_id, ctx.connection_id, "onedrive", endpoint);
    if (!res.ok) return { error: res.error };
    const items = (res.data?.value || []).map((f: any) => ({
      id: f.id, name: f.name, web_url: f.webUrl, size: f.size,
      modified: f.lastModifiedDateTime,
      kind: f.folder ? "folder" : (f.file?.mimeType || "file"),
    }));

    let extracted: any[] = [];
    if (extract) {
      for (const f of items) {
        if (f.kind === "folder") continue;
        if (!EXTRACTABLE_EXT.test(f.name || "")) continue;
        const ex = await callExtract(ctx.authHeader, {
          connection_id: ctx.connection_id,
          source_type: "onedrive",
          external_id: f.id,
          title: f.name,
          mime_type: typeof f.kind === "string" ? f.kind : undefined,
          drive_item_id: f.id,
          source_ref: f.web_url,
          extra_metadata: { size: f.size, modified: f.modified },
        });
        extracted.push({
          file_name: f.name, size: f.size,
          status: ex.status || (ex.ok ? "ok" : "error"),
          document_id: ex.document_id,
          extracted_metadata: ex.extracted_metadata,
          error: ex.error,
        });
      }
    }

    return {
      count: items.length, results: items,
      ...(extract ? { extracted, next_step: "Call search_context with a specific query to retrieve full extracted content." } : {}),
    };
  }
  if (name === "search_sharepoint") {
    const q = String(args.query || "").trim();
    const top = Math.min(Math.max(Number(args.top) || 10, 1), 25);
    const extract = !!args.extract;
    if (!q) return { error: "query required" };
    const body = {
      requests: [{
        entityTypes: ["driveItem", "listItem", "site"],
        query: { queryString: q },
        from: 0,
        size: top,
      }],
    };
    const res = await callGraph(ctx.user_id, ctx.connection_id, "sharepoint", "/search/query", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) return { error: res.error };
    const hits = res.data?.value?.[0]?.hitsContainers?.[0]?.hits || [];
    const items = hits.map((h: any) => ({
      rank: h.rank,
      summary: h.summary,
      name: h.resource?.name || h.resource?.displayName,
      web_url: h.resource?.webUrl,
      last_modified: h.resource?.lastModifiedDateTime,
      kind: h.resource?.["@odata.type"],
      drive_id: h.resource?.parentReference?.driveId,
      item_id: h.resource?.id,
    }));

    let extracted: any[] = [];
    if (extract) {
      for (const it of items) {
        if (!it.drive_id || !it.item_id) continue;
        if (!it.name || !EXTRACTABLE_EXT.test(it.name)) continue;
        const ex = await callExtract(ctx.authHeader, {
          connection_id: ctx.connection_id,
          source_type: "sharepoint",
          external_id: `${it.drive_id}:${it.item_id}`,
          title: it.name,
          drive_id: it.drive_id,
          item_id: it.item_id,
          source_ref: it.web_url,
          extra_metadata: { last_modified: it.last_modified },
        });
        extracted.push({
          file_name: it.name,
          status: ex.status || (ex.ok ? "ok" : "error"),
          document_id: ex.document_id,
          extracted_metadata: ex.extracted_metadata,
          error: ex.error,
        });
      }
    }

    return {
      count: items.length, results: items,
      ...(extract ? { extracted, next_step: "Call search_context with a specific query to retrieve full extracted content." } : {}),
    };
  }
  if (name === "get_calendar_events") {
    const start = args.start_iso ? new Date(args.start_iso) : new Date();
    const end = args.end_iso ? new Date(args.end_iso) : new Date(start.getTime() + 7 * 24 * 3600 * 1000);
    const top = Math.min(Math.max(Number(args.top) || 20, 1), 50);
    const endpoint = `/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}`
      + `&$orderby=start/dateTime&$top=${top}`
      + `&$select=id,subject,organizer,start,end,location,onlineMeeting,webLink,isAllDay,attendees`;
    const res = await callGraph(ctx.user_id, ctx.connection_id, "calendar", endpoint, {
      headers: { Prefer: 'outlook.timezone="UTC"' },
    });
    if (!res.ok) return { error: res.error };
    const items = (res.data?.value || []).map((e: any) => ({
      id: e.id,
      subject: e.subject,
      organizer: e.organizer?.emailAddress?.address,
      start: e.start?.dateTime, end: e.end?.dateTime,
      location: e.location?.displayName,
      online_join_url: e.onlineMeeting?.joinUrl,
      web_link: e.webLink,
      is_all_day: e.isAllDay,
      attendees: (e.attendees || []).map((a: any) => a.emailAddress?.address).filter(Boolean),
    }));
    return { count: items.length, results: items };
  }
  if (name === "compose_email_draft") {
    return {
      draft: {
        subject: args.subject,
        body: args.body,
        to: args.to || [],
        cc: args.cc || [],
      },
      status: "ready_for_review",
    };
  }
  return { error: `Unknown tool: ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = (await req.json()) as OrchestrateRequest;
    if (!body?.connection_id || !body?.agent || !body?.user_message) {
      return new Response(JSON.stringify({ error: "connection_id, agent, user_message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve organization
    const { data: profile } = await admin
      .from("user_profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const organization_id = profile?.organization_id ?? null;

    // Load or create conversation
    let conversation_id = body.conversation_id;
    if (!conversation_id) {
      const { data: conv, error: convErr } = await admin
        .from("ai_chat_conversations")
        .insert({
          user_id: user.id,
          organization_id,
          connection_id: body.connection_id,
          agent_mode: body.agent === "email_draft",
          context_email_thread_id: body.thread_id ?? null,
          title: body.user_message.slice(0, 60),
        })
        .select("id")
        .single();
      if (convErr) throw convErr;
      conversation_id = conv.id;
    }

    // Load prior messages
    const { data: prior } = await admin
      .from("ai_chat_messages")
      .select("role, content, tool_calls, tool_results")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(40);

    const systemPrompt = body.agent === "email_draft" ? DRAFT_SYSTEM : QA_SYSTEM;
    const messages: Msg[] = [{ role: "system", content: systemPrompt }];
    for (const m of prior || []) {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({
          role: m.role as any,
          content: m.content,
          tool_calls: normalizeToolCalls((m as any).tool_calls),
        });
      }
    }
    messages.push({ role: "user", content: body.user_message });

    // Persist the user message
    await admin.from("ai_chat_messages").insert({
      conversation_id,
      role: "user",
      content: body.user_message,
    });

    const requestedModel = body.model || "openai/gpt-4.1";

    // Pre-flight enforcement (feature gating, daily count, per-user/org budgets, model routing)
    const featureKey = body.agent === 'email_draft' ? 'ai_draft' : 'ai_chat';
    const fallbackModel = requestedModel.replace(/^openai\//, '').replace(/^anthropic\//, '');
    const gate = await enforceLimitsBeforeLLM(admin, {
      userId: user.id,
      organizationId: organization_id || '',
      feature: featureKey,
      fallbackModel,
    });
    if (!gate.allowed) return blockedResponse(gate.reason || 'blocked', corsHeaders);

    // Use model returned by gate (group_features.model_assignment override, or fallback)
    const routedModel = gate.model || fallbackModel;
    // Preserve provider prefix expected by llm-gateway
    const model = routedModel.includes('/')
      ? routedModel
      : (routedModel.startsWith('claude') ? `anthropic/${routedModel}` : `openai/${routedModel}`);

    const maxSteps = Math.min(body.max_steps ?? 6, 10);
    const ctx = { authHeader, connection_id: body.connection_id, admin, user_id: user.id };

    let final: any = null;
    let lastUsage: any = null;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let draft: any = null;
    const citations: any[] = [];
    const seenCitationKeys = new Set<string>();
    let sawAuthToolFailure = false;
    let sawSuccessfulDataTool = false;

    for (let step = 0; step < maxSteps; step++) {
      const llmResp = await callGateway(authHeader, {
        model,
        messages,
        tools: TOOLS,
        purpose: `agent:${body.agent}`,
        conversation_id,
        connection_id: body.connection_id,
      }, user.id);
      lastUsage = llmResp.usage;
      totalTokensIn += Number(llmResp.usage?.tokens_in ?? llmResp.usage?.prompt_tokens ?? 0);
      totalTokensOut += Number(llmResp.usage?.tokens_out ?? llmResp.usage?.completion_tokens ?? 0);

      const toolCalls = llmResp.tool_calls || [];
      const assistantMsg: Msg = {
        role: "assistant",
        content: llmResp.content || "",
        tool_calls: toolCalls.length ? toolCalls : undefined,
      };
      messages.push(assistantMsg);

      if (!toolCalls.length) {
        final = llmResp;
        break;
      }

      // Execute each tool call sequentially
      for (const call of toolCalls) {
        let parsedArgs: any = {};
        try {
          parsedArgs = typeof call.function?.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : (call.function?.arguments || {});
        } catch {
          parsedArgs = {};
        }
        const toolName = call.function?.name || call.name;
        const result = await executeTool(toolName, parsedArgs, ctx);
        if (isAuthRelatedToolError(result)) {
          sawAuthToolFailure = true;
        }
        if (
          ["search_outlook_mail", "search_onedrive", "search_sharepoint", "get_calendar_events", "search_context", "get_email_thread"].includes(toolName)
          && !result?.error
        ) {
          sawSuccessfulDataTool = true;
        }
        if (toolName === "compose_email_draft" && result?.draft) {
          draft = result.draft;
        }
        // Collect citations from search_context (hybrid retrieve-context shape)
        if (toolName === "search_context" && Array.isArray(result?.results)) {
          for (const r of result.results) {
            const md = r.metadata || {};
            const sourceType: string = md.source_type
              || (r.source === 'email' ? 'email' : 'knowledge');
            const key = `${sourceType}:${r.id || md.document_id || ''}`;
            if (seenCitationKeys.has(key)) continue;
            seenCitationKeys.add(key);
            citations.push({
              source: r.source || 'knowledge',
              source_type: sourceType,
              id: r.id ?? null,
              title: r.title || 'Source',
              url: md.source_ref || md.web_link || null,
              from: md.from_email ?? null,
              sent_at: md.sent_at ?? null,
              snippet: typeof r.snippet === 'string' ? r.snippet.slice(0, 240) : null,
              similarity: typeof md.similarity === 'number' ? md.similarity : null,
            });
          }
        }
        // Also surface direct tool hits as citations so the user sees source chips
        // even when the LLM answers directly from Graph search results.
        if (toolName === "search_outlook_mail" && Array.isArray(result?.results)) {
          for (const m of result.results.slice(0, 6)) {
            const key = `outlook:${m.id}`;
            if (seenCitationKeys.has(key)) continue;
            seenCitationKeys.add(key);
            citations.push({
              source: 'email', source_type: 'outlook',
              id: m.id, title: m.subject || '(no subject)',
              url: m.web_link || null, from: m.from || null,
              sent_at: m.received || null, snippet: m.snippet || null,
            });
          }
        }
        if (toolName === "search_onedrive" && Array.isArray(result?.results)) {
          for (const f of result.results.slice(0, 6)) {
            if (f.kind === 'folder') continue;
            const key = `onedrive:${f.id}`;
            if (seenCitationKeys.has(key)) continue;
            seenCitationKeys.add(key);
            citations.push({
              source: 'document', source_type: 'onedrive',
              id: f.id, title: f.name, url: f.web_url || null,
              sent_at: f.modified || null,
            });
          }
        }
        if (toolName === "search_sharepoint" && Array.isArray(result?.results)) {
          for (const it of result.results.slice(0, 6)) {
            const key = `sharepoint:${it.item_id || it.web_url}`;
            if (seenCitationKeys.has(key)) continue;
            seenCitationKeys.add(key);
            citations.push({
              source: 'document', source_type: 'sharepoint',
              id: it.item_id || null, title: it.name || 'SharePoint item',
              url: it.web_url || null, sent_at: it.last_modified || null,
              snippet: it.summary || null,
            });
          }
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: toolName,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
    }

    const finalText = finalizeReply({
      finalText: final?.content || (draft ? "Draft prepared for your review." : "I wasn't able to complete that request."),
      sawAuthToolFailure,
      sawSuccessfulDataTool,
      citationsLength: citations.length,
    });

    // Persist assistant reply
    const persistedToolCalls = messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => normalizeToolCalls(m.tool_calls) || []);

    await admin.from("ai_chat_messages").insert({
      conversation_id,
      role: "assistant",
      content: finalText,
      tool_calls: persistedToolCalls.length ? persistedToolCalls : null,
      tool_results: draft ? { draft } : null,
      citations: citations.length ? citations : null,
      model_used: model,
      tokens_in: lastUsage?.tokens_in ?? null,
      tokens_out: lastUsage?.tokens_out ?? null,
    });

    // Post-call accounting (user_daily_spend + org_agent_budget + ai_usage_logs)
    try {
      await recordSpend(admin, {
        userId: user.id,
        organizationId: organization_id || '',
        groupId: gate.group_id,
        feature: featureKey,
        provider: detectProvider(routedModel),
        model: routedModel,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        metadata: { conversation_id, agent: body.agent },
      });
    } catch (e) {
      console.error('agent-orchestrator recordSpend error', e);
    }

    return new Response(
      JSON.stringify({
        conversation_id,
        reply: finalText,
        draft,
        citations,
        model,
        usage: lastUsage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("agent-orchestrator error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

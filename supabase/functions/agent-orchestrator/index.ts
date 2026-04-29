// Agent Orchestrator - wires retrieve-context + llm-gateway with a tool loop
// Supports Q&A and email-drafting agents with multi-turn tool execution
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string };

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

const QA_SYSTEM = `You are an InboxIQ assistant with access to the user's knowledge base and email history.
- ALWAYS call search_context first to gather grounded evidence before answering substantive questions.
- Cite sources inline using [#] markers tied to the snippets returned.
- If retrieved context is insufficient, say so honestly. Never fabricate.
- Be concise and structured.`;

const DRAFT_SYSTEM = `You are an InboxIQ email-drafting agent.
- Use search_context to gather background on the recipient, prior threads, and relevant knowledge.
- If a thread_id is provided, call get_email_thread to read the conversation.
- When ready, call compose_email_draft with the final subject and body. Never send — drafts always go to the user for review.
- Match the user's writing style (concise, professional). Never invent facts.`;

async function callGateway(
  authHeader: string,
  body: Record<string, unknown>,
): Promise<any> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/llm-gateway`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: ANON_KEY,
    },
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
        messages.push({ role: m.role as any, content: m.content, tool_calls: (m as any).tool_calls ?? undefined });
      }
    }
    messages.push({ role: "user", content: body.user_message });

    // Persist the user message
    await admin.from("ai_chat_messages").insert({
      conversation_id,
      role: "user",
      content: body.user_message,
    });

    const model = body.model || "openai/gpt-5-mini";
    const maxSteps = Math.min(body.max_steps ?? 6, 10);
    const ctx = { authHeader, connection_id: body.connection_id, admin, user_id: user.id };

    let final: any = null;
    let lastUsage: any = null;
    let draft: any = null;
    const citations: any[] = [];
    const seenCitationKeys = new Set<string>();

    for (let step = 0; step < maxSteps; step++) {
      const llmResp = await callGateway(authHeader, {
        model,
        messages,
        tools: TOOLS,
        purpose: `agent:${body.agent}`,
        conversation_id,
        connection_id: body.connection_id,
      });
      lastUsage = llmResp.usage;

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
        if (toolName === "compose_email_draft" && result?.draft) {
          draft = result.draft;
        }
        if (toolName === "search_context" && Array.isArray(result?.results)) {
          for (const r of result.results) {
            const key = `${r.type || 'doc'}:${r.id || r.document_id || r.thread_id || r.subject || ''}`;
            if (seenCitationKeys.has(key)) continue;
            seenCitationKeys.add(key);
            citations.push({
              type: r.type || (r.from_email ? 'email' : 'document'),
              id: r.id ?? null,
              title: r.subject || r.title || r.from_email || 'Source',
              from: r.from_email ?? null,
              sent_at: r.sent_at ?? null,
              snippet: typeof r.content === 'string'
                ? r.content.slice(0, 240)
                : (typeof r.body_clean === 'string' ? r.body_clean.slice(0, 240) : null),
              similarity: typeof r.similarity === 'number' ? r.similarity : null,
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

    const finalText = final?.content || (draft ? "Draft prepared for your review." : "I wasn't able to complete that request.");

    // Persist assistant reply
    await admin.from("ai_chat_messages").insert({
      conversation_id,
      role: "assistant",
      content: finalText,
      tool_calls: messages.filter((m) => m.role === "assistant" && m.tool_calls).flatMap((m) => m.tool_calls || []),
      tool_results: draft ? { draft } : null,
      model_used: model,
      tokens_in: lastUsage?.tokens_in ?? null,
      tokens_out: lastUsage?.tokens_out ?? null,
    });

    return new Response(
      JSON.stringify({
        conversation_id,
        reply: finalText,
        draft,
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

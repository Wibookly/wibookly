// agent-loop — the shared "brain" for the InboxIQ agent.
// Inputs: a task description (typically an inbound email body + thread context)
// Outputs: { reply_html, attachments[] }
//
// Architecture (3-tier fallback chain):
//   1. PRIMARY   — OpenAI Responses API (gpt-4.1) with built-in web_search tool
//                  + custom doc-generation tools (generate_pdf/docx/xlsx/pptx)
//                  in a multi-iteration tool loop.
//   2. SECONDARY — OpenAI Responses API (gpt-4o) — same shape as primary,
//                  used if primary fails (e.g. model-access error).
//   3. FALLBACK  — Anthropic Messages API (claude-sonnet-4-5) with built-in
//                  web_search_20250305 + web_fetch_20250910 server tools, plus
//                  the same custom doc tools.
//
// Hard limits:
//   - max 15 tool iterations
//   - 5-minute total wall clock cap
//   - response truncated if >24 attachments produced
//
// SECURITY: This function is invoked server-to-server by graph-mail-webhook
// (and later teams-bot). It validates a shared secret, not a user JWT.
// deno-lint-ignore-file no-explicit-any

import { runDocTool, DOC_TOOLS_OPENAI, GeneratedFile } from '../_shared/document-generators.ts';
import { enforceLimitsBeforeLLM, recordSpend, blockedResponse, detectProvider } from '../_shared/enforce-limits.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const OPENAI_PRIMARY_MODEL = 'gpt-4.1';
const OPENAI_FALLBACK_MODEL = 'gpt-4o';
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';

const MAX_ITERATIONS = 8;
const MAX_WALL_MS = 100 * 1000;
const REQUEST_SAFETY_MS = 4_000;
const MAX_ATTACHMENTS = 24;

interface AgentRequest {
  task: string;                  // Inbound email body / Teams message / orchestrator task
  thread_context?: string;       // Optional prior conversation (already formatted)
  sender_name?: string;
  sender_email?: string;
  subject?: string;
  organization_id?: string;
  user_id?: string;
  channel?: 'email' | 'teams' | 'api';
  preferred_provider?: 'openai' | 'anthropic';  // optional override
}

interface AgentResult {
  reply_html: string;
  attachments: GeneratedFile[];
  provider: 'openai' | 'anthropic' | 'system';
  model: string;
  iterations: number;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  used_web_search: boolean;
  trace: { step: number; type: string; detail?: string }[];
}

interface RunContext {
  deadlineAt: number;
  webSearchEnabled: boolean;
  maxAttachments: number;
}

function normalizeTaskText(req: AgentRequest): string {
  return [req.subject ?? '', req.task ?? '', req.thread_context ?? '']
    .join('\n')
    .toLowerCase();
}

function explicitlyRequestsMultipleFormats(text: string): boolean {
  const formatHits = [
    /\bpdf\b/,
    /\bdocx\b/,
    /\bword\b/,
    /\bxlsx\b/,
    /\bexcel\b/,
    /\bpptx\b/,
    /\bpowerpoint\b/,
    /\bslides\b/,
    /\bdeck\b/,
  ].filter((pattern) => pattern.test(text)).length;

  return formatHits >= 2 || /\bboth\b|\ball\s+formats\b|\bmultiple\s+formats\b/.test(text);
}

function buildRunContext(req: AgentRequest): RunContext {
  const text = normalizeTaskText(req);
  const wantsMultipleFormats = explicitlyRequestsMultipleFormats(text);
  const usesDummyData = /\bdummy\b|\bexample\b|\bsample\b|\billustrative\b|\bhypothetical\b/.test(text);

  return {
    deadlineAt: Date.now() + MAX_WALL_MS,
    webSearchEnabled: !usesDummyData,
    maxAttachments: req.channel === 'email' && !wantsMultipleFormats ? 2 : 4,
  };
}

function getRemainingMs(ctx: RunContext): number {
  return ctx.deadlineAt - Date.now();
}

function createDeadlineError(label: string): Error {
  return new Error(`${label}_deadline_exceeded`);
}

function isQuotaError(message: string): boolean {
  return /insufficient_quota|quota|429/.test(message.toLowerCase());
}

function buildFailureReplyHtml(errors: { stage: string; error: string }[]): string {
  const combined = errors.map((e) => `${e.stage}: ${e.error}`).join(' | ').toLowerCase();
  const isTimeout = /idle_timeout|deadline_exceeded|timed out|wall_clock_exceeded/.test(combined);
  const isQuota = isQuotaError(combined);

  if (isQuota) {
    return '<p>Hi,</p><p>I could not finish this request because the primary AI provider account hit its usage limit during processing.</p><p>Please try again shortly, or reply asking for a smaller first pass in one format only.</p>';
  }

  if (isTimeout) {
    return '<p>Hi,</p><p>I started your request, but it exceeded the email agent time budget before I could finish the deliverable.</p><p>Please reply with the first format you want me to produce only (PDF, DOCX, XLSX, or PPTX), and I will generate that first.</p>';
  }

  return '<p>Hi,</p><p>I ran into an issue while preparing your deliverable and could not complete it in this pass.</p><p>Please reply with a narrower first step and I will continue from there.</p>';
}

const SYSTEM_PROMPT = `You are InboxIQ Agent — an executive AI middleware.

ROLE
You receive tasks via email (forwarded by an internal team member) or Microsoft Teams. Your job is to deliver REAL, FINISHED work product, not chat-style answers.

DELIVERABLES OVER PROSE
When the user asks you to "create", "draft", "build", "write", "produce", or "prepare" anything that should naturally be a document — a policy, a report, a contract, a proposal, a brief, a plan, a memo, a checklist, a training outline, a comparison, a budget, a roadmap — you MUST:
  1. Generate the actual document by calling generate_pdf AND generate_docx with the same content (so the recipient gets a polished PDF and an editable Word version).
  2. For data-heavy requests (lists, financials, schedules, comparisons), also call generate_xlsx.
  3. For presentations (decks, executive summaries to walk through), call generate_pptx.
  4. Then write a short HTML email body announcing the deliverable. Do NOT paste the document's contents into the email body.

WHEN TO USE WEB SEARCH
Use the built-in web_search tool whenever the task requires:
  - Current facts (regulations, prices, news, recent product info, statistics)
  - Verifying claims you'd otherwise have to guess at
  - Finding citations for a policy or report
Do NOT search for evergreen knowledge you already know.

QUALITY BAR
- Multi-page documents should actually be multi-page (5+ sections for policies/reports).
- Use clear hierarchy: title, subtitle, headings, well-formed paragraphs.
- Be specific: real numbers, real procedures, real names of standards/frameworks. Avoid filler.
- Match the tone the sender used (executive / technical / operational).

EMAIL BODY FORMAT
Plain HTML (no <html>/<body> wrapper). Short. Use <p>, <ul>, <strong>. Example:
  <p>Hi Alex,</p>
  <p>Attached is the laptop usage policy you requested for a 50-person company. I've included both a PDF (for distribution) and an editable DOCX so HR can adapt it to your specific environment.</p>
  <p>Highlights:</p>
  <ul><li>Acceptable use, security, BYOD covered</li><li>Aligned to NIST CSF and CIS Controls v8</li></ul>
  <p>Let me know if you'd like me to tailor it further.</p>

NEVER auto-send to anyone other than the person who emailed you. NEVER fabricate citations.

When you have completed the task and any attachments are generated, respond with the final email HTML body as plain text (no further tool calls).`;

interface ToolResult {
  call_id: string;
  name: string;
  output: any;
}

// ────────────────────────────────────────────────────────────────────
// OpenAI Responses API path with native web_search + doc tools
// ────────────────────────────────────────────────────────────────────
async function runOpenAI(req: AgentRequest, attachments: GeneratedFile[], trace: AgentResult['trace'], ctx: RunContext, model: string = OPENAI_PRIMARY_MODEL) {
  const tools: any[] = [
    ...(ctx.webSearchEnabled ? [{ type: 'web_search' }] : []), // OpenAI built-in
    ...DOC_TOOLS_OPENAI.map((t) => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  ];

  const userMessage = buildUserMessage(req);

  // The Responses API takes either `input` (string or list of items) and
  // returns `output` (list of items). We thread the conversation by appending
  // assistant items + tool result items each iteration.
  const inputItems: any[] = [
    {
      role: 'user',
      content: [{ type: 'input_text', text: userMessage }],
    },
  ];

  let totalIn = 0;
  let totalOut = 0;
  let usedWebSearch = false;
  let finalText = '';
  let iterations = 0;

  const startedAt = Date.now();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i + 1;
    if (Date.now() - startedAt > MAX_WALL_MS || getRemainingMs(ctx) <= REQUEST_SAFETY_MS) {
      trace.push({ step: i, type: 'wall_clock_exceeded' });
      break;
    }

    const body = {
      model,
      instructions: SYSTEM_PROMPT,
      input: inputItems,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
    };

      const abort = new AbortController();
      const timeoutId = setTimeout(() => abort.abort('deadline'), Math.max(5_000, getRemainingMs(ctx) - REQUEST_SAFETY_MS));
      const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
        signal: abort.signal,
      body: JSON.stringify(body),
    });
      clearTimeout(timeoutId);

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI Responses ${res.status}: ${txt.slice(0, 500)}`);
    }
    const data = await res.json();

    totalIn += data.usage?.input_tokens ?? 0;
    totalOut += data.usage?.output_tokens ?? 0;

    const output: any[] = data.output ?? [];
    const functionCalls: any[] = [];
    let messageText = '';

    for (const item of output) {
      // Pass through assistant-generated items so the next turn has full context
      inputItems.push(item);

      if (item.type === 'web_search_call') {
        usedWebSearch = true;
        trace.push({ step: i, type: 'web_search', detail: item.action?.query || '' });
      } else if (item.type === 'function_call') {
        functionCalls.push(item);
      } else if (item.type === 'message') {
        const parts = item.content ?? [];
        for (const p of parts) {
          if (p.type === 'output_text' && typeof p.text === 'string') {
            messageText += p.text;
          }
        }
      }
    }

    // If model emitted text and made no function calls, we're done.
    if (functionCalls.length === 0) {
      finalText = messageText.trim();
      trace.push({ step: i, type: 'final', detail: `${finalText.length} chars` });
      break;
    }

    // Execute custom function calls (doc generators)
    for (const fc of functionCalls) {
      let parsed: any = {};
      try {
        parsed = typeof fc.arguments === 'string' ? JSON.parse(fc.arguments) : (fc.arguments || {});
      } catch {
        parsed = {};
      }
      trace.push({ step: i, type: 'doc_tool', detail: fc.name });
      const result = await runDocTool(fc.name, parsed);
      let outputForModel: any;
      if (result.ok) {
        if (attachments.length < ctx.maxAttachments) {
          attachments.push(result.file);
        }
        outputForModel = {
          ok: true,
          filename: result.file.filename,
          mime_type: result.file.mime_type,
          byte_size: result.file.byte_size,
          note: 'Attached to outgoing email. Do not regenerate.',
        };
      } else {
        outputForModel = { ok: false, error: result.error };
      }
      inputItems.push({
        type: 'function_call_output',
        call_id: fc.call_id,
        output: JSON.stringify(outputForModel),
      });
    }
  }

  return {
    reply_html: finalText || 'I generated your deliverable but had trouble composing the cover note. The attachment is included.',
    provider: 'openai' as const,
    model,
    iterations,
    used_web_search: usedWebSearch,
    prompt_tokens: totalIn,
    completion_tokens: totalOut,
  };
}

// ────────────────────────────────────────────────────────────────────
// Anthropic Messages API path with native web_search + web_fetch + doc tools
// ────────────────────────────────────────────────────────────────────
function docToolsForAnthropic() {
  return DOC_TOOLS_OPENAI.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

async function runAnthropic(req: AgentRequest, attachments: GeneratedFile[], trace: AgentResult['trace'], ctx: RunContext) {
  const tools: any[] = [
    ...(ctx.webSearchEnabled ? [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2 },
    ] : []),
    ...docToolsForAnthropic(),
  ];

  const userMessage = buildUserMessage(req);
  const messages: any[] = [{ role: 'user', content: userMessage }];

  let totalIn = 0;
  let totalOut = 0;
  let usedWebSearch = false;
  let finalText = '';
  let iterations = 0;

  const startedAt = Date.now();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i + 1;
    if (Date.now() - startedAt > MAX_WALL_MS || getRemainingMs(ctx) <= REQUEST_SAFETY_MS) {
      trace.push({ step: i, type: 'wall_clock_exceeded' });
      break;
    }

    const body = {
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    };

    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort('deadline'), Math.max(5_000, getRemainingMs(ctx) - REQUEST_SAFETY_MS));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-fetch-2025-09-10',
        'Content-Type': 'application/json',
      },
      signal: abort.signal,
      body: JSON.stringify(body),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 500)}`);
    }
    const data = await res.json();
    totalIn += data.usage?.input_tokens ?? 0;
    totalOut += data.usage?.output_tokens ?? 0;

    const blocks: any[] = data.content ?? [];
    messages.push({ role: 'assistant', content: blocks });

    const toolUses: any[] = [];
    let textOut = '';
    for (const b of blocks) {
      if (b.type === 'text') textOut += b.text;
      else if (b.type === 'tool_use') toolUses.push(b);
      else if (b.type === 'server_tool_use') {
        usedWebSearch = true;
        trace.push({ step: i, type: 'native_' + b.name });
      }
    }

    const stopReason = data.stop_reason;
    if (stopReason === 'end_turn' || toolUses.length === 0) {
      finalText = textOut.trim();
      trace.push({ step: i, type: 'final', detail: `${finalText.length} chars` });
      break;
    }

    // Custom doc tools
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      trace.push({ step: i, type: 'doc_tool', detail: tu.name });
      const result = await runDocTool(tu.name, tu.input || {});
      let payload: any;
      if (result.ok) {
        if (attachments.length < ctx.maxAttachments) attachments.push(result.file);
        payload = {
          ok: true,
          filename: result.file.filename,
          mime_type: result.file.mime_type,
          byte_size: result.file.byte_size,
          note: 'Attached to outgoing email. Do not regenerate.',
        };
      } else {
        payload = { ok: false, error: result.error };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(payload),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    reply_html: finalText || 'I generated your deliverable but had trouble composing the cover note. The attachment is included.',
    provider: 'anthropic' as const,
    model: ANTHROPIC_MODEL,
    iterations,
    used_web_search: usedWebSearch,
    prompt_tokens: totalIn,
    completion_tokens: totalOut,
  };
}

function buildUserMessage(req: AgentRequest): string {
  const parts: string[] = [];
  if (req.sender_name || req.sender_email) {
    parts.push(`From: ${req.sender_name ?? ''} <${req.sender_email ?? ''}>`.trim());
  }
  if (req.subject) parts.push(`Subject: ${req.subject}`);
  if (req.thread_context) {
    parts.push('');
    parts.push('--- Prior thread (oldest → newest) ---');
    parts.push(req.thread_context);
    parts.push('--- End thread ---');
  }
  parts.push('');
  parts.push('Latest message / task:');
  parts.push(req.task);
  parts.push('');
  parts.push('Default to the smallest complete deliverable set that satisfies the request. Unless the sender explicitly asks for multiple file formats, create only the primary format needed for the job.');
  parts.push('If dummy/example numbers are requested, do not use web search; generate a polished internal example with clearly synthetic figures.');
  parts.push('Reply with a short HTML cover note announcing what you produced.');
  return parts.join('\n');
}

// ────────────────────────────────────────────────────────────────────
// HTTP entrypoint
// ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Server-to-server auth: require service-role key in Authorization header.
  const auth = req.headers.get('Authorization') || '';
  const expected = `Bearer ${SERVICE_ROLE_KEY}`;
  if (!SERVICE_ROLE_KEY || auth !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!body?.task || typeof body.task !== 'string') {
    return new Response(JSON.stringify({ error: 'task required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const attachments: GeneratedFile[] = [];
  const trace: AgentResult['trace'] = [];
  const startedAt = Date.now();
  const ctx = buildRunContext(body);

  // Chain: gpt-4.1 → gpt-4o → claude-sonnet-4-5
  let result: Awaited<ReturnType<typeof runOpenAI>> | null = null;
  const errors: { stage: string; error: string }[] = [];

  const wantedProvider = body.preferred_provider;

  type Attempt = { name: string; run: () => Promise<any> };
  const attempts: Attempt[] = [];

  if (wantedProvider === 'anthropic') {
    if (ANTHROPIC_API_KEY) attempts.push({ name: 'anthropic:claude-sonnet-4-5', run: () => runAnthropic(body, attachments, trace, ctx) });
    if (OPENAI_API_KEY) {
      attempts.push({ name: `openai:${OPENAI_PRIMARY_MODEL}`, run: () => runOpenAI(body, attachments, trace, ctx, OPENAI_PRIMARY_MODEL) });
      attempts.push({ name: `openai:${OPENAI_FALLBACK_MODEL}`, run: () => runOpenAI(body, attachments, trace, ctx, OPENAI_FALLBACK_MODEL) });
    }
  } else {
    if (OPENAI_API_KEY) {
      attempts.push({ name: `openai:${OPENAI_PRIMARY_MODEL}`, run: () => runOpenAI(body, attachments, trace, ctx, OPENAI_PRIMARY_MODEL) });
      attempts.push({ name: `openai:${OPENAI_FALLBACK_MODEL}`, run: () => runOpenAI(body, attachments, trace, ctx, OPENAI_FALLBACK_MODEL) });
    }
    if (ANTHROPIC_API_KEY) attempts.push({ name: 'anthropic:claude-sonnet-4-5', run: () => runAnthropic(body, attachments, trace, ctx) });
  }

  if (attempts.length === 0) {
    return new Response(JSON.stringify({ error: 'no_providers_configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Pre-flight enforcement (best-effort: only when caller passed user + org context)
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    : null;
  const enforceFeature = body.channel === 'teams' ? 'teams_agent' : 'email_agent';
  let gate: Awaited<ReturnType<typeof enforceLimitsBeforeLLM>> | null = null;
  if (admin && body.user_id && body.organization_id) {
    gate = await enforceLimitsBeforeLLM(admin, {
      userId: body.user_id,
      organizationId: body.organization_id,
      feature: enforceFeature,
    });
    if (!gate.allowed) return blockedResponse(gate.reason || 'blocked', corsHeaders);
  }

  for (const attempt of attempts) {
    try {
      if (getRemainingMs(ctx) <= REQUEST_SAFETY_MS) {
        throw createDeadlineError('request');
      }
      // Reset attachments between attempts so a partial run doesn't pollute the next
      attachments.length = 0;
      trace.push({ step: -1, type: 'attempt', detail: attempt.name });
      result = await attempt.run();
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[agent-loop] ${attempt.name} failed:`, msg);
      errors.push({ stage: attempt.name, error: msg });
      trace.push({ step: -1, type: 'attempt_failed', detail: `${attempt.name}: ${msg.slice(0, 200)}` });
      if (attempt.name.startsWith('openai:') && isQuotaError(msg)) {
        trace.push({ step: -1, type: 'skip_openai_fallback_after_quota' });
        continue;
      }
    }
  }

  if (!result) {
    const out: AgentResult = {
      reply_html: buildFailureReplyHtml(errors),
      attachments: [],
      provider: 'system',
      model: errors[0]?.stage ?? 'system-fallback',
      iterations: 0,
      duration_ms: Date.now() - startedAt,
      prompt_tokens: 0,
      completion_tokens: 0,
      used_web_search: false,
      trace,
    };

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const out: AgentResult = {
    reply_html: result!.reply_html,
    attachments,
    provider: result!.provider,
    model: result!.model,
    iterations: result!.iterations,
    duration_ms: Date.now() - startedAt,
    prompt_tokens: result!.prompt_tokens,
    completion_tokens: result!.completion_tokens,
    used_web_search: result!.used_web_search,
    trace,
  };

  return new Response(JSON.stringify(out), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

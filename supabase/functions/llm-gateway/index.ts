// Unified LLM gateway: routes to OpenAI or Anthropic based on model prefix.
// Logs every call to llm_call_logs with tokens, cost, latency.
// Supports: chat completion, tool/function calling, streaming.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

/* -------- Pricing (USD per 1M tokens) -------- */
const PRICING: Record<string, { in: number; out: number }> = {
  // OpenAI
  'gpt-4o': { in: 2.50, out: 10.00 },
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4-turbo': { in: 10.00, out: 30.00 },
  'gpt-4.1': { in: 2.00, out: 8.00 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 },
  'gpt-5': { in: 2.50, out: 10.00 },
  'gpt-5-mini': { in: 0.25, out: 2.00 },
  'gpt-5-nano': { in: 0.05, out: 0.40 },
  // Anthropic
  'claude-3-5-sonnet-latest': { in: 3.00, out: 15.00 },
  'claude-3-5-sonnet-20241022': { in: 3.00, out: 15.00 },
  'claude-3-5-haiku-latest': { in: 0.80, out: 4.00 },
  'claude-3-7-sonnet-latest': { in: 3.00, out: 15.00 },
  'claude-sonnet-4-5': { in: 3.00, out: 15.00 },
  'claude-opus-4': { in: 15.00, out: 75.00 },
  'claude-haiku-4-5': { in: 1.00, out: 5.00 },
};

function priceFor(model: string): { in: number; out: number } {
  if (PRICING[model]) return PRICING[model];
  // fuzzy fallback by prefix
  for (const k of Object.keys(PRICING)) {
    if (model.startsWith(k) || k.startsWith(model)) return PRICING[k];
  }
  return { in: 0, out: 0 };
}

function detectProvider(model: string): 'openai' | 'anthropic' {
  if (model.startsWith('claude') || model.includes('anthropic/')) return 'anthropic';
  return 'openai';
}

/* -------- OpenAI -------- */
async function callOpenAI(opts: {
  model: string;
  messages: any[];
  tools?: any[];
  tool_choice?: any;
  temperature?: number;
  max_tokens?: number;
  response_format?: any;
}) {
  const body: any = {
    model: opts.model.replace(/^openai\//, ''),
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (opts.tools?.length) {
    body.tools = opts.tools;
    if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  }
  if (opts.response_format) body.response_format = opts.response_format;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || '',
    tool_calls: choice?.message?.tool_calls || null,
    finish_reason: choice?.finish_reason,
    tokens_in: data.usage?.prompt_tokens || 0,
    tokens_out: data.usage?.completion_tokens || 0,
    raw: data,
  };
}

/* -------- Anthropic -------- */
function convertToolsForAnthropic(tools: any[]): any[] {
  return tools.map(t => {
    const fn = t.function || t;
    return {
      name: fn.name,
      description: fn.description,
      input_schema: fn.parameters || fn.input_schema || { type: 'object', properties: {} },
    };
  });
}

function convertMessagesForAnthropic(messages: any[]): { system: string | null; messages: any[] } {
  let system: string | null = null;
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = (system ? system + '\n\n' : '') + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      continue;
    }
    if (m.role === 'tool') {
      // Convert OpenAI tool result -> Anthropic tool_result block
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls) {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input: typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || tc.input || {}),
        });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return { system, messages: out };
}

async function callAnthropic(opts: {
  model: string;
  messages: any[];
  tools?: any[];
  temperature?: number;
  max_tokens?: number;
}) {
  const { system, messages } = convertMessagesForAnthropic(opts.messages);
  const body: any = {
    model: opts.model,
    messages,
    max_tokens: opts.max_tokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
  };
  if (system) body.system = system;
  if (opts.tools?.length) body.tools = convertToolsForAnthropic(opts.tools);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt}`);
  }
  const data = await res.json();

  // Normalize to OpenAI-shaped response
  let content = '';
  const tool_calls: any[] = [];
  for (const block of (data.content || [])) {
    if (block.type === 'text') content += block.text;
    else if (block.type === 'tool_use') {
      tool_calls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }
  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : null,
    finish_reason: data.stop_reason,
    tokens_in: data.usage?.input_tokens || 0,
    tokens_out: data.usage?.output_tokens || 0,
    raw: data,
  };
}

/* -------- Logging -------- */
async function logCall(admin: any, row: any) {
  try {
    await admin.from('llm_call_logs').insert(row);
  } catch (e) {
    console.error('llm_call_logs insert failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const internalUserId = req.headers.get('x-internal-user-id') || '';
    const isInternalServiceCall =
      internalUserId &&
      authHeader.replace(/^Bearer\s+/i, '').trim() === SERVICE_ROLE_KEY;

    let userId: string | null = null;

    if (isInternalServiceCall) {
      userId = internalUserId;
    } else {
      if (!authHeader) {
        console.error('llm-gateway: missing Authorization header');
        return new Response(JSON.stringify({ error: 'Unauthorized', reason: 'missing_auth_header' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
      if (!anonKey) {
        console.error('llm-gateway: SUPABASE_ANON_KEY env var missing');
        return new Response(JSON.stringify({ error: 'Server misconfigured: anon key missing' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const userClient = createClient(SUPABASE_URL, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: getUserErr } = await userClient.auth.getUser();
      if (!user) {
        console.error('llm-gateway: getUser failed', {
          err: getUserErr?.message,
          authPrefix: authHeader.slice(0, 20),
        });
        return new Response(JSON.stringify({ error: 'Unauthorized', reason: getUserErr?.message || 'no_user' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    }

    const {
      model,
      messages,
      tools,
      tool_choice,
      temperature,
      max_tokens,
      response_format,
      purpose,
      conversation_id,
      connection_id,
    } = await req.json();

    if (!model || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'model and messages are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve org
    const { data: profile } = await admin
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', userId)
      .maybeSingle();
    const organization_id = profile?.organization_id || null;

    const provider = detectProvider(model);

    let result: any;
    let errorMsg: string | null = null;
    try {
      if (provider === 'anthropic') {
        result = await callAnthropic({ model, messages, tools, temperature, max_tokens });
      } else {
        result = await callOpenAI({ model, messages, tools, tool_choice, temperature, max_tokens, response_format });
      }
    } catch (err: any) {
      errorMsg = err.message;
      const latency_ms = Date.now() - startedAt;
      await logCall(admin, {
        user_id: userId,
        organization_id,
        connection_id: connection_id || null,
        conversation_id: conversation_id || null,
        provider,
        model,
        purpose: purpose || 'agent',
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        latency_ms,
        error: errorMsg,
      });
      throw err;
    }

    const latency_ms = Date.now() - startedAt;
    const px = priceFor(model);
    const cost_usd = (result.tokens_in * px.in + result.tokens_out * px.out) / 1_000_000;

    await logCall(admin, {
      user_id: userId,
      organization_id,
      connection_id: connection_id || null,
      conversation_id: conversation_id || null,
      provider,
      model,
      purpose: purpose || 'agent',
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      cost_usd: Number(cost_usd.toFixed(6)),
      latency_ms,
      error: null,
    });

    return new Response(JSON.stringify({
      content: result.content,
      tool_calls: result.tool_calls,
      finish_reason: result.finish_reason,
      provider,
      model,
      usage: {
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        cost_usd: Number(cost_usd.toFixed(6)),
        latency_ms,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('llm-gateway error', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

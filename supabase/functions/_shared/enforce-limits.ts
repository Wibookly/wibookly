// Shared LLM enforcement helper.
// Wires runtime cost/limit/model-routing checks against the database RPCs
// `enforce_llm_limits` (pre-call) and `record_llm_spend` (post-call).
// deno-lint-ignore-file no-explicit-any

export const FEATURE_TOKENS: Record<string, { in: number; out: number }> = {
  ai_chat:            { in: 4000,  out: 800  },
  ai_draft:           { in: 2000,  out: 400  },
  ai_auto_reply:      { in: 3000,  out: 500  },
  daily_brief:        { in: 8000,  out: 1500 },
  activity_reports:   { in: 15000, out: 3000 },
  email_agent:        { in: 10000, out: 1500 },
  teams_agent:        { in: 10000, out: 1500 },
  follow_up_reminder: { in: 5000,  out: 500  },
  documents:          { in: 12000, out: 8000 },
  powerpoints:        { in: 8000,  out: 5000 },
  excel:              { in: 8000,  out: 3000 },
  file_reading:       { in: 10000, out: 800  },
};

// USD per 1M tokens
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'phi-4':             { input: 0.30, output: 0.60 },
  'gpt-4.1-mini':      { input: 0.40, output: 1.60 },
  'gpt-4.1':           { input: 2.00, output: 8.00 },
  'gpt-4o':            { input: 2.50, output: 10.00 },
  'gpt-4o-mini':       { input: 0.15, output: 0.60 },
  'gpt-5':             { input: 2.50, output: 10.00 },
  'gpt-5-mini':        { input: 0.25, output: 2.00 },
  'gpt-5-nano':        { input: 0.05, output: 0.40 },
  'llama-3.3-70b':     { input: 1.50, output: 2.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-latest': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-latest':  { input: 0.80, output: 4.00 },
  'claude-haiku-4-5':  { input: 1.00, output: 5.00 },
  'claude-opus-4':     { input: 15.00, output: 75.00 },
};

// Default model per feature when group_features.model_assignment is NULL.
// Tuned for cost vs quality per feature class.
export const FEATURE_DEFAULT_MODEL: Record<string, string> = {
  ai_chat:            'gpt-4.1-mini',
  ai_draft:           'phi-4',
  ai_auto_reply:      'gpt-4.1-mini',
  daily_brief:        'phi-4',
  activity_reports:   'gpt-4.1-mini',
  email_agent:        'gpt-4.1',
  teams_agent:        'gpt-4.1',
  follow_up_reminder: 'phi-4',
  documents:          'llama-3.3-70b',
  powerpoints:        'llama-3.3-70b',
  excel:              'gpt-4.1-mini',
  file_reading:       'gpt-4.1-mini',
};

export function resolveModel(feature: string, modelAssignment: string | null | undefined): string {
  if (modelAssignment) return modelAssignment;
  return FEATURE_DEFAULT_MODEL[feature] || 'gpt-4.1-mini';
}

function priceFor(model: string): { input: number; output: number } {
  if (MODEL_COSTS[model]) return MODEL_COSTS[model];
  for (const k of Object.keys(MODEL_COSTS)) {
    if (model.startsWith(k) || k.startsWith(model)) return MODEL_COSTS[k];
  }
  return { input: 0, output: 0 };
}

export function estimateCost(feature: string, model: string): number {
  const t = FEATURE_TOKENS[feature];
  const r = priceFor(model);
  if (!t) return 0;
  return (t.in * r.input + t.out * r.output) / 1_000_000;
}

export function actualCost(model: string, tokens_in: number, tokens_out: number): number {
  const r = priceFor(model);
  return (tokens_in * r.input + tokens_out * r.output) / 1_000_000;
}

export function detectProvider(model: string): 'openai' | 'anthropic' {
  if (model.startsWith('claude') || model.includes('anthropic/')) return 'anthropic';
  return 'openai';
}

export interface EnforceResult {
  allowed: boolean;
  reason: string | null;
  model: string | null;
  group_id: string | null;
  feature_enabled: boolean;
  daily_count_remaining: number;
  user_daily_remaining: number;
  user_monthly_remaining: number;
  org_daily_remaining: number;
}

/**
 * Pre-flight enforcement. Pass an admin (service-role) Supabase client.
 * Returns { allowed, model } — caller MUST use the returned model when allowed.
 */
export async function enforceLimitsBeforeLLM(
  admin: any,
  args: {
    userId: string;
    organizationId: string;
    feature: string;            // e.g. 'ai_chat'
    fallbackModel?: string;     // override default; otherwise FEATURE_DEFAULT_MODEL[feature]
  }
): Promise<EnforceResult> {
  const fallbackModel = args.fallbackModel || FEATURE_DEFAULT_MODEL[args.feature] || 'gpt-4.1-mini';
  const est = estimateCost(args.feature, fallbackModel);
  const { data, error } = await admin.rpc('enforce_llm_limits', {
    _user_id: args.userId,
    _organization_id: args.organizationId,
    _feature_key: args.feature,
    _est_cost_usd: est,
    _fallback_model: fallbackModel,
  });
  if (error) {
    console.error('[enforce-limits] rpc error', error);
    // Fail closed
    return {
      allowed: false, reason: 'enforcement_rpc_error', model: fallbackModel,
      group_id: null, feature_enabled: false,
      daily_count_remaining: 0, user_daily_remaining: 0, user_monthly_remaining: 0, org_daily_remaining: 0,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    reason: row?.reason ?? null,
    model: resolveModel(args.feature, row?.model),
    group_id: row?.group_id ?? null,
    feature_enabled: !!row?.feature_enabled,
    daily_count_remaining: Number(row?.daily_count_remaining ?? 0),
    user_daily_remaining: Number(row?.user_daily_remaining ?? 0),
    user_monthly_remaining: Number(row?.user_monthly_remaining ?? 0),
    org_daily_remaining: Number(row?.org_daily_remaining ?? 0),
  };
}

/**
 * Post-call accounting. Logs the call and increments user + org spend.
 */
export async function recordSpend(
  admin: any,
  args: {
    userId: string;
    organizationId: string;
    groupId: string | null;
    feature: string;
    provider: 'openai' | 'anthropic' | 'lovable_ai' | 'google';
    model: string;
    tokensIn: number;
    tokensOut: number;
    metadata?: Record<string, unknown>;
  }
): Promise<{ cost_usd: number }> {
  const cost = actualCost(args.model, args.tokensIn, args.tokensOut);
  const { error } = await admin.rpc('record_llm_spend', {
    _user_id: args.userId,
    _organization_id: args.organizationId,
    _group_id: args.groupId,
    _feature_key: args.feature,
    _provider: args.provider,
    _model: args.model,
    _tokens_in: args.tokensIn,
    _tokens_out: args.tokensOut,
    _cost_usd: Number(cost.toFixed(6)),
    _metadata: args.metadata ?? {},
  });
  if (error) console.error('[enforce-limits] record_llm_spend error', error);
  return { cost_usd: Number(cost.toFixed(6)) };
}

/**
 * Helper: build a standard 403 Response when blocked.
 */
export function blockedResponse(reason: string, corsHeaders: Record<string, string>) {
  const messages: Record<string, string> = {
    feature_disabled: 'This AI feature is not enabled for your tier.',
    daily_count_exceeded: 'Daily AI usage limit reached for this feature.',
    per_request_cap_exceeded: 'Request exceeds the per-request cost limit.',
    user_daily_cap_exceeded: 'Your daily AI budget is exhausted.',
    user_monthly_cap_exceeded: 'Your monthly AI budget is exhausted.',
    org_daily_cap_exceeded: 'Your organization\'s daily AI budget is exhausted.',
    org_monthly_cap_exceeded: 'Your organization\'s monthly AI budget is exhausted.',
    org_paused: 'AI usage is paused by your administrator.',
    enforcement_rpc_error: 'Unable to verify AI usage budget. Try again shortly.',
  };
  return new Response(
    JSON.stringify({ error: messages[reason] || 'AI usage blocked', reason, blocked: true }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

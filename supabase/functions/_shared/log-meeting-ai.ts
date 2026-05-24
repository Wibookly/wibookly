// Lightweight AI usage logger for Meeting Copilot edge functions.
// Writes to ai_usage_logs so the admin "AI Usage" tab includes Meeting Copilot
// calls alongside other AI surfaces. Costs default to 0 because Meeting Copilot
// uses the Lovable AI gateway (free tier during preview) — they will be
// repriced centrally if the gateway later returns dollar amounts.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export type MeetingAiAction =
  | 'meeting_copilot_prep'
  | 'meeting_copilot_suggestion'
  | 'meeting_copilot_summary';

export async function logMeetingAI(args: {
  userId: string;
  action: MeetingAiAction;
  model: string;
  usage?: any;
  metadata?: Record<string, unknown>;
  latencyMs?: number;
  status?: 'success' | 'error';
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: prof } = await admin
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', args.userId)
      .maybeSingle();
    const organization_id = (prof as any)?.organization_id as string | undefined;
    if (!organization_id) return;

    const u = args.usage || {};
    const prompt_tokens = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
    const completion_tokens = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;

    await admin.from('ai_usage_logs').insert({
      organization_id,
      user_id: args.userId,
      provider: 'lovable_ai',
      model: args.model,
      action: args.action,
      prompt_tokens,
      completion_tokens,
      cost_usd: 0,
      status: args.status ?? 'success',
      error_message: args.errorMessage ?? null,
      latency_ms: args.latencyMs ?? null,
      metadata: args.metadata ?? {},
    });
  } catch (e) {
    console.error('[logMeetingAI] failed to log usage', e);
  }
}

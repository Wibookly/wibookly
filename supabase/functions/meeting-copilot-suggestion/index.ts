// Generates real-time AI suggestions during a meeting based on the rolling transcript.
// Called by the Chrome extension overlay every ~10-15 seconds.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const sessionId: string = body.sessionId;
    const recentTranscript: string = (body.recentTranscript || '').slice(0, 8000);
    const intent = (body.intent || '').toString().trim().toLowerCase();

    if (!sessionId || !recentTranscript.trim()) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [{ data: profile }, { data: aiProfile }, { data: session }, { data: settings }] = await Promise.all([
      sb.from('user_profiles')
        .select('full_name, title, company, department, role_description, responsibilities, communication_style')
        .eq('user_id', user.id).maybeSingle(),
      sb.from('user_ai_profiles').select('custom_context').eq('user_id', user.id).maybeSingle(),
      sb.from('meeting_sessions').select('meeting_title').eq('id', sessionId).maybeSingle(),
      sb.from('meeting_copilot_settings').select('suggestion_style').eq('user_id', user.id).maybeSingle(),
    ]);

    const style = settings?.suggestion_style || 'concise';
    const styleGuide: Record<string, string> = {
      concise: 'Short bullet points, max 1-2 sentences each.',
      conversational: 'Full sentences the user can say verbatim.',
      strategic: 'Surface angles, risks, opportunities, and second-order effects.',
    };

    // Build identity block from the centralized user_profiles row.
    const p = (profile || {}) as Record<string, string | null>;
    const identityLines: string[] = [];
    if (p.full_name) identityLines.push(`Name: ${p.full_name}`);
    if (p.title) identityLines.push(`Title: ${p.title}`);
    if (p.company) identityLines.push(`Company: ${p.company}`);
    if (p.department) identityLines.push(`Department: ${p.department}`);
    if (p.role_description) identityLines.push(`Role: ${p.role_description}`);
    if (p.responsibilities) identityLines.push(`Responsibilities: ${p.responsibilities}`);
    if (p.communication_style) identityLines.push(`Communication style: ${p.communication_style}`);
    const identityBlock = identityLines.length ? identityLines.join('\n') : 'A professional in a business meeting.';
    const extraCtx = (aiProfile?.custom_context as string | undefined)?.trim();

    const intentGuidance = intent === 'answer'
      ? 'Prioritize direct, confident answers the user can say immediately if they were just asked something important. Return at least one suggestion of type "answer" when possible.'
      : intent === 'ask'
        ? 'Prioritize sharp follow-up questions that help the user advance the conversation. Return at least one suggestion of type "ask" when possible.'
        : intent === 'say'
          ? 'Prioritize the strongest next statement the user should say to move the meeting forward. Return at least one suggestion of type "say" when possible.'
          : 'Balance the output between what to say, what to ask, and what to answer next.';

    const systemPrompt = `You are a real-time silent meeting copilot for the following user:
${identityBlock}
${extraCtx ? `\nExtra meeting-specific context:\n${extraCtx}\n` : ''}
You are listening to their meeting: "${session?.meeting_title || 'a meeting'}".
Generate 1-3 helpful suggestions based on the most recent conversation.

Each suggestion has a type:
- "say": something the user should say next
- "ask": a smart follow-up question they should ask
- "fact": a relevant fact they should keep in mind
- "answer": if someone asked them a question, what they should answer

Style: ${styleGuide[style]}
Focus: ${intentGuidance}

Output JSON only: { "suggestions": [{ "type": "say|ask|fact|answer", "content": "..." }] }`;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'ai_unavailable' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Recent meeting transcript:\n\n${recentTranscript}\n\nReturn JSON with suggestions.` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.6,
        max_tokens: 500,
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!aiRes.ok) {
      return new Response(JSON.stringify({ error: 'ai_error', suggestions: [] }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiRes.json();
    let suggestions: any[] = [];
    try {
      const parsed = JSON.parse(aiData.choices[0].message.content);
      suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    } catch { /* ignore */ }

    if (suggestions.length) {
      const rows = suggestions.map((s) => ({
          session_id: sessionId,
          user_id: user.id,
          suggestion_type: s.type,
          content: String(s.content || '').slice(0, 2000),
        }));

      const { data: inserted } = await sb
        .from('meeting_suggestions')
        .insert(rows)
        .select('id, suggestion_type, content');

      const persisted = inserted?.map((row) => ({
        id: row.id,
        type: row.suggestion_type,
        content: row.content,
      })) ?? [];

      return new Response(JSON.stringify({ suggestions: persisted.length ? persisted : suggestions }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown', suggestions: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

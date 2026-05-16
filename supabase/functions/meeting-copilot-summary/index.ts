// Generates a post-meeting summary, key decisions, action items, and a draft follow-up email.
// Saves action items to meeting_action_items and marks the session as completed.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getValidAccessToken } from '../_shared/oauth-tokens.ts';

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
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { sessionId, createDraft = false } = await req.json().catch(() => ({}));
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'missing_session' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: session } = await sb.from('meeting_sessions').select('*').eq('id', sessionId).maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ error: 'session_not_found' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: transcripts } = await sb
      .from('meeting_transcripts')
      .select('speaker, text')
      .eq('session_id', sessionId)
      .order('spoken_at');

    const fullText = (transcripts || []).map((t: any) => `${t.speaker || 'Speaker'}: ${t.text}`).join('\n').slice(0, 30000);
    if (!fullText.trim()) {
      return new Response(JSON.stringify({ error: 'no_transcript' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'ai_unavailable' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Load the user's Settings profile so the summary + follow-up email
    // are written in their voice (name, title, company, role, responsibilities,
    // and communication style).
    const { data: profile } = await sb
      .from('user_profiles')
      .select('full_name, title, company, department, role_description, responsibilities, communication_style')
      .eq('user_id', user.id)
      .maybeSingle();
    const p = (profile || {}) as Record<string, string | null>;
    const aboutLines: string[] = [];
    if (p.full_name) aboutLines.push(`Name: ${p.full_name}`);
    if (p.title) aboutLines.push(`Title: ${p.title}`);
    if (p.company) aboutLines.push(`Company: ${p.company}`);
    if (p.department) aboutLines.push(`Department: ${p.department}`);
    if (p.role_description) aboutLines.push(`Role: ${p.role_description}`);
    if (p.responsibilities) aboutLines.push(`Responsibilities: ${p.responsibilities}`);
    if (p.communication_style) aboutLines.push(`Preferred communication style: ${p.communication_style}`);
    const aboutBlock = aboutLines.length
      ? `ABOUT ME (write the follow-up email in this person's voice — match their role, seniority, and communication style):\n${aboutLines.join('\n')}\n\n`
      : '';

    const prompt = `${aboutBlock}Analyze this meeting transcript and output JSON ONLY with this exact shape:
{
  "summary": "2-3 sentence overall summary",
  "key_decisions": ["..."],
  "action_items": [{ "description": "...", "assigned_to": "name or null", "due_date": "YYYY-MM-DD or null" }],
  "followup_email": { "subject": "...", "body_html": "<p>...</p>" }
}

The followup_email must be written from ${p.full_name || 'the user'}'s perspective and match the ABOUT ME profile above. Do not include a signature block — one is added separately.

Meeting title: ${session.meeting_title}
Transcript:
${fullText}`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You are a precise meeting summarizer. Output valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (aiRes.status === 429) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (aiRes.status === 402) return new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!aiRes.ok) return new Response(JSON.stringify({ error: 'ai_error' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const aiData = await aiRes.json();
    let parsed: any = {};
    try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { /* */ }

    const actionItems = Array.isArray(parsed.action_items) ? parsed.action_items : [];
    if (actionItems.length) {
      await sb.from('meeting_action_items').insert(
        actionItems.map((a: any) => ({
          session_id: sessionId,
          user_id: user.id,
          description: String(a.description || '').slice(0, 2000),
          assigned_to: a.assigned_to || null,
          due_date: a.due_date && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null,
        }))
      );
    }

    await sb.from('meeting_sessions').update({
      status: 'completed',
      ended_at: session.ended_at || new Date().toISOString(),
    }).eq('id', sessionId);

    // Optionally create an Outlook draft (review before sending — never auto-send)
    let draftCreated = false;
    if (createDraft && parsed.followup_email && Array.isArray(session.attendees) && session.attendees.length) {
      const token = await getValidAccessToken(user.id, 'outlook');
      if (token) {
        const draftRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: parsed.followup_email.subject || `Follow-up: ${session.meeting_title}`,
            body: { contentType: 'HTML', content: parsed.followup_email.body_html || '' },
            toRecipients: session.attendees.map((email: string) => ({ emailAddress: { address: email } })),
          }),
        });
        draftCreated = draftRes.ok;
      }
    }

    return new Response(JSON.stringify({ ...parsed, draftCreated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

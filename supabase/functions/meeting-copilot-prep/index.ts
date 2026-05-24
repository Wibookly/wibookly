// Generates a pre-meeting prep brief: context summary, questions to ask, likely
// questions you'll be asked + suggested answers, talking points.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getValidAccessToken } from '../_shared/oauth-tokens.ts';
import { logMeetingAI } from '../_shared/log-meeting-ai.ts';

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

    const { meetingId } = await req.json().catch(() => ({}));
    if (!meetingId) {
      return new Response(JSON.stringify({ error: 'missing_meeting_id' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const token = await getValidAccessToken(user.id, 'outlook');
    if (!token) {
      return new Response(JSON.stringify({ error: 'no_outlook_connection' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const evRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(meetingId)}?$select=id,subject,start,end,attendees,body,bodyPreview,location,onlineMeeting,hasAttachments`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!evRes.ok) {
      return new Response(JSON.stringify({ error: 'graph_error', detail: (await evRes.text()).slice(0, 300) }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const event = await evRes.json();

    let attachmentNames: string[] = [];
    if (event.hasAttachments) {
      try {
        const attRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(meetingId)}/attachments?$select=name,contentType,size`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (attRes.ok) {
          const att = await attRes.json();
          attachmentNames = (att.value || []).map((a: any) => a.name).filter(Boolean);
        }
      } catch { /* ignore */ }
    }

    const attendees: string[] = (event.attendees || [])
      .map((a: any) => a.emailAddress?.address)
      .filter(Boolean);

    let priorEmailSnippets: string[] = [];
    if (attendees.length) {
      try {
        const orFilter = attendees.slice(0, 4).map((e) => `from/emailAddress/address eq '${e.replace(/'/g, "''")}'`).join(' or ');
        const mailRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(orFilter)}&$select=subject,bodyPreview,from,receivedDateTime&$orderby=receivedDateTime desc&$top=10`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (mailRes.ok) {
          const md = await mailRes.json();
          priorEmailSnippets = (md.value || []).map((m: any) =>
            `From ${m.from?.emailAddress?.address || '?'} — ${m.subject || '(no subject)'}\n${(m.bodyPreview || '').slice(0, 400)}`
          );
        }
      } catch { /* ignore */ }
    }

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
    if (p.role_description) aboutLines.push(`Role: ${p.role_description}`);
    if (p.responsibilities) aboutLines.push(`Responsibilities: ${p.responsibilities}`);
    if (p.communication_style) aboutLines.push(`Style: ${p.communication_style}`);

    const bodyText = (event.body?.content || event.bodyPreview || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'ai_unavailable' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const prompt = `You are preparing ${p.full_name || 'the user'} for an upcoming meeting.
${aboutLines.length ? `\nABOUT THE USER:\n${aboutLines.join('\n')}\n` : ''}
MEETING
Title: ${event.subject || '(no title)'}
When: ${event.start?.dateTime || ''} → ${event.end?.dateTime || ''}
Attendees: ${attendees.join(', ') || 'unknown'}
Location: ${event.location?.displayName || (event.onlineMeeting ? 'Online' : 'n/a')}
Attachments: ${attachmentNames.join(', ') || 'none'}

MEETING DESCRIPTION:
${bodyText || '(empty)'}

RECENT EMAILS FROM ATTENDEES:
${priorEmailSnippets.slice(0, 6).join('\n---\n') || '(none)'}

Output strict JSON ONLY:
{
  "context": "1-2 sentence overall context summary",
  "objectives": ["..."],
  "questions_to_ask": ["..."],
  "likely_questions": [ { "question": "...", "suggested_answer": "..." } ],
  "talking_points": ["..."],
  "risks": ["..."]
}`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You prepare executives for meetings. Be specific, grounded in provided context, never invent facts. Output valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 1800,
      }),
    });

    if (aiRes.status === 429) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (aiRes.status === 402) return new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!aiRes.ok) return new Response(JSON.stringify({ error: 'ai_error' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const aiData = await aiRes.json();
    let parsed: any = {};
    try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { /* */ }

    return new Response(JSON.stringify({
      meeting: {
        id: event.id,
        title: event.subject,
        start: event.start?.dateTime,
        end: event.end?.dateTime,
        attendees,
        joinUrl: event.onlineMeeting?.joinUrl || null,
        location: event.location?.displayName || null,
        attachmentNames,
      },
      prep: parsed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

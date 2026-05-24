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
    const { data: settings } = await sb
      .from('meeting_copilot_settings')
      .select('auto_draft_followup')
      .eq('user_id', user.id)
      .maybeSingle();
    const { data: transcripts } = await sb
      .from('meeting_transcripts')
      .select('speaker, text, spoken_at')
      .eq('session_id', sessionId)
      .order('spoken_at');

    const groupedTranscript = (transcripts || []).reduce((acc: Array<{ speaker: string; text: string; spoken_at: string | null }>, row: any) => {
      const speaker = String(row.speaker || 'Speaker').trim() || 'Speaker';
      const text = String(row.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return acc;
      const last = acc[acc.length - 1];
      if (last && last.speaker === speaker) {
        last.text = `${last.text} ${text}`.replace(/\s+/g, ' ').trim();
        last.spoken_at = row.spoken_at || last.spoken_at;
      } else {
        acc.push({ speaker, text, spoken_at: row.spoken_at || null });
      }
      return acc;
    }, []);

    const attendeeList = Array.isArray(session.attendees)
      ? session.attendees.map((entry: unknown) => String(entry)).filter(Boolean)
      : [];
    const fullText = groupedTranscript.map((t) => `${t.speaker}: ${t.text}`).join('\n').slice(0, 30000);

    // Decide whether there is enough substance to summarize. Empty / trivial
    // sessions (e.g. test runs with one word) must NOT trigger AI hallucination
    // that invents content from the user's profile.
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const hasSubstance = groupedTranscript.length >= 2 && wordCount >= 20;

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

    let parsed: any = {};

    if (!hasSubstance) {
      // No real conversation captured — DO NOT invent content from the user's
      // profile. Return an honest empty recap.
      const segCount = groupedTranscript.length;
      parsed = {
        summary: segCount === 0
          ? 'No conversation was captured during this session. There is nothing to summarize.'
          : `Only ${segCount} short transcript ${segCount === 1 ? 'fragment was' : 'fragments were'} captured (~${wordCount} words). There is not enough substance to generate a meaningful summary.`,
        key_decisions: [],
        action_items: [],
        followup_email: null,
      };
    } else {
      const prompt = `${aboutBlock}Analyze this meeting transcript and output JSON ONLY with this exact shape:
{
  "summary": "Executive summary in 2 short paragraphs with clear spacing between paragraphs",
  "key_decisions": ["at least 3 detailed bullets when possible"],
  "action_items": [{ "description": "specific action with enough context", "assigned_to": "name or null", "due_date": "YYYY-MM-DD or null" }],
  "followup_email": { "subject": "...", "body_html": "<div>...</div>", "body_text": "plain text version" }
}

STRICT RULES:
- Use ONLY information that is explicitly present in the transcript below. Do NOT invent topics, decisions, action items, or names that are not in the transcript.
- If the transcript does not contain enough information for a field, return an empty string or empty array for that field. NEVER fabricate content.
- Do NOT use the ABOUT ME profile to generate topics or decisions — it only describes the writing voice for the follow-up email.
- The followup_email must be written from ${p.full_name || 'the user'}'s perspective and match the ABOUT ME profile above. Do not include a signature block — one is added separately.
- The email must include these sections in this order with professional spacing: Executive Summary, Key Decisions, Action Items, Next Steps.
- Use semantic HTML with paragraphs, headings, unordered lists, and list items.
- Action items must be concrete and grounded in the transcript.
- Preserve participant names exactly as they appear in the transcript.

Meeting title: ${session.meeting_title}
Attendees: ${attendeeList.length ? attendeeList.join(', ') : 'Unknown'}
Transcript:
${fullText}`;

      const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: 'You are a precise meeting summarizer. Only use information explicitly in the transcript. Never invent content. Output valid JSON only.' },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 2000,
        }),
      });

      if (aiRes.status === 429) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiRes.status === 402) return new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (!aiRes.ok) return new Response(JSON.stringify({ error: 'ai_error' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const aiData = await aiRes.json();
      try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { /* */ }
    }

    await sb.from('meeting_action_items').delete().eq('session_id', sessionId);

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

    const followupHtml = typeof parsed.followup_email?.body_html === 'string'
      ? parsed.followup_email.body_html
      : typeof parsed.followup_email?.body_text === 'string'
        ? parsed.followup_email.body_text.split(/\n{2,}/).map((block: string) => `<p>${block.replace(/\n/g, '<br />')}</p>`).join('')
        : null;

    await sb.from('meeting_sessions').update({
      status: 'completed',
      ended_at: session.ended_at || new Date().toISOString(),
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      key_decisions: Array.isArray(parsed.key_decisions) ? parsed.key_decisions : [],
      followup_subject: parsed.followup_email?.subject || null,
      followup_body_html: followupHtml,
      summary_generated_at: new Date().toISOString(),
    }).eq('id', sessionId);

    // Optionally create an Outlook draft (review before sending — never auto-send)
    let draftCreated = false;
    if ((createDraft || settings?.auto_draft_followup) && parsed.followup_email) {
      const token = await getValidAccessToken(user.id, 'outlook');
      if (token) {
        const draftRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: parsed.followup_email.subject || `Follow-up: ${session.meeting_title}`,
            body: { contentType: 'HTML', content: followupHtml || '' },
            toRecipients: [{ emailAddress: { address: user.email || '' } }].filter((recipient) => recipient.emailAddress.address),
          }),
        });
        draftCreated = draftRes.ok;
      }
    }

    // Auto-send the FULL recap (summary + decisions + actions + transcript) to the user's own inbox,
    // with the full transcript attached as an .html document so they have a permanent copy.
    let recapEmailStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
    let recapEmailSentAt: string | null = null;
    if (user.email) {
      try {
        const token = await getValidAccessToken(user.id, 'outlook');
        if (token) {
          const actionItemsHtml = actionItems.length
            ? `<ul>${actionItems.map((a: any) => {
                const desc = String(a.description || '').replace(/[<>]/g, '');
                const who = a.assigned_to ? ` <em>— ${String(a.assigned_to).replace(/[<>]/g, '')}</em>` : '';
                const due = a.due_date ? ` <strong>(due ${a.due_date})</strong>` : '';
                return `<li>${desc}${who}${due}</li>`;
              }).join('')}</ul>`
            : '<p style="color:#666">No action items captured.</p>';
          const decisionsHtml = (Array.isArray(parsed.key_decisions) && parsed.key_decisions.length)
            ? `<ul>${parsed.key_decisions.map((d: string) => `<li>${String(d).replace(/[<>]/g, '')}</li>`).join('')}</ul>`
            : '<p style="color:#666">No key decisions captured.</p>';
          const summaryHtml = typeof parsed.summary === 'string'
            ? parsed.summary.split(/\n{2,}/).map((p) => `<p>${p.replace(/[<>]/g, '').replace(/\n/g, '<br/>')}</p>`).join('')
            : '<p style="color:#666">No summary generated.</p>';
          const meetingDate = new Date(session.started_at || Date.now()).toLocaleString();
          const recapHtml = `
            <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;color:#111">
              <h1 style="font-size:22px;margin:0 0 4px">${String(session.meeting_title).replace(/[<>]/g, '')}</h1>
              <p style="color:#666;margin:0 0 24px;font-size:13px">Meeting recap · ${meetingDate}</p>
              <h2 style="font-size:16px;border-bottom:1px solid #eee;padding-bottom:6px">Executive Summary</h2>
              ${summaryHtml}
              <h2 style="font-size:16px;border-bottom:1px solid #eee;padding-bottom:6px;margin-top:24px">Key Decisions</h2>
              ${decisionsHtml}
              <h2 style="font-size:16px;border-bottom:1px solid #eee;padding-bottom:6px;margin-top:24px">Action Items</h2>
              ${actionItemsHtml}
              <h2 style="font-size:16px;border-bottom:1px solid #eee;padding-bottom:6px;margin-top:24px">Suggested Follow-up Email</h2>
              ${followupHtml || '<p style="color:#666">No follow-up draft generated.</p>'}
              <p style="color:#999;font-size:12px;margin-top:32px">Full transcript is attached as an HTML document.</p>
            </div>
          `;

          // Build transcript attachment
          const transcriptDoc = `<!doctype html><html><head><meta charset="utf-8"><title>Transcript — ${String(session.meeting_title).replace(/[<>]/g, '')}</title>
            <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:780px;margin:24px auto;color:#111;padding:0 16px}
            .line{margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#f6f7f9}
            .who{font-weight:600;color:#5b21b6;font-size:12px;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em}
            .txt{font-size:14px;line-height:1.5}</style></head><body>
            <h1>${String(session.meeting_title).replace(/[<>]/g, '')}</h1>
            <p style="color:#666">${meetingDate} · ${groupedTranscript.length} segments</p>
            ${groupedTranscript.map((t) => `<div class="line"><div class="who">${String(t.speaker).replace(/[<>]/g, '')}</div><div class="txt">${String(t.text).replace(/[<>]/g, '')}</div></div>`).join('')}
            </body></html>`;
          const contentBytes = btoa(unescape(encodeURIComponent(transcriptDoc)));
          const safeName = String(session.meeting_title || 'meeting').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60);

          const sendRes = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                subject: `📝 Meeting recap: ${session.meeting_title}`,
                body: { contentType: 'HTML', content: recapHtml },
                toRecipients: [{ emailAddress: { address: user.email } }],
                attachments: [{
                  '@odata.type': '#microsoft.graph.fileAttachment',
                  name: `transcript-${safeName}.html`,
                  contentType: 'text/html',
                  contentBytes,
                }],
              },
              saveToSentItems: true,
            }),
          });
          if (sendRes.ok) {
            recapEmailStatus = 'sent';
            recapEmailSentAt = new Date().toISOString();
          } else {
            recapEmailStatus = 'failed';
            console.error('recap send failed', sendRes.status, await sendRes.text().catch(() => ''));
          }
        } else {
          recapEmailStatus = 'failed';
        }
      } catch (e) {
        console.error('recap email error', e);
        recapEmailStatus = 'failed';
      }
    }

    await sb.from('meeting_sessions').update({
      recap_email_status: recapEmailStatus,
      recap_email_sent_at: recapEmailSentAt,
    }).eq('id', sessionId);

    return new Response(JSON.stringify({ ...parsed, draftCreated, recapEmailStatus, recapEmailSentAt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// flag-followup-cron: every 15 min, scan tracked_emails where follow_up_at <= now()
// and status='pending'. Check for replies / auto-replies / flag completion, then
// draft a polite follow-up as a Graph reply DRAFT (never auto-send). Max 2 attempts.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGraph } from '../_shared/graph-call.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const FOLLOWUP_GAP_DAYS = Number(Deno.env.get('FOLLOWUP_GAP_DAYS') || '3');
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const AUTO_REPLY_SUBJECT_RE = /^(automatic reply|out of office|auto-?reply)/i;

function isAutoReply(headers: Record<string, string> | undefined, subject: string | undefined): boolean {
  if (subject && AUTO_REPLY_SUBJECT_RE.test(subject)) return true;
  if (!headers) return false;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  if (lower['auto-submitted'] && lower['auto-submitted'].toLowerCase().includes('auto-replied')) return true;
  if (lower['x-auto-response-suppress']) return true;
  return false;
}

function parseGraphInternetHeaders(arr: any[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of (arr || [])) if (h?.name) out[String(h.name)] = String(h.value || '');
  return out;
}

async function draftFollowupBody(opts: {
  subject: string; bodyPreview: string; recipientName: string | null; attempt: number;
}): Promise<string> {
  if (!LOVABLE_API_KEY) {
    return `<p>Hi${opts.recipientName ? ' ' + opts.recipientName.split(' ')[0] : ''},</p>
<p>Following up on my note about "${opts.subject}". I know you're busy — let me know whenever's convenient.</p>
<p>Thanks!</p>`;
  }
  const system = `You are writing a short, polite follow-up email because the recipient has not yet replied to a previous message. Write 3-6 sentences. Be warm and respectful, acknowledge they're busy, restate the original ask or topic in one line, and gently invite a reply or next step. No guilt, no pressure, no "just circling back" clichés. Match the original email's formality. Output only the email body in HTML — no subject line, no signature placeholder.`;
  const userPrompt = `Original subject: ${opts.subject}
Original preview: ${opts.bodyPreview}
Recipient: ${opts.recipientName || 'them'}
Attempt: ${opts.attempt} of 2${opts.attempt === 2 ? ' — soften to a graceful final note; offer to close it out if now isn\'t the right time.' : ''}`;
  try {
    const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
      }),
    });
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content || '';
    if (txt && txt.trim()) return txt;
  } catch (e) { console.error('draft LLM error', e); }
  return `<p>Hi${opts.recipientName ? ' ' + opts.recipientName.split(' ')[0] : ''},</p><p>Just wanted to circle back on "${opts.subject}" in case my earlier note got buried. Happy to make this easier — let me know what works.</p>`;
}

async function processOne(admin: any, row: any) {
  const userId = row.user_id;
  const connId = row.connection_id;

  // 1. Re-check flag status on source message
  if (row.graph_message_id) {
    const cur = await callGraph<any>(userId, connId, 'mail',
      `/me/messages/${row.graph_message_id}?$select=flag,categories`);
    if (cur.ok) {
      const fs = cur.data?.flag?.flagStatus;
      const cats: string[] = cur.data?.categories || [];
      const hasCat = cats.some((c) => /^FollowUp(?:\s*\d{1,3}d)?$/i.test(c));
      if (fs === 'complete' || (fs === 'notFlagged' && !hasCat)) {
        await admin.from('tracked_emails').update({ status: 'cancelled', last_checked_at: new Date().toISOString() }).eq('id', row.id);
        return { id: row.id, action: 'cancelled' };
      }
    }
  }

  // 2. Check for replies in the conversation after sent_at
  if (row.conversation_id) {
    const sentIso = new Date(row.sent_at).toISOString();
    const filter = encodeURIComponent(`conversationId eq '${row.conversation_id}' and receivedDateTime gt ${sentIso}`);
    const conv = await callGraph<any>(userId, connId, 'mail',
      `/me/messages?$filter=${filter}&$select=id,from,subject,internetMessageHeaders&$top=20`);
    if (conv.ok) {
      const msgs: any[] = conv.data?.value || [];
      for (const m of msgs) {
        const fromAddr = String(m.from?.emailAddress?.address || '').toLowerCase();
        if (!fromAddr) continue;
        // If sender is the connected user themselves, skip
        const { data: connRow } = await admin.from('provider_connections').select('connected_email').eq('id', connId).maybeSingle();
        const myEmail = String(connRow?.connected_email || '').toLowerCase();
        if (myEmail && fromAddr === myEmail) continue;
        // Filter auto-replies
        const headers = parseGraphInternetHeaders(m.internetMessageHeaders);
        if (isAutoReply(headers, m.subject)) continue;
        await admin.from('tracked_emails').update({ status: 'replied', last_checked_at: new Date().toISOString() }).eq('id', row.id);
        return { id: row.id, action: 'replied' };
      }
    }
  }

  // 3. Draft a follow-up if attempts < 2
  if (row.attempts >= 2) {
    await admin.from('tracked_emails').update({ status: 'exhausted', last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'exhausted' };
  }
  const attempt = row.attempts + 1;
  const bodyHtml = await draftFollowupBody({
    subject: row.subject || '(no subject)',
    bodyPreview: row.body_preview || '',
    recipientName: row.recipient_name,
    attempt,
  });

  // Create reply draft
  const draft = await callGraph<any>(userId, connId, 'mail',
    `/me/messages/${row.graph_message_id}/createReply`, { method: 'POST', body: '{}' });
  if (!draft.ok) {
    await admin.from('tracked_emails').update({ status: 'error', last_error: draft.error?.message || 'createReply failed', last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'error', err: draft.error?.message };
  }
  const draftId = draft.data?.id;
  // PATCH body
  const patch = await callGraph(userId, connId, 'mail', `/me/messages/${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { contentType: 'HTML', content: bodyHtml } }),
  });
  if (!patch.ok) {
    await admin.from('tracked_emails').update({ status: 'error', last_error: patch.error?.message || 'PATCH body failed', last_draft_id: draftId, last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'error', err: patch.error?.message };
  }

  const nextStatus = attempt >= 2 ? 'exhausted' : 'pending';
  const nextFollowUpAt = attempt < 2
    ? new Date(Date.now() + FOLLOWUP_GAP_DAYS * 86400000).toISOString()
    : row.follow_up_at;
  await admin.from('tracked_emails').update({
    status: nextStatus === 'pending' ? 'pending' : 'exhausted',
    attempts: attempt,
    last_draft_id: draftId,
    follow_up_at: nextFollowUpAt,
    last_checked_at: new Date().toISOString(),
  }).eq('id', row.id);

  return { id: row.id, action: 'drafted', attempt, draftId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const nowIso = new Date().toISOString();
    const { data: due } = await admin
      .from('tracked_emails')
      .select('*')
      .eq('status', 'pending')
      .lte('follow_up_at', nowIso)
      .limit(50);

    const results: any[] = [];
    for (const row of (due || [])) {
      try {
        const r = await processOne(admin, row);
        results.push(r);
      } catch (e: any) {
        console.error('processOne error', row.id, e);
        results.push({ id: row.id, action: 'error', err: String(e?.message ?? e) });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e: any) {
    console.error('flag-followup-cron error', e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

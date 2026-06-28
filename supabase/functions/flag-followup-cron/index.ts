// flag-followup-cron: every 15 min, scan tracked_emails where follow_up_at <= now()
// and status='pending'. Check for replies / auto-replies / flag completion, then
// draft a polite follow-up as a Graph reply DRAFT. Caps at 3 attempts.
// Honors user's auto-reply / auto-send preferences (read from agent_settings.metadata).
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
const MAX_ATTEMPTS = 3;
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
  tone?: { style?: string; format?: string; instructions?: string };
}): Promise<string> {
  const toneLine = opts.tone
    ? `Writing style: ${opts.tone.style || 'professional'}. Format: ${opts.tone.format || 'concise'}.${opts.tone.instructions ? ` Custom instructions: ${opts.tone.instructions}` : ''}`
    : '';
  if (!LOVABLE_API_KEY) {
    return `<p>Hi${opts.recipientName ? ' ' + opts.recipientName.split(' ')[0] : ''},</p>
<p>Following up on my note about "${opts.subject}". I know you're busy — let me know whenever's convenient.</p>
<p>Thanks!</p>`;
  }
  const system = `You are writing a short, polite follow-up email because the recipient has not yet replied to a previous message. Write 3-6 sentences. Be warm and respectful, acknowledge they're busy, restate the original ask or topic in one line, and gently invite a reply or next step. No guilt, no pressure, no "just circling back" clichés. ${toneLine} Output only the email body in HTML — no subject line, no signature placeholder.`;
  const userPrompt = `Original subject: ${opts.subject}
Original preview: ${opts.bodyPreview}
Recipient: ${opts.recipientName || 'them'}
Attempt: ${opts.attempt} of ${MAX_ATTEMPTS}${opts.attempt === MAX_ATTEMPTS ? ' — soften to a graceful final note; offer to close it out if now isn\'t the right time.' : ''}`;
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
    let txt: string = j?.choices?.[0]?.message?.content || '';
    // LLMs sometimes wrap HTML in ```html ... ``` fences — strip them so the
    // raw fence text doesn't show up at the top of the email draft.
    txt = stripCodeFences(txt);
    if (txt && txt.trim()) return txt;
  } catch (e) { console.error('draft LLM error', e); }
  return `<p>Hi${opts.recipientName ? ' ' + opts.recipientName.split(' ')[0] : ''},</p><p>Just wanted to circle back on "${opts.subject}" in case my earlier note got buried. Happy to make this easier — let me know what works.</p>`;
}

function stripCodeFences(s: string): string {
  if (!s) return s;
  let out = s.trim();
  // Remove leading ```html / ```HTML / ``` and a matching trailing ```
  out = out.replace(/^```(?:html|HTML)?\s*\n?/, '');
  out = out.replace(/\n?```\s*$/, '');
  return out.trim();
}

async function getPrefs(admin: any, userId: string): Promise<{ autoReply: boolean; autoSend: boolean; tone?: any; enabledAt?: string | null }> {
  // Some users have multiple follow_up_settings rows from earlier migrations.
  // Pick the most recently-updated *enabled* row so a fresh "Enable" doesn't
  // get masked by an older disabled row.
  const { data: rows, error } = await admin
    .from('follow_up_settings')
    .select('auto_draft_enabled, auto_reply_enabled, tone_settings, is_enabled, updated_at, created_at, enabled_at')
    .eq('user_id', userId)
    .order('is_enabled', { ascending: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('getPrefs error', userId, error.message);
    return { autoReply: false, autoSend: false };
  }
  const data = (rows && rows[0]) || null;
  if (!data || data.is_enabled === false) return { autoReply: false, autoSend: false };
  return {
    autoReply: !!data.auto_draft_enabled,
    autoSend: !!data.auto_reply_enabled,
    tone: data.tone_settings || null,
    enabledAt: data.enabled_at || null,
  };
}

async function processOne(admin: any, row: any) {
  const userId = row.user_id;
  const connId = row.connection_id;
  const prefs = await getPrefs(admin, userId);

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
        const { data: connRow } = await admin.from('provider_connections').select('connected_email').eq('id', connId).maybeSingle();
        const myEmail = String(connRow?.connected_email || '').toLowerCase();
        if (myEmail && fromAddr === myEmail) continue;
        const headers = parseGraphInternetHeaders(m.internetMessageHeaders);
        if (isAutoReply(headers, m.subject)) continue;
        await admin.from('tracked_emails').update({ status: 'replied', last_checked_at: new Date().toISOString() }).eq('id', row.id);
        return { id: row.id, action: 'replied' };
      }
    }
  }

  // 3. If auto-reply is off, just mark for review and skip drafting.
  if (!prefs.autoReply) {
    await admin.from('tracked_emails').update({ last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'skipped_auto_reply_off' };
  }

  // 4. Cap at MAX_ATTEMPTS
  if ((row.attempts || 0) >= MAX_ATTEMPTS) {
    await admin.from('tracked_emails').update({ status: 'exhausted', last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'exhausted' };
  }
  const attempt = (row.attempts || 0) + 1;
  const bodyHtml = await draftFollowupBody({
    subject: row.subject || '(no subject)',
    bodyPreview: row.body_preview || '',
    recipientName: row.recipient_name,
    attempt,
    tone: prefs.tone || undefined,
  });

  // Create reply draft
  const draft = await callGraph<any>(userId, connId, 'mail',
    `/me/messages/${row.graph_message_id}/createReply`, { method: 'POST', body: '{}' });
  if (!draft.ok) {
    await admin.from('tracked_emails').update({ status: 'error', last_error: draft.error?.message || 'createReply failed', last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'error', err: draft.error?.message };
  }
  const draftId = draft.data?.id;
  const patch = await callGraph(userId, connId, 'mail', `/me/messages/${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { contentType: 'HTML', content: bodyHtml } }),
  });
  if (!patch.ok) {
    await admin.from('tracked_emails').update({ status: 'error', last_error: patch.error?.message || 'PATCH body failed', last_draft_id: draftId, last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'error', err: patch.error?.message };
  }

  // Optionally auto-send the draft
  let sentNow = false;
  if (prefs.autoSend && draftId) {
    const send = await callGraph(userId, connId, 'mail', `/me/messages/${draftId}/send`, { method: 'POST', body: '{}' });
    sentNow = send.ok;
  }

  const sentAtIso = new Date().toISOString();
  const history = Array.isArray(row.follow_up_history) ? row.follow_up_history : [];
  history.push({
    attempt,
    drafted_at: sentAtIso,
    sent_at: sentNow ? sentAtIso : null,
    auto_sent: sentNow,
    draft_id: draftId,
  });

  const reachedCap = attempt >= MAX_ATTEMPTS;
  const nextStatus = reachedCap ? 'exhausted' : 'pending';
  const nextFollowUpAt = !reachedCap
    ? new Date(Date.now() + FOLLOWUP_GAP_DAYS * 86400000).toISOString()
    : row.follow_up_at;

  await admin.from('tracked_emails').update({
    status: nextStatus,
    attempts: attempt,
    last_draft_id: draftId,
    follow_up_at: nextFollowUpAt,
    last_checked_at: sentAtIso,
    follow_up_history: history,
  }).eq('id', row.id);

  return { id: row.id, action: sentNow ? 'sent' : 'drafted', attempt, draftId };
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

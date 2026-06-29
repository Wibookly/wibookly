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

const FOLLOWUP_GAP_DAYS = Number(Deno.env.get('FOLLOWUP_GAP_DAYS') || '1');

function graphDateMs(value: any): number {
  if (!value) return NaN;
  if (typeof value === 'object' && value.dateTime) {
    const raw = String(value.dateTime).replace(/(\.\d{3})\d+$/, '$1');
    const tz = String(value.timeZone || 'UTC');
    const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : /^utc$/i.test(tz) ? `${raw}Z` : `${raw}Z`);
    return d.getTime();
  }
  return new Date(value).getTime();
}

// Follow-up cadence defaults to 24 hours after the previous actual send.
// If the user configured reminder intervals, those override this per attempt.
function cadenceFor(_row: any): number {
  const days = Number.isFinite(FOLLOWUP_GAP_DAYS) && FOLLOWUP_GAP_DAYS > 0 ? FOLLOWUP_GAP_DAYS : 1;
  return days * 86400000;
}

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
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
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

interface PrefsResult {
  autoReply: boolean;
  autoSend: boolean;
  tone?: any;
  enabledAt?: string | null;
  reminderIntervalsDays?: number[];
  businessHoursOnly?: boolean;
  bhStart?: number;
  bhEnd?: number;
  businessDays?: number[];
  timezone?: string | null;
  holidays?: string[];
}

async function getPrefs(admin: any, userId: string): Promise<PrefsResult> {
  const { data: rows, error } = await admin
    .from('follow_up_settings')
    .select('auto_draft_enabled, auto_reply_enabled, tone_settings, is_enabled, updated_at, created_at, enabled_at, reminder_intervals_days, business_hours_only, business_hours_start, business_hours_end, business_days, timezone, holidays')
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
    reminderIntervalsDays: Array.isArray(data.reminder_intervals_days) ? data.reminder_intervals_days.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [],
    businessHoursOnly: !!data.business_hours_only,
    bhStart: typeof data.business_hours_start === 'number' ? data.business_hours_start : 8,
    bhEnd: typeof data.business_hours_end === 'number' ? data.business_hours_end : 17,
    businessDays: Array.isArray(data.business_days) ? data.business_days : [1, 2, 3, 4, 5],
    timezone: data.timezone || 'America/New_York',
    holidays: Array.isArray(data.holidays) ? data.holidays : [],
  };
}

function tzParts(date: Date, tz: string): { hour: number; day: number; ymd: string } {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = dtf.formatToParts(date).reduce((acc: any, p) => { acc[p.type] = p.value; return acc; }, {});
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      hour: parseInt(parts.hour, 10) || 0,
      day: dayMap[parts.weekday] ?? 1,
      ymd: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    return { hour: date.getUTCHours(), day: date.getUTCDay(), ymd: date.toISOString().slice(0, 10) };
  }
}

function isInWindow(now: Date, prefs: PrefsResult): boolean {
  if (!prefs.businessHoursOnly) return true;
  const tz = prefs.timezone || 'America/New_York';
  const { hour, day, ymd } = tzParts(now, tz);
  if ((prefs.holidays || []).includes(ymd)) return false;
  if (!(prefs.businessDays || [1, 2, 3, 4, 5]).includes(day)) return false;
  return hour >= (prefs.bhStart ?? 8) && hour < (prefs.bhEnd ?? 17);
}

function nextWindowStart(from: Date, prefs: PrefsResult): Date {
  if (!prefs.businessHoursOnly) return from;
  const tz = prefs.timezone || 'America/New_York';
  const days = prefs.businessDays || [1, 2, 3, 4, 5];
  const holidays = prefs.holidays || [];
  let cur = new Date(from.getTime());
  for (let i = 0; i < 14 * 48; i++) {
    const { hour, day, ymd } = tzParts(cur, tz);
    if (days.includes(day) && !holidays.includes(ymd) && hour >= (prefs.bhStart ?? 8) && hour < (prefs.bhEnd ?? 17)) {
      return cur;
    }
    cur = new Date(cur.getTime() + 30 * 60_000);
  }
  return new Date(from.getTime() + 24 * 3600_000);
}

function nextFollowUpAfterSend(row: any, _prefs: PrefsResult, sentAtIso: string, _completedAttempt: number): string {
  const baseMs = new Date(sentAtIso).getTime();
  return new Date(baseMs + cadenceFor(row)).toISOString();
}

function effectiveAttemptCount(row: any): number {
  const history = Array.isArray(row.follow_up_history) ? row.follow_up_history : [];
  const maxHistoryAttempt = history.reduce((max: number, h: any) => {
    const n = Number(h?.attempt || 0);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  const sentCount = history.filter((h: any) => h?.sent_at || h?.auto_sent).length;
  return Math.max(Number(row?.attempts || 0), maxHistoryAttempt, sentCount);
}

async function claimForWork(admin: any, row: any) {
  const originalStatus = String(row.status || 'pending');
  const { data, error } = await admin
    .from('tracked_emails')
    .update({ status: 'processing', last_checked_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', originalStatus)
    .select('*')
    .maybeSingle();
  if (error || !data) return null;
  return { ...data, status: originalStatus };
}

function isKnownAiFollowup(row: any, sentMs: number): boolean {
  if (!Number.isFinite(sentMs)) return false;
  const history = Array.isArray(row.follow_up_history) ? row.follow_up_history : [];
  return history.some((h: any) => {
    if (!h?.sent_at) return false;
    const histMs = new Date(h.sent_at).getTime();
    return Number.isFinite(histMs) && Math.abs(histMs - sentMs) <= 5 * 60_000;
  });
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function recipientListFor(row: any): Array<{ emailAddress: { address: string; name?: string } }> | null {
  const address = String(row?.recipient_address || '').trim();
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  return [{ emailAddress: { address, ...(row?.recipient_name ? { name: String(row.recipient_name) } : {}) } }];
}

async function ensureDraftRecipient(admin: any, row: any, draftId: string, bodyHtml?: string) {
  const toRecipients = recipientListFor(row);
  if (!toRecipients) {
    await admin.from('tracked_emails').update({
      status: 'error',
      last_error: 'Missing original recipient address — follow-up was not sent',
      last_checked_at: new Date().toISOString(),
    }).eq('id', row.id);
    return { ok: false, error: 'missing_recipient' };
  }

  const patchBody: any = { toRecipients };
  if (bodyHtml) patchBody.body = { contentType: 'HTML', content: bodyHtml };

  const patch = await callGraph(row.user_id, row.connection_id, 'mail', `/me/messages/${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify(patchBody),
  });
  if (!patch.ok) {
    await admin.from('tracked_emails').update({
      status: 'error',
      last_error: patch.error?.message || 'Could not set follow-up recipient — follow-up was not sent',
      last_draft_id: draftId,
      last_checked_at: new Date().toISOString(),
    }).eq('id', row.id);
    return { ok: false, error: patch.error?.message || 'patch_recipient_failed' };
  }

  // Hard safety check: never send until Graph confirms the draft is addressed
  // to the original recipient. This also fixes older queued drafts created
  // before recipient-forcing existed.
  const check = await callGraph<any>(row.user_id, row.connection_id, 'mail',
    `/me/messages/${draftId}?$select=toRecipients`);
  const expected = normalizeEmail(row.recipient_address);
  const actual = (check.data?.toRecipients || []).map((r: any) => normalizeEmail(r?.emailAddress?.address));
  if (!check.ok || !actual.includes(expected)) {
    await admin.from('tracked_emails').update({
      status: 'error',
      last_error: `Recipient safety check failed — expected ${row.recipient_address || 'original recipient'}, found ${actual.join(', ') || 'none'}`,
      last_draft_id: draftId,
      last_checked_at: new Date().toISOString(),
    }).eq('id', row.id);
    return { ok: false, error: 'recipient_safety_check_failed' };
  }

  return { ok: true };
}

async function processOne(admin: any, row: any) {
  const userId = row.user_id;
  const connId = row.connection_id;
  const prefs = await getPrefs(admin, userId);

  // 0. Gate on enabled_at — only process emails that were sent AFTER the user
  // turned the tracker on. Historical flagged emails are ignored.
  if (prefs.enabledAt) {
    const sentMs = new Date(row.sent_at).getTime();
    const enabledMs = new Date(prefs.enabledAt).getTime();
    if (Number.isFinite(sentMs) && Number.isFinite(enabledMs) && sentMs < enabledMs) {
      await admin
        .from('tracked_emails')
        .update({ status: 'cancelled', last_error: 'sent before tracker was enabled', last_checked_at: new Date().toISOString() })
        .eq('id', row.id);
      return { id: row.id, action: 'skipped_pre_enable' };
    }
  }

  // 1. Re-check flag status on source message. If the user unflagged or marked
  // the flag complete in Outlook, hard-delete the tracker so it stops the
  // queue and disappears from the report immediately.
  if (row.graph_message_id) {
    const cur = await callGraph<any>(userId, connId, 'mail',
      `/me/messages/${row.graph_message_id}?$select=flag,categories`);
    if (cur.ok) {
      const fs = cur.data?.flag?.flagStatus;
      const cats: string[] = cur.data?.categories || [];
      const hasCat = cats.some((c) => /^FollowUp(?:\s*\d{1,3}d)?$/i.test(c));
      if (fs === 'complete' || (fs === 'notFlagged' && !hasCat)) {
        await admin.from('tracked_emails').delete().eq('id', row.id);
        return { id: row.id, action: 'deleted_flag_removed' };
      }
    } else {
      // Source message gone (404 from a deleted email) → hard-delete tracker.
      const status = (cur as any)?.status ?? (cur as any)?.error?.status;
      const errCode = String((cur as any)?.error?.code || '').toLowerCase();
      const isNotFound = status === 404 || errCode === 'itemnotfound' || /not.?found/i.test(String((cur as any)?.error?.message || ''));
      if (isNotFound) {
        await admin.from('tracked_emails').delete().eq('id', row.id);
        return { id: row.id, action: 'deleted_source_missing' };
      }
    }
  }

  // 2. Check for replies in the conversation after sent_at.
  // ANY new message in the conversation after the original sent_at — including
  // one the user sent themselves via the AI draft flow — means the conversation
  // has moved on and no AI follow-up should fire.
  if (row.conversation_id) {
    const sentIso = new Date(row.sent_at).toISOString();
    const filter = encodeURIComponent(`conversationId eq '${row.conversation_id}' and receivedDateTime gt ${sentIso}`);
    const conv = await callGraph<any>(userId, connId, 'mail',
      `/me/messages?$filter=${filter}&$select=id,from,subject,internetMessageHeaders,sentDateTime,internetMessageId,parentFolderId&$top=20`);
    if (conv.ok) {
      const msgs: any[] = conv.data?.value || [];
      const { data: connRow } = await admin.from('provider_connections').select('connected_email').eq('id', connId).maybeSingle();
      const myEmail = String(connRow?.connected_email || '').toLowerCase();

      // Fetch the original message's internetMessageId so we can ignore
      // self-to-self deliveries that surface the same RFC message in the inbox.
      let originalIMID = '';
      if (row.graph_message_id) {
        const orig = await callGraph<any>(userId, connId, 'mail',
          `/me/messages/${row.graph_message_id}?$select=internetMessageId`);
        originalIMID = String(orig.data?.internetMessageId || '').toLowerCase();
      }

      // Resolve Sent Items folder id once — only own messages that actually
      // live in Sent Items count as a real manual follow-up.
      let sentItemsId = '';
      const sentFolder = await callGraph<any>(userId, connId, 'mail',
        `/me/mailFolders/sentitems?$select=id`);
      sentItemsId = String(sentFolder.data?.id || '');

      const sentAtMs = new Date(row.sent_at).getTime();
      let sawThirdPartyReply = false;
      let sawOwnReply = false;
      for (const m of msgs) {
        const fromAddr = String(m.from?.emailAddress?.address || '').toLowerCase();
        if (!fromAddr) continue;
        // Skip the original message itself (same Graph id, or same RFC message-id from a self-send copy).
        if (m.id && row.graph_message_id && m.id === row.graph_message_id) continue;
        const imid = String(m.internetMessageId || '').toLowerCase();
        if (originalIMID && imid && imid === originalIMID) continue;
        const headers = parseGraphInternetHeaders(m.internetMessageHeaders);
        if (isAutoReply(headers, m.subject)) continue;
        if (myEmail && fromAddr === myEmail) {
          // Only treat as a manual follow-up if it's a NEW Sent Items message
          // that was actually sent after the original. Otherwise it's just the
          // inbox-side copy of a self-addressed email and must be ignored.
          const sentMs = m.sentDateTime ? new Date(m.sentDateTime).getTime() : NaN;
          const inSentFolder = sentItemsId && m.parentFolderId === sentItemsId;
          if (inSentFolder && isKnownAiFollowup(row, sentMs)) continue;
          if (inSentFolder && Number.isFinite(sentMs) && sentMs > sentAtMs + 60_000) {
            sawOwnReply = true;
          }
          continue;
        }
        sawThirdPartyReply = true;
        break;
      }
      if (sawThirdPartyReply) {
        await admin.from('tracked_emails').update({
          status: 'completed',
          scheduled_send_at: null,
          queued_reason: null,
          last_error: 'recipient replied — tracker completed',
          last_checked_at: new Date().toISOString(),
        }).eq('id', row.id);
        return { id: row.id, action: 'completed_recipient_replied' };
      }
      if (sawOwnReply) {
        // User already followed up themselves — don't double-send, but don't
        // label it "cancelled by you". Keep the tracker open and waiting for a
        // recipient reply / next follow-up date.
        const history = Array.isArray(row.follow_up_history) ? row.follow_up_history : [];
        const lastSentAt = history.filter((h: any) => h?.sent_at).map((h: any) => String(h.sent_at)).pop();
        const baseSentAt = lastSentAt || new Date().toISOString();
        const nextAt = nextFollowUpAfterSend(row, prefs, baseSentAt, Math.max(row.attempts || 0, 1));
        await admin
          .from('tracked_emails')
          .update({
            status: 'pending',
            follow_up_at: nextAt,
            scheduled_send_at: null,
            queued_reason: null,
            last_error: 'user followed up manually — waiting for recipient reply',
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        return { id: row.id, action: 'manual_followup_detected_pending', next_follow_up_at: nextAt };
      }
    }
  }

  // 3. If auto-reply is off, just mark for review and skip drafting.
  if (!prefs.autoReply) {
    await admin.from('tracked_emails').update({ last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'skipped_auto_reply_off' };
  }

  // 4. Cap at MAX_ATTEMPTS
  if (effectiveAttemptCount(row) >= MAX_ATTEMPTS) {
    await admin.from('tracked_emails').update({ status: 'no_response', last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'no_response' };
  }

  const now = new Date();
  const inWindow = isInWindow(now, prefs);

  // Queued path: a previous run already drafted; only need to send when window opens.
  if (row.status === 'queued' && row.last_draft_id) {
    const scheduledMs = row.scheduled_send_at ? new Date(row.scheduled_send_at).getTime() : 0;
    if (Number.isFinite(scheduledMs) && scheduledMs > now.getTime()) {
      await admin.from('tracked_emails').update({ last_checked_at: now.toISOString() }).eq('id', row.id);
      return { id: row.id, action: 'queued_waiting_for_window' };
    }
    if (!inWindow) {
      const next = nextWindowStart(now, prefs);
      await admin.from('tracked_emails').update({
        scheduled_send_at: next.toISOString(),
        last_checked_at: now.toISOString(),
      }).eq('id', row.id);
      return { id: row.id, action: 'still_queued' };
    }
    if (prefs.autoSend) {
      const claimed = await claimForWork(admin, row);
      if (!claimed) return { id: row.id, action: 'skipped_already_processing' };
      row = claimed;
      if (effectiveAttemptCount(row) >= MAX_ATTEMPTS) {
        await admin.from('tracked_emails').update({ status: 'no_response', last_checked_at: now.toISOString() }).eq('id', row.id);
        return { id: row.id, action: 'no_response' };
      }
      const safe = await ensureDraftRecipient(admin, row, row.last_draft_id);
      if (!safe.ok) return { id: row.id, action: 'blocked_recipient_safety_check', err: safe.error };
      const send = await callGraph(userId, connId, 'mail', `/me/messages/${row.last_draft_id}/send`, { method: 'POST', body: '{}' });
      if (send.ok) {
        const attempt = effectiveAttemptCount(row) + 1;
        const sentAtIso = now.toISOString();
        const history = Array.isArray(row.follow_up_history) ? row.follow_up_history : [];
        history.push({ attempt, drafted_at: sentAtIso, sent_at: sentAtIso, auto_sent: true, draft_id: row.last_draft_id });
        const reachedCap = attempt >= MAX_ATTEMPTS;
        await admin.from('tracked_emails').update({
          status: reachedCap ? 'no_response' : 'pending',
          attempts: attempt,
          scheduled_send_at: null,
          queued_reason: null,
          follow_up_at: reachedCap ? row.follow_up_at : nextFollowUpAfterSend(row, prefs, sentAtIso, attempt),
          last_checked_at: sentAtIso,
          follow_up_history: history,
        }).eq('id', row.id);
        return { id: row.id, action: 'sent_from_queue' };
      }
    }
    // auto-send turned off while queued → leave as drafted for user review.
    await admin.from('tracked_emails').update({ status: 'drafted', scheduled_send_at: null, queued_reason: null, last_checked_at: now.toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'released_to_drafted' };
  }

  const claimed = await claimForWork(admin, row);
  if (!claimed) return { id: row.id, action: 'skipped_already_processing' };
  row = claimed;

  if (effectiveAttemptCount(row) >= MAX_ATTEMPTS) {
    await admin.from('tracked_emails').update({ status: 'no_response', last_checked_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, action: 'no_response' };
  }

  const attempt = effectiveAttemptCount(row) + 1;
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
  // createReply on a sent message replies to the From address (the user). Force
  // the draft back to the original recipient and verify it before any send.
  const safeDraft = await ensureDraftRecipient(admin, row, draftId, bodyHtml);
  if (!safeDraft.ok) return { id: row.id, action: 'blocked_recipient_safety_check', err: safeDraft.error };

  // If auto-send is enabled but we're outside business hours → queue.
  if (prefs.autoSend && !inWindow) {
    const next = nextWindowStart(now, prefs);
    await admin.from('tracked_emails').update({
      status: 'queued',
      last_draft_id: draftId,
      scheduled_send_at: next.toISOString(),
      queued_reason: 'outside_business_hours',
      last_checked_at: now.toISOString(),
    }).eq('id', row.id);
    return { id: row.id, action: 'queued', draftId, scheduled_send_at: next.toISOString() };
  }

  // Optionally auto-send the draft (we're either in window, or auto-send is off)
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
  const nextStatus = reachedCap ? 'no_response' : (sentNow ? 'pending' : 'drafted');
  const nextFollowUpAt = !reachedCap
    ? nextFollowUpAfterSend(row, prefs, sentAtIso, attempt)
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

    // ── Stale-lock sweep ───────────────────────────────────────────────
    // If a previous invocation crashed mid-processOne (LLM timeout, Graph
    // hiccup, function shutdown), the row is left as status='processing' and
    // every subsequent tick reports "skipped_already_processing". Anything
    // claimed more than 5 minutes ago is considered stale → revert to pending
    // so the next tick can retry. Without this, follow-ups silently stop.
    // Anything claimed more than 90 seconds ago is considered stale → revert.
    // Edge functions cap at ~150s execution, and a healthy processOne should
    // finish in well under a minute. 90s is enough headroom to avoid races
    // while ensuring crashed runs are recovered before the next 5-min tick.
    const staleCutoff = new Date(Date.now() - 90_000).toISOString();
    const { data: stale } = await admin
      .from('tracked_emails')
      .select('id, last_draft_id, last_checked_at')
      .eq('status', 'processing')
      .or(`last_checked_at.lt.${staleCutoff},last_checked_at.is.null`);
    if (stale && stale.length) {
      for (const s of stale) {
        const restored = s.last_draft_id ? 'queued' : 'pending';
        await admin
          .from('tracked_emails')
          .update({ status: restored, last_error: 'recovered from stale processing lock' })
          .eq('id', s.id)
          .eq('status', 'processing');
      }
      console.log('flag-followup-cron: cleared stale locks', stale.length, stale.map((s) => s.id));
    }

    const [pendingRes, queuedRes] = await Promise.all([
      admin.from('tracked_emails').select('*').eq('status', 'pending').lte('follow_up_at', nowIso).limit(50),
      // Check every queued item, even before its scheduled send time, so a
      // recipient reply immediately clears it from the queue and prevents send.
      admin.from('tracked_emails').select('*').eq('status', 'queued').order('scheduled_send_at', { ascending: true }).limit(50),
    ]);
    const due = [...(pendingRes.data || []), ...(queuedRes.data || [])];
    console.log('flag-followup-cron: due rows', due.length, due.map((r: any) => ({ id: r.id, status: r.status, follow_up_at: r.follow_up_at })));

    const results: any[] = [];
    for (const row of (due || [])) {
      const originalStatus = String(row.status || 'pending');
      try {
        const r = await processOne(admin, row);
        console.log('flag-followup-cron: processed', row.id, JSON.stringify(r));
        results.push(r);
      } catch (e: any) {
        console.error('processOne error', row.id, e);
        // Release the lock so the next tick can retry instead of leaving the
        // row stranded as 'processing'.
        try {
          await admin
            .from('tracked_emails')
            .update({
              status: originalStatus,
              last_error: `processOne crashed: ${String(e?.message ?? e).slice(0, 300)}`,
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', row.id)
            .eq('status', 'processing');
        } catch (releaseErr) {
          console.error('failed to release lock', row.id, releaseErr);
        }
        results.push({ id: row.id, action: 'error', err: String(e?.message ?? e) });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e: any) {
    console.error('flag-followup-cron error', e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

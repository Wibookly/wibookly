// flag-tracker-ingest: scan the user's Outlook Sent Items for messages with a
// follow-up flag or "FollowUp[ Nd]" category, and upsert tracked_emails.
//
// Modes:
//   * Webhook receiver — Microsoft Graph subscription validation handshake + change notifications.
//   * Manual / cron scan — POST {} authenticated as a user, OR { mode: 'cron' } service-role for all users.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGraph } from '../_shared/graph-call.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const DEFAULT_INTERVAL_DAYS = 3;
const SCAN_LOOKBACK_HOURS = 24 * 30; // 30 days
const FOLDER_PATH = "/me/mailFolders('sentitems')/messages";

const SELECT_FIELDS = [
  'id', 'internetMessageId', 'conversationId', 'subject', 'toRecipients',
  'sentDateTime', 'flag', 'categories', 'bodyPreview', 'webLink',
].join(',');

function parseCategoryInterval(cats: string[] | undefined): { days: number } | null {
  if (!Array.isArray(cats)) return null;
  for (const c of cats) {
    const m = String(c || '').match(/^FollowUp(?:\s*(\d{1,3})d)?$/i);
    if (m) return { days: m[1] ? parseInt(m[1], 10) : DEFAULT_INTERVAL_DAYS };
  }
  return null;
}

function flagDueUtc(flag: any): Date | null {
  if (!flag || flag.flagStatus !== 'flagged') return null;
  const dt = flag.dueDateTime;
  if (!dt?.dateTime) return null;
  try {
    // dueDateTime.dateTime is a naive local datetime in dt.timeZone — interpret as UTC if 'UTC', else best-effort parse
    const tz = String(dt.timeZone || 'UTC');
    if (/^utc$/i.test(tz)) return new Date(dt.dateTime + 'Z');
    // Browsers/Deno can parse ISO; rely on appended Z fallback.
    const d = new Date(dt.dateTime);
    return isNaN(d.getTime()) ? new Date(dt.dateTime + 'Z') : d;
  } catch { return null; }
}


interface BHPrefs {
  on: boolean;
  start: number;
  end: number;
  days: number[];
  tz: string;
  holidays: string[];
}

function tzParts(date: Date, tz: string): { hour: number; day: number; ymd: string } {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
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

function isInWindow(d: Date, p: BHPrefs): boolean {
  if (!p.on) return true;
  const { hour, day, ymd } = tzParts(d, p.tz);
  if (p.holidays.includes(ymd)) return false;
  if (!p.days.includes(day)) return false;
  return hour >= p.start && hour < p.end;
}

function nextWindowStart(from: Date, p: BHPrefs): Date {
  if (!p.on) return from;
  let cur = new Date(from.getTime());
  for (let i = 0; i < 14 * 48; i++) {
    if (isInWindow(cur, p)) return cur;
    cur = new Date(cur.getTime() + 30 * 60_000);
  }
  return new Date(from.getTime() + 24 * 3600_000);
}

async function getUserPrefs(admin: any, userId: string): Promise<{ enabledAt: Date | null; bh: BHPrefs }> {
  const { data } = await admin
    .from('follow_up_settings')
    .select('is_enabled, enabled_at, updated_at, created_at, business_hours_only, business_hours_start, business_hours_end, business_days, timezone, holidays')
    .eq('user_id', userId)
    .order('is_enabled', { ascending: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  const row = (data && data[0]) || null;
  const bh: BHPrefs = {
    on: !!row?.business_hours_only,
    start: typeof row?.business_hours_start === 'number' ? row.business_hours_start : 8,
    end: typeof row?.business_hours_end === 'number' ? row.business_hours_end : 17,
    days: Array.isArray(row?.business_days) ? row.business_days : [1, 2, 3, 4, 5],
    tz: row?.timezone || 'America/New_York',
    holidays: Array.isArray(row?.holidays) ? row.holidays : [],
  };
  if (!row || row.is_enabled === false) return { enabledAt: null, bh };
  const t = row.enabled_at ? new Date(row.enabled_at) : null;
  return { enabledAt: t && !isNaN(t.getTime()) ? t : null, bh };
}

async function ingestForUser(admin: any, userId: string, connectionId: string) {
  const since = new Date(Date.now() - SCAN_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(`sentDateTime ge ${since}`);
  const endpoint = `${FOLDER_PATH}?$top=50&$orderby=sentDateTime desc&$filter=${filter}&$select=${SELECT_FIELDS}`;

  const res = await callGraph<any>(userId, connectionId, 'mail', endpoint);
  if (!res.ok) return { ok: false, error: res.error?.message, scanned: 0, upserted: 0 };

  const { enabledAt, bh } = await getUserPrefs(admin, userId);

  // ─── Retroactive snap ────────────────────────────────────────────────
  // Existing open rows may have follow_up_at / scheduled_send_at landing
  // outside the user's allowed window (e.g. ingested before this fix, or
  // before the user tightened their hours). Push every out-of-window
  // timestamp forward to the next allowed slot so nothing fires at night.
  let snapped = 0;
  if (bh.on) {
    const { data: openRows } = await admin
      .from('tracked_emails')
      .select('id, status, follow_up_at, scheduled_send_at')
      .eq('user_id', userId)
      .in('status', ['pending', 'queued', 'drafted']);
    for (const r of (openRows || []) as any[]) {
      const updates: Record<string, any> = {};
      if (r.follow_up_at) {
        const t = new Date(r.follow_up_at);
        if (!isInWindow(t, bh)) {
          updates.follow_up_at = nextWindowStart(t, bh).toISOString();
        }
      }
      if (r.scheduled_send_at) {
        const t = new Date(r.scheduled_send_at);
        if (!isInWindow(t, bh)) {
          updates.scheduled_send_at = nextWindowStart(t, bh).toISOString();
          updates.queued_reason = 'outside_business_hours';
        }
      }
      if (Object.keys(updates).length) {
        await admin.from('tracked_emails').update(updates).eq('id', r.id);
        snapped++;
      }
    }
  }

  const items: any[] = res.data?.value || [];
  let upserted = 0;
  let cancelled = 0;
  let skippedPreEnable = 0;

  for (const m of items) {
    const internetMessageId = m.internetMessageId;
    if (!internetMessageId) continue;

    const dueFromFlag = flagDueUtc(m.flag);
    const catTrigger = parseCategoryInterval(m.categories);

    // Hard-delete the tracker row whenever the source no longer qualifies for
    // tracking. The tracker ONLY exists for flagged messages that carry a
    // scheduled due date (or our FollowUp category). So we remove on:
    //  • flag completed in Outlook
    //  • flag fully removed in Outlook (notFlagged + no category)
    //  • plain flag with NO due date — user removed the schedule but kept the flag
    const plainFlagNoDue = m.flag?.flagStatus === 'flagged' && !dueFromFlag && !catTrigger;
    if (
      m.flag?.flagStatus === 'complete' ||
      (m.flag?.flagStatus === 'notFlagged' && !catTrigger) ||
      plainFlagNoDue
    ) {
      const { data: existing } = await admin
        .from('tracked_emails')
        .select('id, status')
        .eq('user_id', userId)
        .eq('internet_message_id', internetMessageId)
        .maybeSingle();
      if (existing && existing.status !== 'completed' && existing.status !== 'exhausted') {
        await admin.from('tracked_emails').delete().eq('id', existing.id);
        cancelled++;
      }
      continue;
    }

    let trigger_type: 'flag' | 'category' | null = null;
    let follow_up_at: string | null = null;
    let trigger_detail: any = null;

    if (dueFromFlag) {
      trigger_type = 'flag';
      // Snap flag-based due dates to the next allowed business-hour window
      // so the AI follow-up never fires at night / on weekends / holidays.
      follow_up_at = nextWindowStart(dueFromFlag, bh).toISOString();
      trigger_detail = { dueDateTime: m.flag.dueDateTime, original_due_utc: dueFromFlag.toISOString() };
    } else if (catTrigger) {
      trigger_type = 'category';
      const base = new Date(m.sentDateTime || Date.now()).getTime();
      const raw = new Date(base + catTrigger.days * 86400000);
      follow_up_at = nextWindowStart(raw, bh).toISOString();
      trigger_detail = { interval_days: catTrigger.days, categories: m.categories, original_due_utc: raw.toISOString() };
    } else {
      continue; // Not tracked
    }

    const recipient = m.toRecipients?.[0]?.emailAddress || null;
    const row = {
      user_id: userId,
      connection_id: connectionId,
      graph_message_id: m.id,
      internet_message_id: internetMessageId,
      conversation_id: m.conversationId || null,
      recipient_address: recipient?.address || null,
      recipient_name: recipient?.name || null,
      subject: m.subject || null,
      body_preview: (m.bodyPreview || '').slice(0, 500),
      sent_at: m.sentDateTime,
      trigger_type,
      trigger_detail,
      follow_up_at,
      web_link: m.webLink || null,
    };

    // Upsert on (user_id, internet_message_id). Only update follow_up_at/trigger
    // before the first AI follow-up is attempted. After attempt 1, the cron owns
    // the 24-hour cadence; re-ingest must not reset the row back to the original
    // Outlook flag due date or it will send again every scan.
    const { data: existing } = await admin
      .from('tracked_emails')
      .select('id, status, attempts')
      .eq('user_id', userId)
      .eq('internet_message_id', internetMessageId)
      .maybeSingle();

    // Gate on enabled_at — never INGEST emails sent before the tracker was
    // turned on. (Existing rows stay untouched; only brand-new tracker rows
    // are skipped.)
    if (!existing && enabledAt) {
      const sentMs = new Date(m.sentDateTime || 0).getTime();
      if (Number.isFinite(sentMs) && sentMs < enabledAt.getTime()) {
        skippedPreEnable++;
        continue;
      }
    }

    if (!existing) {
      const { error } = await admin.from('tracked_emails').insert({ ...row, attempts: 0, status: 'pending' });
      if (!error) upserted++;
    } else if (existing.status === 'pending' && (existing.attempts || 0) === 0) {
      await admin.from('tracked_emails').update({
        follow_up_at: row.follow_up_at,
        trigger_type: row.trigger_type,
        trigger_detail: row.trigger_detail,
        subject: row.subject,
        conversation_id: row.conversation_id,
        graph_message_id: row.graph_message_id,
        web_link: row.web_link,
      }).eq('id', existing.id);
      upserted++;
    } else if (row.web_link) {
      // Backfill web_link on existing rows that don't have it yet (one-shot).
      await admin.from('tracked_emails').update({ web_link: row.web_link })
        .eq('id', existing.id).is('web_link', null);
    }
  }

  // ─── Deletion sweep ──────────────────────────────────────────────────
  // For every still-open tracker (pending/queued/drafted) whose source
  // message wasn't returned by the recent Sent scan, verify it still
  // exists in the mailbox. If Graph returns 404 (user deleted it from
  // Sent / emptied Deleted Items), remove the tracker entirely so it
  // stops showing in the report and never auto-sends a follow-up.
  let removedDeleted = 0;
  const seenIds = new Set(items.map((m: any) => m.id).filter(Boolean));
  const { data: openRows } = await admin
    .from('tracked_emails')
    .select('id, graph_message_id')
    .eq('user_id', userId)
    .in('status', ['pending', 'queued', 'drafted', 'cancelled', 'error', 'exhausted'])
    .not('graph_message_id', 'is', null);

  for (const row of (openRows || []) as any[]) {
    if (seenIds.has(row.graph_message_id)) continue;
    const check = await callGraph<any>(
      userId,
      connectionId,
      'mail',
      `/me/messages/${row.graph_message_id}?$select=id`,
    );
    // Only act on definitive 404 (message gone). Transient errors are skipped.
    const status = (check as any)?.status ?? (check as any)?.error?.status;
    const errCode = String((check as any)?.error?.code || '').toLowerCase();
    const isNotFound =
      status === 404 ||
      errCode === 'errorIteminotfound'.toLowerCase() ||
      errCode === 'itemnotfound' ||
      /not.?found/i.test(String((check as any)?.error?.message || ''));
    if (!check.ok && isNotFound) {
      await admin.from('tracked_emails').delete().eq('id', row.id);
      removedDeleted++;
    }
  }

  // If any tracked email is already past its follow-up due time, kick the
  // follow-up cron immediately so the AI drafts/sends without waiting for
  // the next scheduled tick.
  const nowIso = new Date().toISOString();
  const { data: dueNow } = await admin
    .from('tracked_emails')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['pending', 'queued'])
    .lte('follow_up_at', nowIso)
    .limit(1);
  let kickedFollowup = false;
  if ((dueNow || []).length > 0) {
    try {
      const supaUrl = Deno.env.get('SUPABASE_URL')!;
      const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
      // Fire-and-forget; don't await the body to avoid blocking the response.
      fetch(`${supaUrl}/functions/v1/flag-followup-cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
        body: '{}',
      }).catch((e) => console.error('kick flag-followup-cron failed', e));
      kickedFollowup = true;
    } catch (e) {
      console.error('kick flag-followup-cron error', e);
    }
  }

  // ─── Reply sweep ─────────────────────────────────────────────────────
  // For every still-open tracker, check the conversation for a NEW message
  // from someone other than the user that arrived after sent_at. If found,
  // mark the tracker as 'replied', clear the scheduled queue, and clear
  // the Outlook follow-up flag so it disappears from the report queue.
  let repliedClosed = 0;
  const { data: connRow } = await admin
    .from('provider_connections')
    .select('connected_email')
    .eq('id', connectionId)
    .maybeSingle();
  const myEmail = String(connRow?.connected_email || '').toLowerCase();

  const { data: openForReply } = await admin
    .from('tracked_emails')
    .select('id, conversation_id, sent_at, graph_message_id, recipient_address')
    .eq('user_id', userId)
    .in('status', ['pending', 'queued', 'drafted', 'draft_ready', 'sent'])
    .not('conversation_id', 'is', null)
    .limit(200);

  for (const r of (openForReply || []) as any[]) {
    const sentIso = new Date(r.sent_at || 0).toISOString();
    const filter = encodeURIComponent(`conversationId eq '${r.conversation_id}' and receivedDateTime gt ${sentIso}`);
    const conv = await callGraph<any>(
      userId, connectionId, 'mail',
      `/me/messages?$filter=${filter}&$select=id,from,subject,internetMessageHeaders,sentDateTime,internetMessageId&$top=10`,
    );
    if (!conv.ok) continue;
    const msgs: any[] = conv.data?.value || [];
    let replied = false;
    for (const m of msgs) {
      const fromAddr = String(m.from?.emailAddress?.address || '').toLowerCase();
      if (!fromAddr) continue;
      if (myEmail && fromAddr === myEmail) continue;
      // Skip auto-replies / OOO
      const subj = String(m.subject || '');
      if (/^(automatic reply|out of office|auto-?reply)/i.test(subj)) continue;
      const headers: Record<string, string> = {};
      for (const h of (m.internetMessageHeaders || [])) if (h?.name) headers[String(h.name).toLowerCase()] = String(h.value || '');
      if ((headers['auto-submitted'] || '').toLowerCase().includes('auto-replied')) continue;
      if (headers['x-auto-response-suppress']) continue;
      replied = true;
      break;
    }
    if (!replied) continue;

    // Clear Outlook flag (best-effort) so it leaves the active queue
    if (r.graph_message_id) {
      const cur = await callGraph<any>(userId, connectionId, 'mail',
        `/me/messages/${r.graph_message_id}?$select=categories`);
      const cleanedCategories: string[] = Array.isArray(cur.data?.categories)
        ? cur.data.categories.filter((c: string) => !/^FollowUp(?:\s*\d{1,3}d)?$/i.test(String(c || '')))
        : [];
      await callGraph<any>(userId, connectionId, 'mail',
        `/me/messages/${r.graph_message_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ flag: { flagStatus: 'complete' }, categories: cleanedCategories }),
        });
    }

    await admin.from('tracked_emails').update({
      status: 'replied',
      scheduled_send_at: null,
      queued_reason: null,
      follow_up_at: null,
      last_error: 'recipient replied — tracker auto-closed',
      last_checked_at: new Date().toISOString(),
    }).eq('id', r.id);
    repliedClosed++;
  }

  return {
    ok: true,
    scanned: items.length,
    upserted,
    cancelled,
    removed_deleted: removedDeleted,
    replied_closed: repliedClosed,
    skipped_pre_enable: skippedPreEnable,
    kicked_followup: kickedFollowup,
    snapped_to_business_hours: snapped,
  };
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Graph subscription validation handshake (?validationToken=...)
  const url = new URL(req.url);
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    return new Response(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));

  // Cron mode: scan all active Outlook connections
  if (body?.mode === 'cron') {
    const { data: conns } = await admin
      .from('provider_connections')
      .select('id, user_id')
      .eq('provider', 'outlook')
      .not('connected_email', 'is', null)
      .limit(500);
    const summary: any[] = [];
    for (const c of (conns || [])) {
      const r = await ingestForUser(admin, c.user_id, c.id);
      summary.push({ user_id: c.user_id, ...r });
    }
    return json({ ok: true, summary });
  }

  // Webhook notification mode (Graph posts notifications JSON)
  if (Array.isArray(body?.value)) {
    // Group by clientState/subscriptionId → for MVP just rescan affected users.
    // Resolve via subscriptionId mapping would be ideal; here we scan all referenced users.
    const userIds = new Set<string>();
    for (const n of body.value) {
      // We don't currently store the subscription→user mapping, so this branch is a no-op.
      // Cron fallback covers it within minutes.
      if (n?.subscriptionId) userIds.add(String(n.subscriptionId));
    }
    return json({ ok: true, notified: userIds.size });
  }

  // Manual user-authenticated scan
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims } = await supabase.auth.getClaims(authHeader.replace('Bearer ', ''));
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const { data: conn } = await admin
    .from('provider_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .not('connected_email', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!conn) return json({ error: 'No Outlook connection found' }, 404);

  const result = await ingestForUser(admin, userId, conn.id);
  return json(result);
});

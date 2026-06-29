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
  'sentDateTime', 'flag', 'categories', 'bodyPreview',
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

async function getEnabledAt(admin: any, userId: string): Promise<Date | null> {
  const { data } = await admin
    .from('follow_up_settings')
    .select('is_enabled, enabled_at, updated_at, created_at')
    .eq('user_id', userId)
    .order('is_enabled', { ascending: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  const row = (data && data[0]) || null;
  if (!row || row.is_enabled === false) return null;
  const t = row.enabled_at ? new Date(row.enabled_at) : null;
  return t && !isNaN(t.getTime()) ? t : null;
}

async function ingestForUser(admin: any, userId: string, connectionId: string) {
  const since = new Date(Date.now() - SCAN_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(`sentDateTime ge ${since}`);
  const endpoint = `${FOLDER_PATH}?$top=50&$orderby=sentDateTime desc&$filter=${filter}&$select=${SELECT_FIELDS}`;

  const res = await callGraph<any>(userId, connectionId, 'mail', endpoint);
  if (!res.ok) return { ok: false, error: res.error?.message, scanned: 0, upserted: 0 };

  const enabledAt = await getEnabledAt(admin, userId);

  const items: any[] = res.data?.value || [];
  let upserted = 0;
  let cancelled = 0;
  let skippedPreEnable = 0;

  for (const m of items) {
    const internetMessageId = m.internetMessageId;
    if (!internetMessageId) continue;

    const dueFromFlag = flagDueUtc(m.flag);
    const catTrigger = parseCategoryInterval(m.categories);

    // If flag is completed or removed in Outlook, hard-delete the tracker row
    // entirely (across any open status) so it disappears from the report and
    // never sends a follow-up. Matches the "Cancel = full removal" behavior.
    if (m.flag?.flagStatus === 'complete' || (m.flag?.flagStatus === 'notFlagged' && !catTrigger)) {
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
      follow_up_at = dueFromFlag.toISOString();
      trigger_detail = { dueDateTime: m.flag.dueDateTime };
    } else if (catTrigger) {
      trigger_type = 'category';
      const base = new Date(m.sentDateTime || Date.now()).getTime();
      follow_up_at = new Date(base + catTrigger.days * 86400000).toISOString();
      trigger_detail = { interval_days: catTrigger.days, categories: m.categories };
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
    };

    // Upsert on (user_id, internet_message_id). Only update follow_up_at/trigger if still pending.
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
    } else if (existing.status === 'pending') {
      await admin.from('tracked_emails').update({
        follow_up_at: row.follow_up_at,
        trigger_type: row.trigger_type,
        trigger_detail: row.trigger_detail,
        subject: row.subject,
        conversation_id: row.conversation_id,
        graph_message_id: row.graph_message_id,
      }).eq('id', existing.id);
      upserted++;
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

  return {
    ok: true,
    scanned: items.length,
    upserted,
    cancelled,
    removed_deleted: removedDeleted,
    skipped_pre_enable: skippedPreEnable,
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

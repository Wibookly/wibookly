// Manual / scheduled inbox audit for the Follow-Up Reminder feature.
//
// Two modes:
//  1. Manual (called from the UI):
//     body: { connection_id, from_date?, to_date? }
//     Scans Sent Items in [from_date, to_date]. For every email that has
//     no reply from the recipient, the original message is moved into the
//     "Follow-up" Outlook folder AND the user's Follow Up category is
//     enabled so the email surfaces in InboxIQ for manual action.
//     No drafts are written and no auto-replies are sent — pure audit.
//
//  2. Daily cron pass:
//     body: { mode: "daily_cron" }
//     For every connection whose follow_up_settings.daily_audit_enabled = true
//     AND last_audit_at is older than 23h, runs the same audit over the
//     last 24 hours.
//
// IMPORTANT: this function never sends or drafts replies. It only labels
// the original email so the user can review it. Auto-Draft / Auto-Reply
// remain governed by the existing cron-follow-ups job (every 15 minutes)
// using the BCC-trigger model.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TOKEN_ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// === AES-GCM token decryption (same scheme as cron-follow-ups) ===
async function importKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(TOKEN_ENC_KEY.padEnd(32).slice(0, 32));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}
async function decrypt(b64: string): Promise<string> {
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const key = await importKey();
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(dec);
}
async function getValidToken(userId: string, provider: string): Promise<string | null> {
  const { data } = await admin
    .from('oauth_token_vault')
    .select('encrypted_access_token,expires_at')
    .eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) > new Date(Date.now() + 60_000)) {
    return decrypt(data.encrypted_access_token);
  }
  return null;
}

// Reuse the same Follow-up folder pattern as cron-follow-ups.
async function ensureFollowupFolder(token: string, connectionId: string, cachedId: string | null): Promise<string | null> {
  if (cachedId) {
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${cachedId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) return cachedId;
  }
  const list = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders?$top=100&$select=id,displayName`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok) return null;
  const data = await list.json();
  const matches = (data.value ?? []).filter((f: any) => f.displayName === 'Follow-up');
  let folderId: string | null = matches[0]?.id ?? null;
  if (!folderId) {
    const create = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Follow-up' }),
    });
    if (!create.ok) return null;
    folderId = (await create.json()).id;
  }
  if (folderId) {
    await admin.from('provider_connections').update({ inbox_followup_folder_id: folderId }).eq('id', connectionId);
  }
  return folderId;
}

async function conversationHasReply(token: string, conversationId: string, originalSentAt: string, originalRecipients: string[], myEmail: string): Promise<boolean> {
  const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq '${conversationId}'&$select=id,from,sentDateTime,receivedDateTime&$top=50`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const data = await r.json();
  const lower = (s: string | undefined | null) => (s ?? '').toLowerCase();
  const recips = new Set(originalRecipients.map(lower));
  for (const m of (data.value ?? [])) {
    const sender = lower(m.from?.emailAddress?.address);
    if (!sender || sender === myEmail) continue;
    if (!recips.has(sender)) continue;
    const ts = new Date(m.receivedDateTime ?? m.sentDateTime ?? 0);
    if (ts > new Date(originalSentAt)) return true;
  }
  return false;
}

async function enableFollowUpCategory(connectionId: string) {
  await admin
    .from('categories')
    .update({ is_enabled: true })
    .eq('connection_id', connectionId)
    .or('is_follow_up.eq.true,name.ilike.%follow up%,name.ilike.%follow-up%,name.ilike.%followup%');
}

interface AuditResult {
  scanned: number;
  flagged: number;
  already_replied: number;
  errors: number;
}

async function auditConnection(opts: {
  connectionId: string;
  userId: string;
  organizationId: string;
  provider: string;
  cachedFolderId: string | null;
  connectedEmail: string | null;
  fromIso: string;
  toIso: string;
}): Promise<AuditResult> {
  const result: AuditResult = { scanned: 0, flagged: 0, already_replied: 0, errors: 0 };

  const token = await getValidToken(opts.userId, opts.provider);
  if (!token) {
    result.errors++;
    return result;
  }

  const meRes = await fetch(`https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meRes.ok) { result.errors++; return result; }
  const me = await meRes.json();
  const myEmail: string = (me.mail ?? me.userPrincipalName ?? opts.connectedEmail ?? '').toLowerCase();
  if (!myEmail) { result.errors++; return result; }

  // Make sure the Follow Up category is enabled so flagged items surface in InboxIQ.
  await enableFollowUpCategory(opts.connectionId);

  // Make sure the dedicated Outlook folder exists.
  const folderId = await ensureFollowupFolder(token, opts.connectionId, opts.cachedFolderId);

  // Page through Sent Items in the requested range.
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages` +
    `?$filter=sentDateTime ge ${opts.fromIso} and sentDateTime le ${opts.toIso}` +
    `&$select=id,subject,conversationId,toRecipients,ccRecipients,sentDateTime` +
    `&$orderby=sentDateTime desc&$top=50`;

  let pages = 0;
  const MAX_PAGES = 20; // up to 1000 sent emails per audit

  while (url && pages < MAX_PAGES) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`audit fetch failed: ${res.status}`);
      result.errors++;
      break;
    }
    const json = await res.json();

    for (const m of (json.value ?? [])) {
      result.scanned++;

      const recips: string[] = [
        ...((m.toRecipients ?? []) as any[]).map((r: any) => r.emailAddress?.address).filter(Boolean),
        ...((m.ccRecipients ?? []) as any[]).map((r: any) => r.emailAddress?.address).filter(Boolean),
      ];
      if (recips.length === 0) continue;

      const conversationId: string | null = m.conversationId ?? null;
      const sentAt: string = m.sentDateTime;

      const hasReply = conversationId
        ? await conversationHasReply(token, conversationId, sentAt, recips, myEmail)
        : false;

      if (hasReply) {
        result.already_replied++;
        continue;
      }

      // No reply → flag this email by moving the original (the one we sent
      // is in Sent; the recipient's lack of reply means we should follow up).
      // We flag by moving a *copy* of the message into the Follow-up folder
      // so the user can act on it directly. Microsoft Graph supports /move
      // on the message itself but Sent items shouldn't be moved out of Sent
      // — instead we /copy into the Follow-up folder.
      if (folderId) {
        try {
          const copyRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${m.id}/copy`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ destinationId: folderId }),
          });
          if (!copyRes.ok) {
            result.errors++;
            continue;
          }
        } catch (e) {
          console.error('copy to Follow-up folder failed', e);
          result.errors++;
          continue;
        }
      }

      // Record an audit tracker row so the email also shows in InboxIQ.
      // Use a synthetic alias to distinguish from BCC-triggered trackers.
      const dueAt = new Date(); // already due — surfaced by the audit
      await admin.from('follow_up_trackers').upsert({
        organization_id: opts.organizationId,
        connection_id: opts.connectionId,
        user_id: opts.userId,
        message_id: m.id,
        conversation_id: conversationId,
        subject: m.subject ?? null,
        to_recipients: m.toRecipients ?? [],
        cc_recipients: m.ccRecipients ?? [],
        bcc_alias: 'audit',
        days_after_send: 0,
        sent_at: sentAt,
        due_at: dueAt.toISOString(),
        status: 'pending',
      }, { onConflict: 'connection_id,message_id,bcc_alias', ignoreDuplicates: true });

      result.flagged++;
    }

    pages++;
    url = json['@odata.nextLink'] ?? null;
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? 'manual';

    // ===== Daily cron pass =====
    if (mode === 'daily_cron') {
      const cutoff = new Date(Date.now() - 23 * 3600_000).toISOString();
      const { data: settings } = await admin
        .from('follow_up_settings')
        .select('connection_id,user_id,organization_id,last_audit_at,business_hours_only,business_hours_start,business_hours_end,business_days,timezone')
        .eq('daily_audit_enabled', true)
        .or(`last_audit_at.is.null,last_audit_at.lt.${cutoff}`);

      let processed = 0;
      let skippedOffHours = 0;
      const results: any[] = [];
      for (const s of (settings ?? []) as any[]) {
        const { data: conn } = await admin
          .from('provider_connections')
          .select('id,user_id,organization_id,provider,inbox_followup_folder_id,connected_email,is_connected')
          .eq('id', s.connection_id)
          .maybeSingle();
        if (!conn || !conn.is_connected) continue;

        // Business-hours gate. The cron-follow-ups loop calls us every 15
        // minutes, so we just wait until the user is inside their local
        // business window before running the once-per-day audit.
        const tz = s.timezone || 'America/New_York';
        if (s.business_hours_only) {
          try {
            const fmt = new Intl.DateTimeFormat('en-US', {
              timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
            });
            const parts = fmt.formatToParts(new Date());
            const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
            const hr = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
            const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            const dow = map[wd] ?? 0;
            const days: number[] = s.business_days ?? [1, 2, 3, 4, 5];
            if (!days.includes(dow) || hr < s.business_hours_start || hr >= s.business_hours_end) {
              skippedOffHours++;
              continue;
            }
          } catch { /* fail open */ }
        }

        const toIso = new Date().toISOString();
        const fromIso = new Date(Date.now() - 24 * 3600_000).toISOString();
        const r = await auditConnection({
          connectionId: conn.id,
          userId: conn.user_id,
          organizationId: conn.organization_id,
          provider: conn.provider,
          cachedFolderId: conn.inbox_followup_folder_id,
          connectedEmail: conn.connected_email,
          fromIso, toIso,
        });
        await admin.from('follow_up_settings').update({
          last_audit_at: new Date().toISOString(),
          last_audit_summary: { ...r, mode: 'daily_cron', from: fromIso, to: toIso },
        }).eq('connection_id', conn.id);
        results.push({ connection_id: conn.id, ...r });
        processed++;
      }

      return new Response(JSON.stringify({ ok: true, mode, processed, skipped_off_hours: skippedOffHours, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== Manual (from UI) =====
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connectionId = body.connection_id;
    if (!connectionId) {
      return new Response(JSON.stringify({ error: 'connection_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: conn } = await admin
      .from('provider_connections')
      .select('id,user_id,organization_id,provider,inbox_followup_folder_id,connected_email,is_connected')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: 'connection not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Default range: last 30 days
    const now = new Date();
    const fromIso = body.from_date
      ? new Date(body.from_date).toISOString()
      : new Date(now.getTime() - 30 * 86400_000).toISOString();
    const toIso = body.to_date
      ? new Date(body.to_date).toISOString()
      : now.toISOString();

    const r = await auditConnection({
      connectionId: conn.id,
      userId: conn.user_id,
      organizationId: conn.organization_id,
      provider: conn.provider,
      cachedFolderId: conn.inbox_followup_folder_id,
      connectedEmail: conn.connected_email,
      fromIso, toIso,
    });

    await admin.from('follow_up_settings').update({
      last_audit_at: new Date().toISOString(),
      last_audit_summary: { ...r, mode: 'manual', from: fromIso, to: toIso },
    }).eq('connection_id', conn.id);

    return new Response(JSON.stringify({ ok: true, mode: 'manual', from: fromIso, to: toIso, ...r }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('audit-inbox-followups error', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Per-email BCC follow-up cron — runs every 15 minutes.
//
// How it works:
// 1. Scans each connected mailbox's Sent Items (last 30 days, paged).
// 2. For every sent message, looks at the BCC recipients. If any of them match
//    N@<our-domain> where N ∈ {2,3,5,7,10,14}, we record a tracker row with
//    due_at = sentDateTime + N days. We keep the BCC visible in the message
//    so the user can always see when the follow-up was originally scheduled.
// 3. For every tracker that is now due (due_at <= now), we check the
//    conversation for any reply from one of the original TO/CC recipients.
//      - If a reply exists → mark `replied`, no action.
//      - Otherwise → move the original message into a single "Follow-up"
//        Outlook folder + create an AI-drafted reply. Status becomes `drafted`.
// 4. Every run also re-checks pending trackers (due in the future) for early
//    replies and cancels them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const TOKEN_ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Any positive integer is now accepted (1..90 days). The legacy bucket list is
// kept as a fallback hint for the UI, but the cron parses any number.
const MAX_DAYS = 90;

// === AES-GCM token decryption (same scheme as other functions) ===
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
  const { data } = await supabase
    .from('oauth_token_vault')
    .select('encrypted_access_token,expires_at')
    .eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) > new Date(Date.now() + 60_000)) {
    return decrypt(data.encrypted_access_token);
  }
  return null;
}

async function logAiUsage(orgId: string, userId: string | null, model: string, action: string, prompt: number, completion: number) {
  const PRICES: Record<string, { in: number; out: number }> = {
    'gpt-4o-mini': { in: 0.15, out: 0.60 },
    'gpt-4o': { in: 2.50, out: 10.00 },
  };
  const p = PRICES[model] ?? { in: 0.15, out: 0.60 };
  const cost = (prompt / 1_000_000) * p.in + (completion / 1_000_000) * p.out;
  await supabase.from('ai_usage_logs').insert({
    organization_id: orgId,
    user_id: userId,
    provider: 'openai',
    model,
    action,
    prompt_tokens: prompt,
    completion_tokens: completion,
    cost_usd: cost.toFixed(6),
  });
}

// Ensure the dedicated "Follow-up" Outlook folder exists; cache its id on the connection.
async function ensureFollowupFolder(token: string, connectionId: string, cachedId: string | null): Promise<string | null> {
  if (cachedId) {
    // Quick existence check
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${cachedId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) return cachedId;
  }
  // Look it up by name (and dedupe duplicates)
  const list = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders?$top=100&$select=id,displayName`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok) return null;
  const data = await list.json();
  const matches = (data.value ?? []).filter((f: any) => f.displayName === 'Follow-up');
  let folderId: string | null = matches[0]?.id ?? null;

  // Delete any duplicates beyond the first
  for (let i = 1; i < matches.length; i++) {
    await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${matches[i].id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!folderId) {
    const create = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Follow-up' }),
    });
    if (!create.ok) return null;
    const created = await create.json();
    folderId = created.id;
  }

  if (folderId) {
    await supabase.from('provider_connections')
      .update({ inbox_followup_folder_id: folderId })
      .eq('id', connectionId);
  }
  return folderId;
}

interface ParsedAlias { alias: string; days: number }
function parseFollowupAlias(addresses: string[], domain: string): ParsedAlias | null {
  for (const raw of addresses) {
    const a = raw.toLowerCase().trim();
    const m = a.match(/^(\d+)@(.+)$/);
    if (!m) continue;
    if (m[2] !== domain) continue;
    const days = parseInt(m[1], 10);
    if (Number.isInteger(days) && days >= 1 && days <= MAX_DAYS) return { alias: a, days };
  }
  return null;
}

async function generateFollowUp(originalSubject: string, originalBody: string, recipientName: string, days: number): Promise<{ html: string; promptTokens: number; completionTokens: number }> {
  const sys = 'You write short, polite professional follow-up emails. Reply with ONLY the email body in clean HTML, 2-4 sentences max, no subject line, no signature, no greetings beyond a brief opener.';
  const user = `Original subject: ${originalSubject}
Recipient: ${recipientName}
Days since I sent the original: ${days}

Original email I sent:
${originalBody.slice(0, 1500)}

Write a short, polite follow-up nudge. Acknowledge the time that has passed, restate the ask in one line, and invite a reply. No subject line, no signature.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      max_tokens: 350,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return {
    html: text.startsWith('<') ? text : `<p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

interface Connection {
  id: string; user_id: string; organization_id: string; provider: string;
  inbox_followup_folder_id: string | null; connected_email: string | null;
}

async function scanSentForTriggers(conn: Connection, token: string, ourDomain: string): Promise<number> {
  // Look back 30 days; the BCC tag survives forever, so we catch anything we missed too.
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages` +
    `?$filter=sentDateTime ge ${since}` +
    `&$select=id,subject,conversationId,toRecipients,ccRecipients,bccRecipients,sentDateTime,bodyPreview` +
    `&$orderby=sentDateTime desc&$top=50`;
  let added = 0;
  let pages = 0;
  while (url && pages < 6) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`scan sent failed: ${res.status} ${await res.text()}`);
      break;
    }
    const json = await res.json();
    for (const m of (json.value ?? [])) {
      const bccs: string[] = (m.bccRecipients ?? []).map((r: any) => r.emailAddress?.address ?? '').filter(Boolean);
      if (bccs.length === 0) continue;
      const parsed = parseFollowupAlias(bccs, ourDomain);
      if (!parsed) continue;

      const sentAt = new Date(m.sentDateTime);
      const dueAt = new Date(sentAt.getTime() + parsed.days * 86400000);

      // Insert tracker (idempotent via unique index)
      const { error } = await supabase.from('follow_up_trackers').upsert({
        organization_id: conn.organization_id,
        connection_id: conn.id,
        user_id: conn.user_id,
        message_id: m.id,
        conversation_id: m.conversationId ?? null,
        subject: m.subject ?? null,
        to_recipients: m.toRecipients ?? [],
        cc_recipients: m.ccRecipients ?? [],
        bcc_alias: parsed.alias,
        days_after_send: parsed.days,
        sent_at: sentAt.toISOString(),
        due_at: dueAt.toISOString(),
        status: 'pending',
      }, { onConflict: 'connection_id,message_id,bcc_alias', ignoreDuplicates: true });
      if (!error) added++;
    }
    pages++;
    url = json['@odata.nextLink'] ?? null;
  }
  return added;
}

async function conversationHasReply(token: string, conversationId: string, originalSentAt: string, originalRecipients: string[], myEmail: string | null): Promise<boolean> {
  const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq '${conversationId}'&$select=id,from,sentDateTime,receivedDateTime&$top=50`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const data = await r.json();
  const lower = (s: string | undefined | null) => (s ?? '').toLowerCase();
  const recips = new Set(originalRecipients.map(lower));
  const me = lower(myEmail);
  for (const m of (data.value ?? [])) {
    const sender = lower(m.from?.emailAddress?.address);
    if (!sender || sender === me) continue;
    if (!recips.has(sender)) continue;
    const ts = new Date(m.receivedDateTime ?? m.sentDateTime ?? 0);
    if (ts > new Date(originalSentAt)) return true;
  }
  return false;
}

interface FollowUpSettings {
  is_enabled: boolean;
  auto_draft_enabled: boolean;
  auto_reply_enabled: boolean;
  skip_if_replied: boolean;
  reminder_max_count: number;
  reminder_intervals_days: number[];
  business_hours_only: boolean;
  business_hours_start: number;
  business_hours_end: number;
  business_days: number[];
  timezone: string | null;
}

async function loadSettings(connectionId: string): Promise<FollowUpSettings> {
  const { data } = await supabase
    .from('follow_up_settings')
    .select('is_enabled,auto_draft_enabled,auto_reply_enabled,skip_if_replied,reminder_max_count,reminder_intervals_days,business_hours_only,business_hours_start,business_hours_end,business_days,timezone')
    .eq('connection_id', connectionId)
    .maybeSingle();
  return (data as FollowUpSettings | null) ?? {
    is_enabled: false,
    auto_draft_enabled: true,
    auto_reply_enabled: false,
    skip_if_replied: true,
    reminder_max_count: 3,
    reminder_intervals_days: [1, 3, 7],
    business_hours_only: true,
    business_hours_start: 8,
    business_hours_end: 17,
    business_days: [1, 2, 3, 4, 5],
    timezone: null,
  };
}

// Try to read the user's Outlook mailbox timezone (one-shot best effort).
async function fetchMailboxTimezone(token: string): Promise<string | null> {
  try {
    const r = await fetch('https://graph.microsoft.com/v1.0/me/mailboxSettings/timeZone', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const tz = (j.value ?? '').toString().trim();
    return tz || null;
  } catch {
    return null;
  }
}

// Returns { dow: 0=Sun..6=Sat, hour: 0..23 } for `now` in the given IANA tz.
function nowInTz(tz: string): { dow: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hr = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: map[wd] ?? 0, hour: isNaN(hr) ? 0 : hr };
}

function isWithinBusinessHours(s: FollowUpSettings, tz: string): boolean {
  if (!s.business_hours_only) return true;
  try {
    const { dow, hour } = nowInTz(tz);
    if (!s.business_days.includes(dow)) return false;
    return hour >= s.business_hours_start && hour < s.business_hours_end;
  } catch {
    // If timezone is invalid, fail open (don't block sends).
    return true;
  }
}

function pickActionMode(s: FollowUpSettings): 'auto_reply' | 'auto_draft' | 'label_only' {
  if (s.auto_reply_enabled) return 'auto_reply';
  if (s.auto_draft_enabled) return 'auto_draft';
  return 'label_only';
}

async function processDueTrackers(conn: Connection, token: string, myEmail: string | null, settings: FollowUpSettings, effectiveTz: string) {
  // Fetch all tracker rows that are pending (we'll cancel early replies and act on overdue)
  const { data: trackers } = await supabase
    .from('follow_up_trackers')
    .select('*')
    .eq('connection_id', conn.id)
    .eq('status', 'pending')
    .order('due_at', { ascending: true })
    .limit(100);

  if (!trackers || trackers.length === 0) return { drafted: 0, replied: 0, autoSent: 0, labeled: 0 };

  let drafted = 0, replied = 0, autoSent = 0, labeled = 0;
  let folderId: string | null = conn.inbox_followup_folder_id;
  // Outside business hours we still label/move emails into the Follow Up
  // category, but we DO NOT draft or auto-send. The next run inside business
  // hours will pick up these trackers and produce the draft/send.
  const inHours = isWithinBusinessHours(settings, effectiveTz);
  const requestedMode = pickActionMode(settings);
  const mode = inHours ? requestedMode : 'label_only';

  for (const t of trackers as any[]) {
    const recips = [
      ...((t.to_recipients ?? []) as any[]).map((r: any) => r.emailAddress?.address).filter(Boolean),
      ...((t.cc_recipients ?? []) as any[]).map((r: any) => r.emailAddress?.address).filter(Boolean),
    ];

    const hasReply = settings.skip_if_replied && t.conversation_id
      ? await conversationHasReply(token, t.conversation_id, t.sent_at, recips, myEmail)
      : false;

    if (hasReply) {
      await supabase.from('follow_up_trackers').update({
        status: 'replied', replied_at: new Date().toISOString(),
      }).eq('id', t.id);
      replied++;
      continue;
    }

    // Not yet due → leave pending
    if (new Date(t.due_at) > new Date()) continue;

    // === Due, no reply: surface in Follow Up category (always) ===
    try {
      await supabase
        .from('categories')
        .update({ is_enabled: true, ai_draft_enabled: mode !== 'label_only' })
        .eq('connection_id', conn.id)
        .or('is_follow_up.eq.true,name.ilike.%follow up%,name.ilike.%follow-up%,name.ilike.%followup%');
    } catch (e) {
      console.warn('Auto-enable follow-up category failed', e);
    }

    if (!folderId) {
      folderId = await ensureFollowupFolder(token, conn.id, conn.inbox_followup_folder_id);
    }

    if (folderId) {
      await fetch(`https://graph.microsoft.com/v1.0/me/messages/${t.message_id}/move`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId: folderId }),
      }).catch(() => null);
    }

    // Label-only mode: stop here.
    if (mode === 'label_only') {
      const firstNudge = settings.reminder_intervals_days[0] ?? 1;
      await supabase.from('follow_up_trackers').update({
        status: 'missed',
        action_mode: 'label_only',
        next_reminder_at: new Date(Date.now() + firstNudge * 86400000).toISOString(),
      }).eq('id', t.id);
      labeled++;
      continue;
    }

    // Get original body for context
    let body = '';
    const fullRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${t.message_id}?$select=body,bodyPreview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (fullRes.ok) {
      const f = await fullRes.json();
      body = f.body?.content ?? f.bodyPreview ?? '';
    }

    const recipientName = ((t.to_recipients ?? [])[0]?.emailAddress?.name) ?? recips[0] ?? 'there';
    let html: string, promptTokens = 0, completionTokens = 0;
    try {
      const gen = await generateFollowUp(t.subject ?? '(no subject)', body, recipientName, t.days_after_send);
      html = gen.html; promptTokens = gen.promptTokens; completionTokens = gen.completionTokens;
    } catch (e) {
      console.error('AI generation failed', e);
      continue;
    }
    await logAiUsage(conn.organization_id, conn.user_id, 'gpt-4o-mini', 'follow_up_draft', promptTokens, completionTokens);

    const draftRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${t.message_id}/createReply`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    if (!draftRes.ok) {
      console.error('createReply failed', await draftRes.text());
      continue;
    }
    const draft = await draftRes.json();
    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: { contentType: 'HTML', content: `${html}<br><br><em style="color:#888;font-size:11px;">[InboxIQ follow-up — original BCC trigger: ${t.bcc_alias}, sent ${t.days_after_send} days ago]</em>` },
      }),
    });

    if (mode === 'auto_reply') {
      // Send the draft immediately.
      const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (sendRes.ok) {
        await supabase.from('follow_up_trackers').update({
          status: 'auto_sent',
          action_mode: 'auto_reply',
          auto_sent_at: new Date().toISOString(),
          draft_id: draft.id,
        }).eq('id', t.id);
        autoSent++;
      } else {
        console.error('auto-send failed', await sendRes.text());
        // Fall back to drafted state so user can send manually.
        await supabase.from('follow_up_trackers').update({
          status: 'drafted', action_mode: 'auto_draft',
          drafted_at: new Date().toISOString(), draft_id: draft.id,
        }).eq('id', t.id);
        drafted++;
      }
    } else {
      // auto_draft mode
      const firstNudge = settings.reminder_intervals_days[0] ?? 1;
      await supabase.from('follow_up_trackers').update({
        status: 'drafted',
        action_mode: 'auto_draft',
        drafted_at: new Date().toISOString(),
        draft_id: draft.id,
        next_reminder_at: new Date(Date.now() + firstNudge * 86400000).toISOString(),
      }).eq('id', t.id);
      drafted++;
    }

    await supabase.from('ai_activity_logs').insert({
      organization_id: conn.organization_id,
      user_id: conn.user_id,
      connection_id: conn.id,
      category_id: null,
      category_name: `Follow-up (${t.days_after_send}d)`,
      activity_type: mode === 'auto_reply' ? 'follow_up_auto_sent' : 'follow_up_draft',
      email_subject: t.subject,
      email_from: recips[0] ?? null,
    });
  }
  return { drafted, replied, autoSent, labeled };
}

// Send transactional reminder emails for drafted/missed follow-ups the user
// hasn't acted on. Up to settings.reminder_max_count nudges per tracker.
async function processMissedReminders(conn: Connection, settings: FollowUpSettings, recipientEmail: string | null) {
  if (settings.reminder_max_count <= 0) return 0;
  const { data: due } = await supabase
    .from('follow_up_trackers')
    .select('id,subject,bcc_alias,reminder_count,next_reminder_at,status,draft_id')
    .eq('connection_id', conn.id)
    .in('status', ['drafted', 'missed'])
    .lte('next_reminder_at', new Date().toISOString())
    .lt('reminder_count', settings.reminder_max_count)
    .limit(20);
  if (!due || due.length === 0) return 0;

  let sent = 0;
  for (const t of due) {
    const nextCount = (t.reminder_count ?? 0) + 1;
    const intervals = settings.reminder_intervals_days;
    const nextIdx = Math.min(nextCount, intervals.length - 1);
    const nextDays = intervals[nextIdx] ?? intervals[intervals.length - 1] ?? 7;

    if (recipientEmail) {
      try {
        await supabase.functions.invoke('send-transactional-email', {
          body: {
            templateName: 'follow-up-reminder',
            recipientEmail,
            idempotencyKey: `follow-up-reminder-${t.id}-${nextCount}`,
            templateData: {
              tracker_subject: t.subject ?? '(no subject)',
              bcc_alias: t.bcc_alias,
              reminder_number: nextCount,
              max_reminders: settings.reminder_max_count,
            },
          },
        });
      } catch (e) {
        console.warn('reminder email failed (non-fatal)', e);
      }
    }

    await supabase.from('follow_up_trackers').update({
      reminder_count: nextCount,
      last_reminder_at: new Date().toISOString(),
      next_reminder_at: nextCount >= settings.reminder_max_count
        ? null
        : new Date(Date.now() + nextDays * 86400000).toISOString(),
    }).eq('id', t.id);
    sent++;
  }
  return sent;
}

async function processConnection(conn: Connection): Promise<{ added: number; drafted: number; replied: number; autoSent: number; labeled: number; reminded: number; skipped: boolean }> {
  const empty = { added: 0, drafted: 0, replied: 0, autoSent: 0, labeled: 0, reminded: 0, skipped: false };
  if (conn.provider !== 'outlook') return { ...empty, skipped: true };

  const settings = await loadSettings(conn.id);
  if (!settings.is_enabled) return { ...empty, skipped: true };

  const token = await getValidToken(conn.user_id, conn.provider);
  if (!token) {
    console.log(`Skip ${conn.id}: no valid token`);
    return { ...empty, skipped: true };
  }

  const meRes = await fetch(`https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meRes.ok) return empty;
  const me = await meRes.json();
  const myEmail: string = (me.mail ?? me.userPrincipalName ?? conn.connected_email ?? '').toLowerCase();
  const ourDomain = myEmail.split('@')[1];
  if (!ourDomain) return empty;

  // Resolve effective timezone: explicit setting → Outlook mailbox tz → default.
  let effectiveTz = settings.timezone || '';
  if (!effectiveTz) {
    const mboxTz = await fetchMailboxTimezone(token);
    effectiveTz = mboxTz || 'America/New_York';
    // Cache it on the settings row so future runs skip the Graph call.
    if (mboxTz) {
      await supabase.from('follow_up_settings').update({ timezone: mboxTz }).eq('connection_id', conn.id);
    }
  }

  const added = await scanSentForTriggers(conn, token, ourDomain);
  const { drafted, replied, autoSent, labeled } = await processDueTrackers(conn, token, myEmail, settings, effectiveTz);
  // Missed-reminder *emails* (transactional reminders to the user) only
  // go out during business hours so we don't ping people overnight.
  const reminded = isWithinBusinessHours(settings, effectiveTz)
    ? await processMissedReminders(conn, settings, myEmail)
    : 0;
  return { added, drafted, replied, autoSent, labeled, reminded, skipped: false };
}

// Permission check: returns true if the user is allowed to use the
// Follow-Up Reminder feature. Wraps the public has_feature() RPC so
// permission revocations take effect immediately.
async function userHasFollowUpPermission(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_feature', {
    _user_id: userId,
    _feature_key: 'feature.follow_up_reminder',
  });
  if (error) {
    console.error('has_feature check failed', error);
    return false;
  }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Lifecycle: pause trackers belonging to users who have lost the permission,
    // and resume any that were paused but now have it again.
    const [{ data: paused }, { data: resumed }] = await Promise.all([
      supabase.rpc('pause_followups_without_permission'),
      supabase.rpc('resume_followups_with_permission'),
    ]);

    const { data: connections } = await supabase
      .from('provider_connections')
      .select('id,user_id,provider,organization_id,inbox_followup_folder_id,connected_email')
      .eq('is_connected', true);

    let totalAdded = 0, totalDrafted = 0, totalReplied = 0, totalAutoSent = 0, totalLabeled = 0, totalReminded = 0, processed = 0, skippedNoPermission = 0;
    for (const c of (connections ?? []) as Connection[]) {
      try {
        // Backend enforcement: skip BCC scanning + drafting for users without the feature.
        const allowed = await userHasFollowUpPermission(c.user_id);
        if (!allowed) {
          skippedNoPermission++;
          continue;
        }
        const r = await processConnection(c);
        totalAdded += r.added;
        totalDrafted += r.drafted;
        totalReplied += r.replied;
        totalAutoSent += r.autoSent;
        totalLabeled += r.labeled;
        totalReminded += r.reminded;
        processed++;
      } catch (e) {
        console.error(`connection ${c.id} failed:`, e);
      }
    }

    // Fire-and-forget: trigger the daily audit pass. The audit function
    // itself filters to connections that have daily_audit_enabled = true
    // and whose last_audit_at is older than 23h, so calling this every
    // 15 minutes is safe and idempotent.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/audit-inbox-followups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ mode: 'daily_cron' }),
      });
    } catch (e) {
      console.warn('daily audit kickoff failed', e);
    }

    return new Response(JSON.stringify({
      ok: true,
      processed,
      skipped_no_permission: skippedNoPermission,
      paused: paused ?? 0,
      resumed: resumed ?? 0,
      added: totalAdded,
      drafted: totalDrafted,
      replied: totalReplied,
      auto_sent: totalAutoSent,
      labeled: totalLabeled,
      reminded: totalReminded,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('cron-follow-ups error', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

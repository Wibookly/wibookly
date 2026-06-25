// Email Composer helper for the AI Chat inline composer.
// Actions:
//   - draft     : produce { subject, body } from a natural-language prompt
//   - contacts  : autocomplete recipients from Outlook /me/people
//   - signature : return the user's HTML signature for the composer
//   - send      : send through Outlook /me/sendMail
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGraph } from '../_shared/graph-call.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildSignature(p: any, userEmail: string | null): string {
  if (!p) return '';
  if (p.email_signature && String(p.email_signature).trim()) {
    return String(p.email_signature);
  }
  const name = p.full_name || '';
  const title = p.title || '';
  const phone = p.phone || '';
  const mobile = p.mobile || '';
  const website = p.website || '';
  const logo = p.signature_logo_url || '';
  const font = p.signature_font || 'Arial, sans-serif';
  const color = p.signature_color || '#333333';
  if (!name && !title && !phone && !mobile && !website && !logo) return '';
  const rows: string[] = [];
  if (phone) rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">📞</span></td><td style="padding:2px 0 2px 8px;">Main: ${phone}</td></tr>`);
  if (mobile) rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">📱</span></td><td style="padding:2px 0 2px 8px;">Mobile: ${mobile}</td></tr>`);
  if (website) {
    const clean = website.replace(/^https?:\/\//, '');
    rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">🌐</span></td><td style="padding:2px 0 2px 8px;"><a href="${website}" style="color:${color};text-decoration:none;">${clean}</a></td></tr>`);
  }
  if (userEmail) {
    rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">✉️</span></td><td style="padding:2px 0 2px 8px;"><a href="mailto:${userEmail}" style="color:${color};text-decoration:none;">${userEmail}</a></td></tr>`);
  }
  return `<div style="font-family:${font};font-size:14px;color:${color};">
  <p style="margin:0 0 12px 0;">Best regards,</p>
  <table cellpadding="0" cellspacing="0" border="0" style="font-family:${font};font-size:14px;color:${color};">
    <tr>
      ${logo ? `<td style="vertical-align:top;padding-right:16px;border-right:2px solid #e5e5e5;"><img src="${logo}" alt="Logo" style="max-height:80px;max-width:120px;"/></td>` : ''}
      <td style="vertical-align:top;${logo ? 'padding-left:16px;' : ''}">
        ${name ? `<div style="font-size:16px;font-weight:bold;color:${color};margin-bottom:2px;">${name}</div>` : ''}
        ${title ? `<div style="font-size:14px;color:#2563eb;margin-bottom:8px;">${title}</div>` : ''}
        <table cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:${color};">
          ${rows.join('')}
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

function normalizeDomain(value: string | null | undefined): string {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function recipientObjectsToEmails(value: any): string[] {
  return (Array.isArray(value) ? value : [])
    .map((r: any) => r?.emailAddress?.address ?? r?.address ?? '')
    .map((v: string) => String(v || '').trim())
    .filter(Boolean);
}

function parseFollowupAlias(addresses: string[], domains: Array<string | null | undefined>): { alias: string; days: number } | null {
  const allowedDomains = new Set(domains.map(normalizeDomain).filter(Boolean));
  if (allowedDomains.size === 0) return null;
  for (const raw of addresses) {
    const address = String(raw || '').trim().toLowerCase();
    const match = address.match(/^(\d+)@(.+)$/);
    if (!match || !allowedDomains.has(normalizeDomain(match[2]))) continue;
    const days = Number(match[1]);
    if (Number.isInteger(days) && days >= 1 && days <= 90) return { alias: address, days };
  }
  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function findRecentSentMessage(userId: string, connectionId: string, subject: string, sentAfterIso: string, to: string[]) {
  const wantedRecipients = new Set(to.map((email) => email.toLowerCase()));
  for (const delay of [1000, 1800, 3000]) {
    await sleep(delay);
    const res = await callGraph(userId, connectionId, 'mail',
      `/me/mailFolders/SentItems/messages?$filter=sentDateTime ge ${sentAfterIso}&$select=id,conversationId,subject,toRecipients,ccRecipients,bccRecipients,sentDateTime&$orderby=sentDateTime desc&$top=15`,
    );
    if (!res.ok) continue;
    const match = ((res.data as any)?.value || []).find((m: any) => {
      if (String(m.subject || '') !== subject) return false;
      const recipients = (m.toRecipients || [])
        .map((r: any) => String(r?.emailAddress?.address || '').toLowerCase())
        .filter(Boolean);
      return recipients.some((email: string) => wantedRecipients.has(email));
    });
    if (match) return match;
  }
  return null;
}

async function findRecentSentMessageByRecipients(userId: string, connectionId: string, sentAfterIso: string, to: string[], subject?: string) {
  const wantedRecipients = new Set(to.map((email) => email.toLowerCase()));
  const res = await callGraph(userId, connectionId, 'mail',
    `/me/mailFolders/SentItems/messages?$filter=sentDateTime ge ${sentAfterIso}&$select=id,conversationId,subject,toRecipients,ccRecipients,bccRecipients,sentDateTime&$orderby=sentDateTime desc&$top=25`,
  );
  if (!res.ok) return null;
  return ((res.data as any)?.value || []).find((m: any) => {
    if (subject && String(m.subject || '') !== subject) return false;
    const recipients = recipientObjectsToEmails(m.toRecipients).map((email) => email.toLowerCase());
    return recipients.some((email: string) => wantedRecipients.has(email));
  }) || null;
}

async function syncRecentBccTrackers(opts: {
  admin: any;
  userId: string;
  connectionId: string;
  organizationId: string;
  senderEmail: string | null;
  trackingDomains: string[];
  sentAfterIso: string;
}) {
  const res = await callGraph(opts.userId, opts.connectionId, 'mail',
    `/me/mailFolders/SentItems/messages?$filter=sentDateTime ge ${opts.sentAfterIso}&$select=id,conversationId,subject,toRecipients,ccRecipients,bccRecipients,sentDateTime&$orderby=sentDateTime desc&$top=25`,
  );
  if (!res.ok) return { scanned: 0, added: 0 };
  let scanned = 0;
  let added = 0;
  const senderDomain = normalizeDomain(opts.senderEmail?.split('@')[1]);
  const domains = Array.from(new Set([senderDomain, ...opts.trackingDomains].map(normalizeDomain).filter(Boolean)));
  for (const m of ((res.data as any)?.value || [])) {
    scanned++;
    const bccs = recipientObjectsToEmails(m.bccRecipients);
    const alias = parseFollowupAlias(bccs, domains);
    if (!alias) continue;
    const sentAt = new Date(m.sentDateTime || new Date().toISOString());
    const { error } = await opts.admin.from('follow_up_trackers').upsert({
      organization_id: opts.organizationId,
      connection_id: opts.connectionId,
      user_id: opts.userId,
      message_id: m.id,
      conversation_id: m.conversationId ?? null,
      subject: m.subject ?? null,
      to_recipients: m.toRecipients || [],
      cc_recipients: m.ccRecipients || [],
      bcc_alias: alias.alias,
      days_after_send: alias.days,
      sent_at: sentAt.toISOString(),
      due_at: new Date(sentAt.getTime() + alias.days * 86400000).toISOString(),
      status: 'pending',
      metadata: { source: 'email-compose-recent-sync' },
    }, { onConflict: 'connection_id,message_id,bcc_alias', ignoreDuplicates: true });
    if (!error) added++;
    else console.warn('recent follow-up tracker sync failed', error);
  }
  return { scanned, added };
}

async function draftWithLLM(prompt: string, senderName: string | null): Promise<{ subject: string; body: string; recipient_name: string; recipient_email: string }> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  const fallback = { subject: '', body: `<p>${prompt}</p>`, recipient_name: '', recipient_email: '' };
  if (!key) return fallback;
  const sys = `You convert a spoken/typed request into a ready-to-send business email. Reply ONLY with strict JSON of shape {"subject":"...","body":"<p>...</p>","recipient_name":"...","recipient_email":"..."}.
- subject: ≤ 80 chars, no quotes.
- body: clean HTML using <p> paragraphs, <ul><li> for lists, <strong>. Open with a brief greeting using the recipient's first name when known (e.g. "Hi Ali,"). Close with a sign-off line (e.g. "Thanks,"). DO NOT include the sender signature — that is added separately.
- recipient_name: the addressee mentioned in the prompt (e.g. "Ali", "John Smith"). Empty string if none.
- recipient_email: only if an explicit email address appears in the prompt; otherwise empty.
- Tone: concise, friendly, professional${senderName ? ` from ${senderName}` : ''}.
- Use the user's request verbatim for intent; do not invent facts.`;
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) return fallback;
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(txt);
    return {
      subject: String(parsed.subject || '').slice(0, 200),
      body: String(parsed.body || ''),
      recipient_name: String(parsed.recipient_name || '').slice(0, 120),
      recipient_email: String(parsed.recipient_email || '').slice(0, 200),
    };
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: cerr } = await supabase.auth.getClaims(token);
    if (cerr || !claims?.claims) return json({ error: 'Unauthorized' }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const connectionId = String(body?.connection_id || '');

    if (!action) return json({ error: 'action required' }, 400);

    // For everything except `draft`, we need a verified connection.
    let connEmail: string | null = null;
    let connOrgId: string | null = null;
    if (action !== 'draft') {
      if (!connectionId) return json({ error: 'connection_id required' }, 400);
      const { data: conn } = await supabase
        .from('provider_connections')
        .select('id, provider, connected_email, organization_id')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!conn || conn.provider !== 'outlook') return json({ error: 'Outlook connection not found' }, 404);
      connEmail = (conn as any).connected_email || null;
      connOrgId = (conn as any).organization_id || null;
    }

    if (action === 'draft') {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt) return json({ error: 'prompt required' }, 400);
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('user_id', userId)
        .maybeSingle();
      const draft = await draftWithLLM(prompt, (profile as any)?.full_name || null);
      return json({ ok: true, draft });
    }

    if (action === 'signature') {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, title, email_signature, phone, mobile, website, signature_logo_url, signature_font, signature_color')
        .eq('user_id', userId)
        .maybeSingle();
      const html = buildSignature(profile, connEmail);
      return json({ ok: true, signature: html, from_email: connEmail });
    }

    if (action === 'contacts') {
      const q = String(body?.query || '').trim();
      if (q.length < 1) return json({ ok: true, results: [] });
      const top = Math.min(Math.max(Number(body?.top) || 8, 1), 25);
      const endpoint = `/me/people?$search="${encodeURIComponent(q).replace(/"/g, '%22')}"&$top=${top}&$select=displayName,scoredEmailAddresses,emailAddresses,personType`;
      const res = await callGraph(userId, connectionId, 'user', endpoint, {
        headers: { ConsistencyLevel: 'eventual' },
      });
      if (!res.ok) return json({ ok: false, error: res.error?.message || 'people lookup failed' }, 500);
      const seen = new Set<string>();
      const results = ((res.data as any)?.value || []).flatMap((p: any) => {
        const emails = (p.scoredEmailAddresses?.length ? p.scoredEmailAddresses : p.emailAddresses) || [];
        return emails.map((e: any) => ({
          name: p.displayName || e.name || e.address,
          email: e.address,
          relevance: e.relevanceScore ?? null,
        }));
      }).filter((c: any) => {
        if (!c.email) return false;
        const k = c.email.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return json({ ok: true, results });
    }

    if (action === 'send') {
      const to: string[] = (Array.isArray(body?.to) ? body.to : []).filter((e: any) => typeof e === 'string' && e.includes('@'));
      if (!to.length) return json({ error: 'at least one valid To recipient is required' }, 400);
      const cc: string[] = (Array.isArray(body?.cc) ? body.cc : []).filter((e: any) => typeof e === 'string' && e.includes('@'));
      let bcc: string[] = (Array.isArray(body?.bcc) ? body.bcc : []).filter((e: any) => typeof e === 'string' && e.includes('@'));
      const subject = String(body?.subject || '').trim();
      const html = String(body?.body || '').trim();
      if (!subject) return json({ error: 'subject required' }, 400);
      if (!html) return json({ error: 'body required' }, 400);
      const senderDomain = normalizeDomain(connEmail?.split('@')[1]);
      let trackingDomain = senderDomain;
      try {
        const { data: settings } = await supabase
          .from('follow_up_settings')
          .select('is_enabled,bcc_domain')
          .eq('connection_id', connectionId)
          .eq('user_id', userId)
          .maybeSingle();
        const configuredDomain = normalizeDomain((settings as any)?.bcc_domain);
        trackingDomain = configuredDomain || senderDomain;
        const alreadyTracked = parseFollowupAlias(bcc, [senderDomain, configuredDomain]);
        if ((settings as any)?.is_enabled && trackingDomain && !alreadyTracked) {
          const alias = `3@${trackingDomain}`;
          bcc = bcc.some((v) => v.toLowerCase() === alias) ? bcc : [...bcc, alias];
        }
      } catch (e) {
        console.warn('follow-up settings lookup failed; sending without auto-BCC fallback', e);
      }
      const toRecip = (arr: string[]) => arr.map((a) => ({ emailAddress: { address: a } }));
      const message: Record<string, any> = {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: toRecip(to),
      };
      if (cc.length) message.ccRecipients = toRecip(cc);
      if (bcc.length) message.bccRecipients = toRecip(bcc);
      const sentAfterIso = new Date(Date.now() - 2 * 60_000).toISOString();
      const res = await callGraph(userId, connectionId, 'mail', '/me/sendMail', {
        method: 'POST',
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
      if (!res.ok) return json({ error: res.error?.message || 'send failed', code: res.error?.code }, res.status || 500);
      const alias = parseFollowupAlias(bcc, [senderDomain, trackingDomain]);
      if (alias && connOrgId) {
        try {
          const sentMessage = await findRecentSentMessage(userId, connectionId, subject, sentAfterIso, to);
          const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          const fallbackMessage = sentMessage || await findRecentSentMessageByRecipients(userId, connectionId, sentAfterIso, to);
          const sentAt = new Date(fallbackMessage?.sentDateTime || new Date().toISOString());
          const messageId = fallbackMessage?.id || `compose-${crypto.randomUUID()}`;
          const { error: trackerError } = await admin.from('follow_up_trackers').upsert({
            organization_id: connOrgId,
            connection_id: connectionId,
            user_id: userId,
            message_id: messageId,
            conversation_id: fallbackMessage?.conversationId ?? null,
            subject: fallbackMessage?.subject || subject,
            to_recipients: fallbackMessage?.toRecipients || message.toRecipients || [],
            cc_recipients: fallbackMessage?.ccRecipients || message.ccRecipients || [],
            bcc_alias: alias.alias,
            days_after_send: alias.days,
            sent_at: sentAt.toISOString(),
            due_at: new Date(sentAt.getTime() + alias.days * 86400000).toISOString(),
            status: 'pending',
            metadata: fallbackMessage?.id ? { source: 'email-compose' } : { source: 'email-compose-fallback', sent_item_lookup: 'not_found_yet' },
          }, { onConflict: 'connection_id,message_id,bcc_alias', ignoreDuplicates: true });
          if (trackerError) console.warn('follow-up tracker insert failed', trackerError);
          await syncRecentBccTrackers({
            admin,
            userId,
            connectionId,
            organizationId: connOrgId,
            senderEmail: connEmail,
            trackingDomains: [senderDomain, trackingDomain],
            sentAfterIso,
          });
        } catch (e) {
          console.warn('follow-up tracker insert after send failed', e);
        }
      }
      return json({ ok: true, sent_at: new Date().toISOString(), to, cc, bcc, subject });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

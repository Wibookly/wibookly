// Microsoft Graph webhook receiver for the shared Email Agent mailbox.
// PUBLIC ENDPOINT — verify_jwt = false (set in supabase/config.toml).
// Flow:
// 1. Graph POSTs change notifications when new mail lands in the shared mailbox.
// 2. We fetch each new message via Graph using app-only credentials (client credentials grant).
// 3. We validate the sender domain is in the org's allowed list — external senders are rejected silently.
// 4. We generate an AI reply via Lovable AI Gateway and reply via Graph.
// 5. Every step is logged to public.agent_messages for audit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const MS_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID')!;
const MS_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface GraphNotification {
  subscriptionId: string;
  changeType: string;
  resource: string;
  resourceData?: { id?: string; '@odata.type'?: string };
  clientState?: string;
  tenantId?: string;
}

async function getAppToken(tenantId: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

async function fetchMessage(token: string, mailboxUserId: string, messageId: string) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${messageId}?$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,conversationId,internetMessageId`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Fetch message failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function replyToMessage(token: string, mailboxUserId: string, messageId: string, html: string) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${messageId}/reply`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { body: { contentType: 'HTML', content: html } } }),
    }
  );
  if (!res.ok) throw new Error(`Reply failed: ${res.status} ${await res.text()}`);
}

async function buildCompanyContext(organizationId: string): Promise<string> {
  // Pull rules, categories, and recent activity to give the AI real org context
  const [{ data: cats }, { data: rules }, { data: connections }, { data: recentActivity }] = await Promise.all([
    supabase.from('categories').select('name,color,is_enabled,ai_draft_enabled,auto_reply_enabled,writing_style').eq('organization_id', organizationId).limit(50),
    supabase.from('rules').select('rule_type,rule_value,subject_contains,body_contains,is_enabled,category_id').eq('organization_id', organizationId).limit(100),
    supabase.from('provider_connections').select('connected_email,provider,is_connected').eq('organization_id', organizationId).limit(50),
    supabase.from('ai_activity_logs').select('category_name,activity_type,email_subject,email_from,created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(20),
  ]);

  const lines: string[] = [];
  lines.push(`Organization has ${connections?.length ?? 0} connected mailboxes:`);
  (connections ?? []).forEach((c) => lines.push(`  - ${c.connected_email} (${c.provider}, ${c.is_connected ? 'connected' : 'disconnected'})`));

  lines.push(`\nEmail categories (${cats?.length ?? 0}):`);
  (cats ?? []).forEach((c) =>
    lines.push(`  - ${c.name} [${c.is_enabled ? 'on' : 'off'}${c.ai_draft_enabled ? ', AI drafts on' : ''}${c.auto_reply_enabled ? ', auto-reply on' : ''}]`)
  );

  lines.push(`\nCategorization rules (${rules?.length ?? 0}):`);
  (rules ?? []).slice(0, 30).forEach((r) => {
    const cat = (cats ?? []).find((c: any) => false); // category id->name not joined here
    const detail =
      r.rule_type === 'sender' ? `from "${r.rule_value}"`
      : r.rule_type === 'recipient' ? `to "${r.rule_value}"`
      : r.subject_contains ? `subject contains "${r.subject_contains}"`
      : r.body_contains ? `body contains "${r.body_contains}"`
      : r.rule_value;
    lines.push(`  - ${r.is_enabled ? '✓' : '✗'} ${detail}`);
  });

  if (recentActivity && recentActivity.length > 0) {
    lines.push(`\nRecent AI activity:`);
    recentActivity.slice(0, 10).forEach((a) =>
      lines.push(`  - ${a.activity_type} on "${a.email_subject ?? '(no subject)'}" from ${a.email_from ?? '?'} → ${a.category_name}`)
    );
  }

  return lines.join('\n');
}

async function generateAIReply(question: string, senderEmail: string, organizationId: string): Promise<string> {
  let companyContext = '';
  try {
    companyContext = await buildCompanyContext(organizationId);
  } catch (e) {
    console.error('context build failed', e);
  }

  const systemPrompt = `You are InboxIQ, the internal AI assistant for this organization. You're replying via email to ${senderEmail}, an internal team member.

You have access to live company data below. Use it to answer questions about:
- Connected email accounts and integrations
- Email categorization rules and categories
- Recent AI activity (drafts, sent emails, categorizations)
- Inbox organization and best practices

If asked about something not in the context, say so honestly.

Reply in clean HTML suitable for email — short paragraphs, <ul> lists where helpful, no <html> or <body> wrapper. Be concise and professional.

=== LIVE COMPANY CONTEXT ===
${companyContext}
=== END CONTEXT ===`;

  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '<p>(no response)</p>';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function processNotification(n: GraphNotification) {
  // Look up the agent settings by graph_subscription_id
  const { data: settings, error } = await supabase
    .from('agent_settings')
    .select('*')
    .eq('graph_subscription_id', n.subscriptionId)
    .maybeSingle();

  if (error || !settings) {
    console.warn('No agent_settings found for subscription', n.subscriptionId);
    return;
  }
  if (!settings.email_agent_enabled) return;
  if (!settings.shared_mailbox_user_id || !settings.teams_tenant_id) {
    console.warn('Missing mailbox user id or tenant id');
    return;
  }

  const messageId = n.resourceData?.id;
  if (!messageId) return;

  const token = await getAppToken(settings.teams_tenant_id);
  const msg = await fetchMessage(token, settings.shared_mailbox_user_id, messageId);

  const senderEmail: string = msg.from?.emailAddress?.address?.toLowerCase() ?? '';
  const senderDomain = senderEmail.split('@')[1] ?? '';

  // Determine allowed domains: prefer agent_settings.allowed_sender_domains, else fall back to allowed_domains for this org
  let allowedDomains: string[] = (settings.allowed_sender_domains ?? []).map((d: string) => d.toLowerCase());
  if (allowedDomains.length === 0) {
    const { data: domains } = await supabase
      .from('allowed_domains')
      .select('domain')
      .eq('is_active', true);
    // We have no organization linkage on allowed_domains in this query; restrict by org via organization_name match through user_profiles
    // Simpler: collect domains tied to this org via user_profiles emails.
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('organization_id', settings.organization_id);
    const orgDomains = new Set<string>();
    (profiles ?? []).forEach((p) => {
      const d = (p.email ?? '').toLowerCase().split('@')[1];
      if (d) orgDomains.add(d);
    });
    allowedDomains = Array.from(orgDomains);
  }

  const isAllowed = allowedDomains.includes(senderDomain);

  // Log inbound
  const { data: inbound } = await supabase
    .from('agent_messages')
    .insert({
      organization_id: settings.organization_id,
      channel: 'email',
      direction: 'inbound',
      sender_email: senderEmail,
      sender_domain: senderDomain,
      subject: msg.subject ?? null,
      content: msg.bodyPreview ?? stripHtml(msg.body?.content ?? '').slice(0, 4000),
      external_message_id: msg.internetMessageId ?? messageId,
      conversation_id: msg.conversationId ?? null,
      status: isAllowed ? 'received' : 'rejected',
      rejected_reason: isAllowed ? null : 'sender_domain_not_allowed',
      metadata: { allowed_domains: allowedDomains },
    })
    .select('id')
    .single();

  if (!isAllowed) {
    console.log(`Rejected email from ${senderEmail} — domain not in allowed list`);
    return;
  }

  // Generate AI reply
  const question = stripHtml(msg.body?.content ?? msg.bodyPreview ?? '');
  const replyHtml = await generateAIReply(question, senderEmail, settings.organization_id);

  await replyToMessage(token, settings.shared_mailbox_user_id, messageId, replyHtml);

  await supabase.from('agent_messages').insert({
    organization_id: settings.organization_id,
    channel: 'email',
    direction: 'outbound',
    sender_email: settings.shared_mailbox_address,
    sender_domain: (settings.shared_mailbox_address ?? '').split('@')[1] ?? null,
    subject: msg.subject ? `Re: ${msg.subject}` : null,
    content: stripHtml(replyHtml).slice(0, 8000),
    response_to_id: inbound?.id ?? null,
    conversation_id: msg.conversationId ?? null,
    status: 'sent',
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Microsoft Graph validation handshake
  const url = new URL(req.url);
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  try {
    const body = await req.json();
    const notifications: GraphNotification[] = body.value ?? [];
    // Process sequentially; Graph allows up to 30s response time
    for (const n of notifications) {
      try {
        await processNotification(n);
      } catch (e) {
        console.error('processNotification error', e);
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('webhook error', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

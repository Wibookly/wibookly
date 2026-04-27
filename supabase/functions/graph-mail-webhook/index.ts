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
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY') ?? '';
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
    `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${messageId}?$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,conversationId,internetMessageId,receivedDateTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Fetch message failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Pull the last N messages in this conversation so the AI can see the full thread.
async function fetchConversation(token: string, mailboxUserId: string, conversationId: string, take = 10) {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages?$filter=${encodeURIComponent(`conversationId eq '${conversationId}'`)}&$orderby=receivedDateTime asc&$top=${take}&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      console.warn(`fetchConversation ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.value) ? data.value : [];
  } catch (e) {
    console.warn('fetchConversation error', e);
    return [];
  }
}

// Reply ONLY to the original sender (no CC/BCC of the rest of the thread).
async function replyToMessage(token: string, mailboxUserId: string, messageId: string, html: string, replyToEmail: string) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${messageId}/reply`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          // Force the reply to go to the original sender only — no CC/BCC of other thread participants.
          toRecipients: [{ emailAddress: { address: replyToEmail } }],
          ccRecipients: [],
          bccRecipients: [],
          body: { contentType: 'HTML', content: html },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Reply failed: ${res.status} ${await res.text()}`);
}

async function buildCompanyContext(organizationId: string): Promise<string> {
  // Lightweight org snapshot — only included as a small footer so the agent
  // can still answer "what's connected" / "what categories exist" if asked.
  const [{ data: cats }, { data: connections }] = await Promise.all([
    supabase.from('categories').select('name,is_enabled').eq('organization_id', organizationId).limit(50),
    supabase.from('provider_connections').select('connected_email,provider,is_connected').eq('organization_id', organizationId).limit(50),
  ]);

  const lines: string[] = [];
  lines.push(`Connected mailboxes (${connections?.length ?? 0}):`);
  (connections ?? []).forEach((c) => lines.push(`  - ${c.connected_email} (${c.provider})`));
  lines.push(`Email categories (${cats?.length ?? 0}): ${(cats ?? []).map((c) => c.name).join(', ')}`);
  return lines.join('\n');
}

interface ThreadMsg {
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  subject?: string;
  body?: { content?: string };
  bodyPreview?: string;
  receivedDateTime?: string;
}

function formatThreadForPrompt(thread: ThreadMsg[], currentMessageId: string, currentMsg: any): string {
  const all = thread.length > 0 ? thread : [currentMsg];
  const lines: string[] = [];
  all.forEach((m, idx) => {
    const from = m.from?.emailAddress?.address ?? 'unknown';
    const to = (m.toRecipients ?? []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(', ');
    const cc = (m.ccRecipients ?? []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(', ');
    const when = m.receivedDateTime ?? '';
    const body = stripHtml(m.body?.content ?? m.bodyPreview ?? '').slice(0, 4000);
    lines.push(`--- Message ${idx + 1} of ${all.length} (${when}) ---`);
    lines.push(`From: ${from}`);
    lines.push(`To: ${to}`);
    if (cc) lines.push(`Cc: ${cc}`);
    lines.push(`Subject: ${m.subject ?? ''}`);
    lines.push('');
    lines.push(body);
    lines.push('');
  });
  return lines.join('\n');
}

type AdminAIPrefs = {
  openai: string | null;
  claude: string | null;
  preference: 'auto' | 'openai' | 'claude';
  openaiModel: string;
  claudeModel: string;
  enableWebSearch: boolean;
};

async function loadAIPrefs(): Promise<AdminAIPrefs> {
  const { data } = await supabase
    .from('api_key_config')
    .select('key_name, encrypted_value')
    .in('key_name', [
      'openai_api_key', 'claude_api_key',
      'ai_provider_preference', 'ai_openai_model', 'ai_claude_model', 'ai_enable_web_search',
    ]);
  const map: Record<string, string> = {};
  (data ?? []).forEach((r: any) => { map[r.key_name] = (r.encrypted_value || '').trim(); });
  const pref = (map['ai_provider_preference'] || 'auto').toLowerCase();
  return {
    openai: map['openai_api_key'] || null,
    claude: map['claude_api_key'] || null,
    preference: (pref === 'openai' || pref === 'claude') ? pref : 'auto',
    openaiModel: map['ai_openai_model'] || 'gpt-4o-mini',
    claudeModel: map['ai_claude_model'] || 'claude-3-5-sonnet-latest',
    enableWebSearch: (map['ai_enable_web_search'] || 'true') !== 'false',
  };
}

async function generateAIReply(args: {
  threadText: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  organizationId: string;
}): Promise<{ content: string; provider: string; model: string; promptTokens: number; completionTokens: number }> {
  const { threadText, senderEmail, senderName, subject, organizationId } = args;
  let companyContext = '';
  try { companyContext = await buildCompanyContext(organizationId); } catch (e) { console.error('context build failed', e); }

  const prefs = await loadAIPrefs();

  const knowledgeRule = prefs.enableWebSearch
    ? `When the email asks a broad / technical / strategic question (e.g. "what technology should we use", "what's the best approach for X"), USE YOUR GENERAL KNOWLEDGE to give a concrete, opinionated answer. Recommend specific technologies, list pros/cons, and explain trade-offs. You do not have live internet access — be honest if a question requires very recent (post-training) information, but still give your best technical recommendation based on what you know.`
    : `Stay strictly within the email content and the small company context below. If the email asks something not covered, politely say you don't have enough information.`;

  const systemPrompt = `You are InboxIQ Agent — an executive AI assistant that answers emails forwarded to you by an internal team member.

WHO YOU'RE WRITING TO
You are replying ONLY to ${senderName || senderEmail} (${senderEmail}). They forwarded or CC'd you on an email thread. Your reply goes to them privately — never address other recipients of the original thread.

YOUR JOB
1. Read the FULL email thread below carefully.
2. Identify what ${senderName || 'the sender'} actually needs from you. It may be:
   - "Help me draft a reply to this" → produce a suggested reply they can send.
   - "What should I do about this?" → give clear, prioritized recommendations.
   - "Answer this technical question" → give a substantive technical answer.
   - "Summarize this thread" → give a concise summary + action items.
3. Anchor your answer in the actual content of the thread (people, dates, asks, technical details). Quote or reference specific lines when useful.
4. ${knowledgeRule}
5. Be substantive but not bloated. No filler ("I hope this helps..."), no apologies, no restating the obvious.

OUTPUT FORMAT
- Clean HTML for email body (no <html>/<body> wrapper).
- Use <p>, <ul>, <ol>, <strong>, <em>. Short paragraphs.
- If you're drafting a reply for them to send, wrap it in:
    <p><strong>Suggested reply:</strong></p>
    <blockquote>...the draft...</blockquote>
  followed by a short note explaining your reasoning.
- End with: <p>Reply <strong>"send it"</strong> if you'd like me to send this to the original recipients.</p>
  (Only include that line if you produced a draft reply.)

TONE
Sharp, professional, executive-level. Direct. No hedging language unless genuinely uncertain.

=== ORG SNAPSHOT (small, for reference only) ===
${companyContext}
=== END SNAPSHOT ===`;

  const userMessage = `Subject: ${subject}

Email thread (oldest → newest):

${threadText}

Now, based on the above, give me your best response. Remember: you're answering ME (${senderEmail}) privately, not the whole thread.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let providerUsed: 'openai' | 'claude' | 'lovable' | null = null;
  let modelUsed = '';
  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;

  const tryOpenAI = async () => {
    if (!prefs.openai) return false;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${prefs.openai}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: prefs.openaiModel, messages, temperature: 0.4 }),
    });
    if (!res.ok) { console.warn(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`); return false; }
    const data = await res.json();
    content = data.choices?.[0]?.message?.content ?? '';
    promptTokens = data.usage?.prompt_tokens ?? 0;
    completionTokens = data.usage?.completion_tokens ?? 0;
    providerUsed = 'openai'; modelUsed = prefs.openaiModel;
    return !!content;
  };

  const tryClaude = async () => {
    if (!prefs.claude) return false;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': prefs.claude, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: prefs.claudeModel, max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) { console.warn(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`); return false; }
    const data = await res.json();
    content = data.content?.[0]?.text ?? '';
    promptTokens = data.usage?.input_tokens ?? 0;
    completionTokens = data.usage?.output_tokens ?? 0;
    providerUsed = 'claude'; modelUsed = prefs.claudeModel;
    return !!content;
  };

  try {
    if (prefs.preference === 'openai') {
      await tryOpenAI();
    } else if (prefs.preference === 'claude') {
      await tryClaude();
    } else {
      const ok = await tryOpenAI();
      if (!ok) await tryClaude();
    }
  } catch (e) {
    console.warn('Primary provider error:', e);
  }

  if (!content && LOVABLE_API_KEY) {
    try {
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages }),
      });
      if (res.ok) {
        const data = await res.json();
        content = data.choices?.[0]?.message?.content ?? '';
        providerUsed = 'lovable'; modelUsed = 'google/gemini-2.5-flash';
      }
    } catch (e) {
      console.warn('Lovable AI fallback error:', e);
    }
  }

  if (!content) throw new Error('All AI providers failed. Configure OpenAI or Claude in Admin → Settings.');

  return { content, provider: providerUsed!, model: modelUsed, promptTokens, completionTokens };
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

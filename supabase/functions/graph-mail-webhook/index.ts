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
const ANTHROPIC_API_KEY_ENV = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const OPENAI_API_KEY_ENV = Deno.env.get('OPENAI_API_KEY') ?? '';
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

// (Legacy admin-UI key loader removed — Phase 1 router uses env vars
//  ANTHROPIC_API_KEY / OPENAI_API_KEY / LOVABLE_API_KEY directly.)


// ──────────────────────────────────────────────────────────────────
// Tiered model router
// ──────────────────────────────────────────────────────────────────
// We use the Lovable AI Gateway for cheap/mid tiers (Gemini Flash Lite
// → Gemini Flash) and Anthropic Claude direct for the "complex" tier.
// A lightweight classifier picks the tier based on email length, number
// of questions, and complexity keywords. The agent can also escalate
// itself if the cheap pass returns low-confidence content.
// Web search is performed via OpenAI's web-search-enabled model when the
// classifier flags the request as needing fresh / external information.

type ComplexityTier = 'cheap' | 'mid' | 'complex';

interface ClassifierResult {
  tier: ComplexityTier;
  needsWebSearch: boolean;
  reason: string;
}

const COMPLEX_KEYWORDS = [
  'analyze', 'analysis', 'compare', 'comparison', 'strategy', 'strategic',
  'recommend', 'recommendation', 'evaluate', 'evaluation', 'proposal',
  'draft a contract', 'legal', 'forecast', 'roadmap', 'architecture',
  'pros and cons', 'trade-off', 'tradeoff', 'deep dive', 'rfp', 'rfq',
  'business case', 'financial model', 'plan', 'market', 'competitor',
];

const WEB_KEYWORDS = [
  'latest', 'current', 'today', 'this week', 'this month', 'recent',
  'news', 'price of', 'stock', 'who is', 'what is the latest',
  'announcement', 'released', 'update on', 'status of',
];

function classifyEmail(threadText: string, subject: string): ClassifierResult {
  const t = `${subject}\n${threadText}`.toLowerCase();
  const wordCount = t.split(/\s+/).length;
  const questionMarks = (t.match(/\?/g) ?? []).length;
  const hasComplex = COMPLEX_KEYWORDS.some((k) => t.includes(k));
  const needsWebSearch = WEB_KEYWORDS.some((k) => t.includes(k));

  let tier: ComplexityTier = 'cheap';
  let reason = 'short / simple email';

  if (hasComplex || wordCount > 600 || questionMarks >= 3) {
    tier = 'complex';
    reason = hasComplex ? 'complex keyword detected' : `long thread (${wordCount}w / ${questionMarks}?)`;
  } else if (wordCount > 200 || questionMarks >= 2) {
    tier = 'mid';
    reason = `medium thread (${wordCount}w / ${questionMarks}?)`;
  }

  return { tier, needsWebSearch, reason };
}

interface AIProviderResult {
  content: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

async function callLovableAI(model: string, system: string, user: string): Promise<AIProviderResult | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`Lovable AI ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) return null;
    return {
      content,
      provider: 'lovable',
      model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  } catch (e) {
    console.warn(`Lovable AI ${model} error:`, e);
    return null;
  }
}

async function callClaude(apiKey: string, model: string, system: string, user: string): Promise<AIProviderResult | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      console.warn(`Claude ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const content = data.content?.[0]?.text ?? '';
    if (!content) return null;
    return {
      content,
      provider: 'claude',
      model,
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    };
  } catch (e) {
    console.warn(`Claude ${model} error:`, e);
    return null;
  }
}

async function callOpenAIWebSearch(apiKey: string, system: string, user: string): Promise<AIProviderResult | null> {
  // Uses OpenAI's web-search-enabled chat model. No tools array needed —
  // the model has built-in web grounding.
  const model = 'gpt-4o-mini-search-preview';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        web_search_options: {},
      }),
    });
    if (!res.ok) {
      console.warn(`OpenAI web-search ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) return null;
    return {
      content,
      provider: 'openai',
      model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  } catch (e) {
    console.warn('OpenAI web-search error:', e);
    return null;
  }
}

async function generateAIReply(args: {
  threadText: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  organizationId: string;
}): Promise<AIProviderResult & { tier: ComplexityTier; usedWebSearch: boolean }> {
  const { threadText, senderEmail, senderName, subject, organizationId } = args;
  let companyContext = '';
  try { companyContext = await buildCompanyContext(organizationId); } catch (e) { console.error('context build failed', e); }

  const classification = classifyEmail(threadText, subject);
  console.log(`[router] tier=${classification.tier} web=${classification.needsWebSearch} reason="${classification.reason}"`);

  const systemPrompt = `You are InboxIQ Agent — an executive AI assistant that answers emails forwarded to you by an internal team member.

WHO YOU'RE WRITING TO
You are replying ONLY to ${senderName || senderEmail} (${senderEmail}). They forwarded or CC'd you on an email thread. Your reply goes to them privately — never address other recipients of the original thread.

YOUR JOB
1. Read the FULL email thread carefully.
2. Identify what ${senderName || 'the sender'} actually needs from you. It may be:
   - "Help me draft a reply" → produce a suggested reply they can send.
   - "What should I do about this?" → give clear, prioritized recommendations.
   - "Answer this technical/strategic question" → give a substantive, opinionated answer with concrete recommendations.
   - "Summarize this thread" → concise summary + action items.
3. Anchor your answer in the actual content of the thread (people, dates, asks, technical details).
4. Use your full knowledge to give concrete, opinionated recommendations — name specific technologies, vendors, frameworks, numbers, and trade-offs. Avoid hedging unless genuinely uncertain.
5. Be substantive but not bloated. No filler, no apologies, no restating the obvious.

OUTPUT FORMAT
- Clean HTML for email body (no <html>/<body> wrapper).
- Use <p>, <ul>, <ol>, <strong>, <em>. Short paragraphs.
- If you're drafting a reply for them to send, wrap it in:
    <p><strong>Suggested reply:</strong></p>
    <blockquote>...the draft...</blockquote>
  followed by a short note explaining your reasoning.

TONE
Sharp, professional, executive-level. Direct.

=== ORG SNAPSHOT (small, for reference only) ===
${companyContext}
=== END SNAPSHOT ===`;

  const userMessage = `Subject: ${subject}

Email thread (oldest → newest):

${threadText}

Now, based on the above, give me your best response. Remember: you're answering ME (${senderEmail}) privately, not the whole thread.`;

  let result: AIProviderResult | null = null;

  // 1. If web search is needed AND we have an OpenAI key → use web-search model first
  if (classification.needsWebSearch && OPENAI_API_KEY_ENV) {
    result = await callOpenAIWebSearch(OPENAI_API_KEY_ENV, systemPrompt, userMessage);
    if (result) {
      return { ...result, tier: classification.tier, usedWebSearch: true };
    }
  }

  // 2. Tiered routing through Lovable AI Gateway / Anthropic
  if (classification.tier === 'cheap') {
    result = await callLovableAI('google/gemini-2.5-flash-lite', systemPrompt, userMessage);
  } else if (classification.tier === 'mid') {
    result = await callLovableAI('google/gemini-2.5-flash', systemPrompt, userMessage);
  } else {
    // complex → Claude Sonnet first (best reasoning), fall back to GPT-5 / Gemini Pro
    if (ANTHROPIC_API_KEY_ENV) {
      result = await callClaude(ANTHROPIC_API_KEY_ENV, 'claude-sonnet-4-5-20250929', systemPrompt, userMessage);
    }
    if (!result) {
      result = await callLovableAI('openai/gpt-5', systemPrompt, userMessage);
    }
    if (!result) {
      result = await callLovableAI('google/gemini-2.5-pro', systemPrompt, userMessage);
    }
  }

  // 3. If lower-tier returned something but it's suspiciously short → escalate
  if (result && classification.tier !== 'complex' && stripHtml(result.content).length < 200) {
    console.log('[router] cheap reply too short — escalating to Claude Sonnet');
    const escalated = ANTHROPIC_API_KEY_ENV
      ? await callClaude(ANTHROPIC_API_KEY_ENV, 'claude-sonnet-4-5-20250929', systemPrompt, userMessage)
      : await callLovableAI('openai/gpt-5', systemPrompt, userMessage);
    if (escalated) result = escalated;
  }

  // 4. Last-ditch fallback chain
  if (!result) {
    result = await callLovableAI('google/gemini-2.5-flash', systemPrompt, userMessage)
      ?? await callLovableAI('google/gemini-2.5-flash-lite', systemPrompt, userMessage);
  }

  if (!result) throw new Error('All AI providers failed.');

  return { ...result, tier: classification.tier, usedWebSearch: false };
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

  // ──────────────────────────────────────────────────────────────────
  // Idempotency guard: Microsoft Graph delivers the same change
  // notification multiple times (this is documented behaviour, not a
  // bug). Without a guard we replied 2-3× per inbound email. We claim
  // the message by inserting a marker row keyed on (organization, graph
  // message id). The unique index makes the second insert fail, and we
  // bail out before generating another AI reply.
  // ──────────────────────────────────────────────────────────────────
  const claimKey = `graph:${messageId}`;
  const { error: claimError } = await supabase
    .from('agent_messages')
    .insert({
      organization_id: settings.organization_id,
      channel: 'email',
      direction: 'inbound',
      sender_email: 'pending@graph',
      external_message_id: claimKey,
      status: 'processing',
      content: 'claim',
    });
  if (claimError) {
    // Duplicate delivery (unique violation) or transient db error — either
    // way, do NOT process this notification a second time.
    console.log(`Skipping duplicate Graph notification for ${messageId}: ${claimError.message}`);
    return;
  }

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
      external_message_id: `inbound:${msg.internetMessageId ?? messageId}`,
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

  // ──────────────────────────────────────────────────────────────────
  // Follow-up / silent-tracking guard.
  // The user CCs / BCCs aliases like "2@<their-domain>", "3@", "5@",
  // "7@", "10@", "14@" so that cron-follow-ups can schedule a reminder
  // N days later. These aliases forward to the shared agent mailbox.
  // The user does NOT want the agent to auto-reply to those tracking
  // emails — the only reply they expect is the AI-drafted follow-up
  // produced by cron-follow-ups when the timer fires.
  //
  // Detection (BCC-aware — Microsoft Graph hides BCC fields on the
  // delivered copy, so we can't read bccRecipients reliably):
  //   1. If ANY visible to/cc recipient matches the follow-up alias
  //      pattern (N@<allowed-domain>, N ∈ {2,3,5,7,10,14}) → skip.
  //   2. Otherwise, if the agent mailbox address is NOT in the visible
  //      to/cc list, the agent was BCC'd (silent recipient) → skip.
  //   3. The agent only auto-replies when it's an explicit to/cc
  //      recipient AND no follow-up alias is involved.
  // ──────────────────────────────────────────────────────────────────
  const FOLLOWUP_BUCKETS = new Set(['2', '3', '5', '7', '10', '14']);
  const visibleRecipientAddrs: string[] = [
    ...((msg.toRecipients ?? []) as Array<{ emailAddress?: { address?: string } }>),
    ...((msg.ccRecipients ?? []) as Array<{ emailAddress?: { address?: string } }>),
  ]
    .map((r) => (r?.emailAddress?.address ?? '').toLowerCase().trim())
    .filter(Boolean);

  const hasFollowupAlias = visibleRecipientAddrs.some((addr) => {
    const m = addr.match(/^(\d+)@(.+)$/);
    if (!m) return false;
    if (!FOLLOWUP_BUCKETS.has(m[1])) return false;
    return allowedDomains.includes(m[2]);
  });

  const agentAddr = (settings.shared_mailbox_address ?? '').toLowerCase().trim();
  const agentIsVisibleRecipient =
    !!agentAddr && visibleRecipientAddrs.includes(agentAddr);

  if (hasFollowupAlias || !agentIsVisibleRecipient) {
    const reason = hasFollowupAlias
      ? 'followup_alias_tracking_only'
      : 'bcc_silent_tracking_only';
    console.log(
      `Skipping AI reply for ${messageId} — ${reason} ` +
        `(visibleRecipients=${JSON.stringify(visibleRecipientAddrs)}, ` +
        `agent=${agentAddr})`,
    );
    if (inbound?.id) {
      await supabase
        .from('agent_messages')
        .update({ status: 'received', rejected_reason: reason })
        .eq('id', inbound.id);
    }
    return;
  }

  // Fetch the full conversation thread for context (so the agent sees what you forwarded)
  const thread = msg.conversationId
    ? await fetchConversation(token, settings.shared_mailbox_user_id, msg.conversationId, 10)
    : [];
  const threadText = formatThreadForPrompt(thread, messageId, msg);
  const senderName = msg.from?.emailAddress?.name ?? '';

  // Generate AI reply (focused on email content + thread)
  const aiResult = await generateAIReply({
    threadText,
    senderEmail,
    senderName,
    subject: msg.subject ?? '',
    organizationId: settings.organization_id,
  });
  const replyHtml = aiResult.content;

  // Reply ONLY to the person who emailed the agent — never CC/BCC the original recipients
  await replyToMessage(token, settings.shared_mailbox_user_id, messageId, replyHtml, senderEmail);

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
    metadata: {
      provider: aiResult.provider,
      model: aiResult.model,
      tier: aiResult.tier,
      web_search: aiResult.usedWebSearch,
      reply_to: senderEmail,
    },
  });

  // Log usage with approximate USD cost so the Admin → AI Usage dashboard
  // reflects live spend for the email-agent (agent@energyforward.com).
  try {
    const OPENAI_PRICE: Record<string, { input: number; output: number }> = {
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-4o-mini-search-preview': { input: 0.00015, output: 0.0006 },
      'gpt-4o': { input: 0.0025, output: 0.01 },
      'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
      'gpt-4.1': { input: 0.002, output: 0.008 },
    };
    const CLAUDE_PRICE: Record<string, { input: number; output: number }> = {
      'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
      'claude-3-5-sonnet-latest': { input: 0.003, output: 0.015 },
      'claude-3-5-haiku-latest': { input: 0.0008, output: 0.004 },
      'claude-3-opus-latest': { input: 0.015, output: 0.075 },
    };
    const table = aiResult.provider === 'openai' ? OPENAI_PRICE : aiResult.provider === 'claude' ? CLAUDE_PRICE : null;
    const p = table?.[aiResult.model] ?? { input: 0, output: 0 };
    const cost = (aiResult.promptTokens / 1000) * p.input + (aiResult.completionTokens / 1000) * p.output;
    await supabase.from('ai_usage_logs').insert({
      organization_id: settings.organization_id,
      user_id: null,
      provider: aiResult.provider,
      model: aiResult.model,
      action: 'agent_email_reply',
      prompt_tokens: aiResult.promptTokens,
      completion_tokens: aiResult.completionTokens,
      total_tokens: aiResult.promptTokens + aiResult.completionTokens,
      cost_usd: cost.toFixed(6),
      metadata: { sender: senderEmail },
    });
  } catch (e) { console.error('usage log failed', e); }
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

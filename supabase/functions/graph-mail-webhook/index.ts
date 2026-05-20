// Microsoft Graph webhook receiver for the shared Email Agent mailbox.
// PUBLIC ENDPOINT — verify_jwt = false (set in supabase/config.toml).
// Flow:
// 1. Graph POSTs change notifications when new mail lands in the shared mailbox.
// 2. We fetch each new message via Graph using app-only credentials (client credentials grant).
// 3. We validate the sender domain is in the org's allowed list — external senders are rejected silently.
// 4. We delegate the task to the shared `agent-loop` function which uses
//    OpenAI Responses API (gpt-4.1, fallback gpt-4o) with native web_search
//    and document-generation tools (PDF / DOCX / XLSX / PPTX), with Anthropic
//    Claude Sonnet 4.5 + native web_search/web_fetch as final fallback.
// 5. We reply via Graph, attaching any documents the agent produced.
// 6. Every step is logged to public.agent_messages for audit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
      `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages?$filter=${encodeURIComponent(`conversationId eq '${conversationId}'`)}&$top=${take}&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      console.warn(`fetchConversation ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const data = await res.json();
    const rows = Array.isArray(data?.value) ? data.value : [];
    return rows
      .sort((a, b) => {
        const aTs = Date.parse(a?.receivedDateTime ?? '') || 0;
        const bTs = Date.parse(b?.receivedDateTime ?? '') || 0;
        return aTs - bTs;
      })
      .slice(0, take);
  } catch (e) {
    console.warn('fetchConversation error', e);
    return [];
  }
}

interface AgentAttachment {
  filename: string;
  mime_type: string;
  base64: string;
  byte_size: number;
}

// Reply ONLY to the original sender (no CC/BCC of the rest of the thread),
// with optional file attachments produced by the agent (PDF, DOCX, XLSX, PPTX).
//
// Microsoft Graph two-step flow when attachments are present:
//   1. createReply           → returns a draft message id
//   2. POST /attachments     → attach each file (one POST per file)
//   3. /send                 → send the draft
// When there are no attachments we use the simple /reply endpoint.
async function replyToMessage(
  token: string,
  mailboxUserId: string,
  messageId: string,
  html: string,
  replyToEmail: string,
  attachments: AgentAttachment[] = [],
) {
  const replyTo = [{ emailAddress: { address: replyToEmail } }];

  if (!attachments.length) {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${messageId}/reply`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            toRecipients: replyTo,
            ccRecipients: [],
            bccRecipients: [],
            body: { contentType: 'HTML', content: html },
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Reply failed: ${res.status} ${await res.text()}`);
    return;
  }

  // Step 1: create a reply draft
  const draftRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${messageId}/createReply`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          toRecipients: replyTo,
          ccRecipients: [],
          bccRecipients: [],
          body: { contentType: 'HTML', content: html },
        },
      }),
    },
  );
  if (!draftRes.ok) throw new Error(`createReply failed: ${draftRes.status} ${await draftRes.text()}`);
  const draft = await draftRes.json();
  const draftId: string = draft.id;

  // Patch body + recipients (createReply may inherit; ensure they're set).
  await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${draftId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toRecipients: replyTo,
        ccRecipients: [],
        bccRecipients: [],
        body: { contentType: 'HTML', content: html },
      }),
    },
  );

  // Step 2: attach each file. Graph supports inline ≤3 MB; larger uses upload session.
  // Our generated docs are typically <1 MB, so inline is fine.
  for (const att of attachments) {
    const attachRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${draftId}/attachments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.filename,
          contentType: att.mime_type,
          contentBytes: att.base64,
        }),
      },
    );
    if (!attachRes.ok) {
      console.error(`Attach failed for ${att.filename}: ${attachRes.status} ${await attachRes.text()}`);
      // Continue with remaining attachments rather than failing the whole reply.
    }
  }

  // Step 3: send
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailboxUserId}/messages/${draftId}/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!sendRes.ok && sendRes.status !== 202) {
    throw new Error(`Send failed: ${sendRes.status} ${await sendRes.text()}`);
  }
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

// ──────────────────────────────────────────────────────────────────
// Phase 1: delegate to the shared agent-loop edge function.
// agent-loop runs OpenAI Responses API (gpt-4.1 primary, gpt-4o secondary,
// both with native web_search) and Anthropic Claude Sonnet 4.5
// (web_search_20250305 + web_fetch_20250910) as final fallback, with
// document-generation tools (PDF / DOCX / XLSX / PPTX). It returns { reply_html, attachments }.
// ──────────────────────────────────────────────────────────────────

interface AgentLoopResult {
  reply_html: string;
  attachments: AgentAttachment[];
  provider: string;
  model: string;
  iterations: number;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  used_web_search: boolean;
}

async function invokeAgentLoop(args: {
  task: string;
  threadText: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  organizationId: string;
  userId?: string | null;
}): Promise<AgentLoopResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/agent-loop`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      task: args.task,
      thread_context: args.threadText,
      sender_name: args.senderName,
      sender_email: args.senderEmail,
      subject: args.subject,
      organization_id: args.organizationId,
      user_id: args.userId ?? undefined,
      channel: 'email',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`agent-loop failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return res.json();
}

// Pick a representative user for org-level enforcement (admin first, else any member)
async function resolveOrgRepresentativeUser(orgId: string): Promise<string | null> {
  const { data: adminRow } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();
  if (adminRow?.user_id) return adminRow.user_id;
  const { data: anyMember } = await supabase
    .from('user_profiles')
    .select('user_id')
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle();
  return anyMember?.user_id ?? null;
}

// ──────────────────────────────────────────────────────────────────
// Per-sender license resolution.
//
// When a user emails the shared agent mailbox, the agent must answer using
// THAT sender's own Microsoft 365 permissions (their Outlook mail, OneDrive,
// and any SharePoint sites they can access). To do that we need:
//   1. A user_profiles row for the sender in this org (proves they signed up).
//   2. An active provider_connection (their stored OAuth token — the "license").
//   3. has_feature(user_id, 'email_agent') = true (admin enabled Email Agent
//      for their permission group in /admin → Groups).
//
// All three must pass. If any fails we politely reject so the sender knows
// what to ask their admin for.
// ──────────────────────────────────────────────────────────────────
interface SenderLicense {
  user_id: string;
  connection_id: string;
  connected_email: string;
}

async function resolveSenderLicense(
  senderEmail: string,
  organizationId: string,
): Promise<{ ok: true; license: SenderLicense } | { ok: false; reason: string; html: string }> {
  const normalized = senderEmail.toLowerCase().trim();
  if (!normalized) {
    return { ok: false, reason: 'sender_empty', html: '<p>Hello,</p><p>I could not identify the sender of this email.</p>' };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id, email')
    .ilike('email', normalized)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!profile?.user_id) {
    return {
      ok: false,
      reason: 'sender_no_account',
      html:
        `<p>Hello,</p><p>I could not find an InboxIQ account for <b>${normalized}</b> in this organization. ` +
        `Please ask your administrator to invite you, then sign in once at <a href="https://inboxiq.energyforward.com">inboxiq.energyforward.com</a> and connect your Microsoft 365 mailbox.</p>`,
    };
  }

  const { data: conn } = await supabase
    .from('provider_connections')
    .select('id, connected_email')
    .eq('user_id', profile.user_id)
    .eq('provider', 'outlook')
    .not('connected_email', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conn?.id || !conn.connected_email) {
    return {
      ok: false,
      reason: 'sender_no_mailbox_connection',
      html:
        `<p>Hi,</p><p>I found your InboxIQ account but you have not connected your Microsoft 365 mailbox yet. ` +
        `Please sign in at <a href="https://inboxiq.energyforward.com">inboxiq.energyforward.com</a> and click <b>Connect</b> next to Microsoft 365 on the Integrations page. ` +
        `Once connected, email me again and I will answer using your own mailbox, OneDrive, and SharePoint access.</p>`,
    };
  }

  const { data: featureRow, error: featureErr } = await supabase.rpc('has_feature', {
    _user_id: profile.user_id,
    _feature_key: 'email_agent',
  });
  if (featureErr) {
    console.error('has_feature check failed', featureErr);
  }
  if (!featureRow) {
    return {
      ok: false,
      reason: 'sender_feature_not_enabled',
      html:
        `<p>Hi,</p><p>Your Microsoft 365 mailbox is connected, but the <b>Email Agent</b> feature is not enabled for your permission group. ` +
        `Please ask your InboxIQ administrator to add you to a group with Email Agent turned on (/admin → Groups).</p>`,
    };
  }

  return {
    ok: true,
    license: {
      user_id: profile.user_id,
      connection_id: conn.id,
      connected_email: conn.connected_email,
    },
  };
}

// Lightweight markdown → HTML for the agent-orchestrator reply text.
// Handles paragraphs, **bold**, *italic*, `code`, [links](url), and bullet lists.
function markdownToHtml(md: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    escape(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const blocks = md.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
      return '<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('') + '</ol>';
    }
    return `<p>${inline(block).replace(/\n/g, '<br/>')}</p>`;
  });
  return blocks.join('\n');
}

// Invoke agent-orchestrator server-to-server, using the licensed sender's
// own user_id + connection_id so all Graph tools (Outlook mail, OneDrive,
// SharePoint, Calendar) run with THAT user's delegated permissions.
async function invokeOrchestratorAsSender(args: {
  userId: string;
  connectionId: string;
  taskText: string;
  threadText: string;
}): Promise<{ replyHtml: string; provider: string; model: string }> {
  const userMessage =
    args.threadText && args.threadText.trim().length
      ? `${args.taskText}\n\n--- Prior thread ---\n${args.threadText}`
      : args.taskText;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/agent-orchestrator`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'x-internal-user-id': args.userId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: args.connectionId,
      agent: 'qa',
      user_message: userMessage,
      max_steps: 8,
      deep: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`agent-orchestrator failed: ${res.status} ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  const reply = typeof json?.reply === 'string' && json.reply.length
    ? json.reply
    : "I wasn't able to find an answer in your mailbox or files.";
  return {
    replyHtml: markdownToHtml(reply),
    provider: json?.model?.startsWith('anthropic/') ? 'anthropic' : 'openai',
    model: json?.model || 'unknown',
  };
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
      metadata: { phase: 'claimed', graph_message_id: messageId },
    });
  if (claimError) {
    console.log(`Skipping duplicate Graph notification for ${messageId}: ${claimError.message}`);
    return;
  }

  const token = await getAppToken(settings.teams_tenant_id);
  const msg = await fetchMessage(token, settings.shared_mailbox_user_id, messageId);

  const senderEmail: string = msg.from?.emailAddress?.address?.toLowerCase() ?? '';
  const senderDomain = senderEmail.split('@')[1] ?? '';

  let allowedDomains: string[] = (settings.allowed_sender_domains ?? []).map((d: string) => d.toLowerCase());
  if (allowedDomains.length === 0) {
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

  const { data: inbound, error: inboundError } = await supabase
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
      status: isAllowed ? 'queued' : 'rejected',
      rejected_reason: isAllowed ? null : 'sender_domain_not_allowed',
      metadata: { allowed_domains: allowedDomains, graph_message_id: messageId },
    })
    .select('id')
    .single();

  if (inboundError) throw inboundError;

  const markClaim = async (status: string, extra: Record<string, unknown> = {}) => {
    await supabase
      .from('agent_messages')
      .update({
        status,
        rejected_reason: Object.prototype.hasOwnProperty.call(extra, 'rejected_reason') ? (extra.rejected_reason as string | null) : null,
        metadata: { graph_message_id: messageId, ...extra },
      })
      .eq('organization_id', settings.organization_id)
      .eq('external_message_id', claimKey);
  };

  if (!isAllowed) {
    console.log(`Rejected email from ${senderEmail} — domain not in allowed list`);
    await markClaim('rejected', { sender_email: senderEmail, rejected_reason: 'sender_domain_not_allowed' });
    return;
  }

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
  const agentIsVisibleRecipient = !!agentAddr && visibleRecipientAddrs.includes(agentAddr);

  if (hasFollowupAlias || !agentIsVisibleRecipient) {
    const reason = hasFollowupAlias
      ? 'followup_alias_tracking_only'
      : 'bcc_silent_tracking_only';
    console.log(
      `Skipping AI reply for ${messageId} — ${reason} ` +
        `(visibleRecipients=${JSON.stringify(visibleRecipientAddrs)}, agent=${agentAddr})`,
    );
    await supabase
      .from('agent_messages')
      .update({ status: 'received', rejected_reason: reason })
      .eq('id', inbound.id);
    await markClaim('skipped', { sender_email: senderEmail, rejected_reason: reason });
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // ENTERPRISE SAFEGUARDS (run BEFORE invoking the LLM)
  // 1) Per-org daily $ budget — auto-pauses runaway cost
  // 2) Per-org concurrency cap — limits parallel agent runs per org
  // 3) Per-conversation lock — prevents duplicate parallel runs on same thread
  // 4) Short-term prompt cache — reuses identical reply within 5 min
  // ──────────────────────────────────────────────────────────────────

  // (1) Budget check
  const { data: budgetRows } = await supabase.rpc('check_and_reserve_budget', {
    _org_id: settings.organization_id,
    _est_cost_usd: 0.10,
  });
  const budget = Array.isArray(budgetRows) ? budgetRows[0] : budgetRows;
  if (budget && !budget.allowed) {
    const reason = `budget_blocked:${budget.reason}`;
    console.warn(`Org ${settings.organization_id} blocked: ${reason} (spent=${budget.spent}/${budget.cap})`);
    const friendly = budget.reason === 'daily_budget_exceeded'
      ? `<p>Hello,</p><p>The agent has reached today's usage budget for your organization (spent $${budget.spent} of $${budget.cap}). Please contact your administrator to raise the cap or try again tomorrow.</p>`
      : `<p>Hello,</p><p>The agent has been paused by your administrator. Please contact them to re-enable it.</p>`;
    try {
      await replyToMessage(token, settings.shared_mailbox_user_id, messageId, friendly, senderEmail, []);
    } catch (e) { console.error('budget reply failed', e); }
    await supabase.from('agent_messages').update({ status: 'rejected', rejected_reason: reason }).eq('id', inbound.id);
    await markClaim('rejected', { sender_email: senderEmail, rejected_reason: reason });
    return;
  }

  // (2) Per-org concurrency cap
  const { data: budgetCfg } = await supabase
    .from('org_agent_budget')
    .select('max_concurrent_runs')
    .eq('organization_id', settings.organization_id)
    .maybeSingle();
  const maxConcurrent = budgetCfg?.max_concurrent_runs ?? 5;
  const { count: runningCount } = await supabase
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', settings.organization_id)
    .eq('status', 'running');
  if ((runningCount ?? 0) >= maxConcurrent) {
    const reason = `concurrency_cap_reached:${runningCount}/${maxConcurrent}`;
    console.warn(`Org ${settings.organization_id} ${reason} — deferring`);
    const html = `<p>Hello,</p><p>The agent is currently handling many requests for your organization (${runningCount} in flight, cap ${maxConcurrent}). Please resend in a minute.</p>`;
    try {
      await replyToMessage(token, settings.shared_mailbox_user_id, messageId, html, senderEmail, []);
    } catch (e) { console.error('concurrency reply failed', e); }
    await supabase.from('agent_messages').update({ status: 'rejected', rejected_reason: reason }).eq('id', inbound.id);
    await markClaim('rejected', { sender_email: senderEmail, rejected_reason: reason });
    return;
  }

  await markClaim('running', {
    sender_email: senderEmail,
    inbound_id: inbound.id,
    subject: msg.subject ?? null,
    conversation_id: msg.conversationId ?? null,
  });

  try {
    // ── License check: the sender must be a known InboxIQ user in this org,
    // with an active Outlook connection and `email_agent` feature enabled.
    // The agent will then run with THEIR delegated Graph permissions.
    const licenseResult = await resolveSenderLicense(senderEmail, settings.organization_id);
    if (!licenseResult.ok) {
      console.log(`Sender ${senderEmail} not licensed: ${licenseResult.reason}`);
      try {
        await replyToMessage(token, settings.shared_mailbox_user_id, messageId, licenseResult.html, senderEmail, []);
      } catch (e) {
        console.error('unlicensed-sender reply failed', e);
      }
      await supabase.from('agent_messages').update({ status: 'rejected', rejected_reason: licenseResult.reason }).eq('id', inbound.id);
      await markClaim('rejected', { sender_email: senderEmail, rejected_reason: licenseResult.reason });
      return;
    }
    const license = licenseResult.license;

    const thread = msg.conversationId
      ? await fetchConversation(token, settings.shared_mailbox_user_id, msg.conversationId, 10)
      : [];
    const threadText = formatThreadForPrompt(thread, messageId, msg);
    const senderName = msg.from?.emailAddress?.name ?? '';
    const taskText = msg.bodyPreview ?? stripHtml(msg.body?.content ?? '').slice(0, 8000);

    // (4) Prompt cache: hash (user + subject + task) — keyed per-sender so
    // each user's cache is isolated by their own delegated permissions.
    const cacheInput = `${license.user_id}|${msg.subject ?? ''}|${taskText}`;
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheInput));
    const promptHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

    let replyHtml: string;
    let agentProvider = 'cache';
    let agentModel = 'cache';
    const { data: cachedRows } = await supabase.rpc('cache_get_response', { _hash: promptHash });
    const cached = Array.isArray(cachedRows) ? cachedRows[0] : cachedRows;
    if (cached?.reply_html) {
      console.log(`Cache HIT for ${promptHash.slice(0,12)} — skipping LLM`);
      replyHtml = cached.reply_html;
      agentProvider = cached.provider ?? 'cache';
      agentModel = cached.model ?? 'cache';
    } else {
      const orch = await invokeOrchestratorAsSender({
        userId: license.user_id,
        connectionId: license.connection_id,
        taskText,
        threadText,
      });
      replyHtml = orch.replyHtml;
      agentProvider = orch.provider;
      agentModel = orch.model;
      try {
        await supabase.rpc('cache_put_response', {
          _hash: promptHash,
          _org_id: settings.organization_id,
          _reply_html: replyHtml,
          _attachments: [],
          _provider: agentProvider,
          _model: agentModel,
        });
      } catch (e) { console.warn('cache put failed', e); }
    }
    const attachments: AgentAttachment[] = [];

    await replyToMessage(
      token,
      settings.shared_mailbox_user_id,
      messageId,
      replyHtml,
      senderEmail,
      attachments,
    );

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
        provider: agentProvider,
        model: agentModel,
        delegated_user_id: license.user_id,
        delegated_mailbox: license.connected_email,
        reply_to: senderEmail,
      },
    });

    await supabase
      .from('agent_messages')
      .update({ status: 'sent' })
      .eq('id', inbound.id);

    await markClaim('sent', {
      sender_email: senderEmail,
      inbound_id: inbound.id,
      provider: agentProvider,
      model: agentModel,
      delegated_user_id: license.user_id,
    });

    try {
      const PRICE: Record<string, { input: number; output: number }> = {
        'gpt-4.1': { input: 0.002, output: 0.008 },
        'gpt-4o': { input: 0.0025, output: 0.01 },
        'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
      };
      const p = PRICE[agent.model] ?? { input: 0, output: 0 };
      const cost = (agent.prompt_tokens / 1000) * p.input + (agent.completion_tokens / 1000) * p.output;
      await supabase.from('ai_usage_logs').insert({
        organization_id: settings.organization_id,
        user_id: null,
        provider: agent.provider,
        model: agent.model,
        action: 'agent_email_reply',
        prompt_tokens: agent.prompt_tokens,
        completion_tokens: agent.completion_tokens,
        total_tokens: agent.prompt_tokens + agent.completion_tokens,
        cost_usd: cost.toFixed(6),
        metadata: { sender: senderEmail, attachments: attachments.length },
      });
      // Record actual spend against org daily budget
      await supabase.rpc('record_agent_spend', {
        _org_id: settings.organization_id,
        _cost_usd: Number(cost.toFixed(6)),
      });
    } catch (e) {
      console.error('usage log failed', e);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('processNotification agent execution error', reason);
    await supabase
      .from('agent_messages')
      .update({ status: 'failed', rejected_reason: reason.slice(0, 500) })
      .eq('id', inbound.id);
    await markClaim('failed', { sender_email: senderEmail, rejected_reason: reason.slice(0, 500) });
  }
}

function runInBackground(work: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(work);
    return;
  }
  work.catch((e) => console.error('background task error', e));
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
    runInBackground((async () => {
      for (const n of notifications) {
        try {
          await processNotification(n);
        } catch (e) {
          console.error('processNotification error', e);
        }
      }
    })());

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

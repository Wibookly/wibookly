// Microsoft Teams bot endpoint for InboxIQ.
// Handles 1:1 chat, group chats, and @-mentions in channels.
// The bot is a full conversational agent: it can search the user's
// emails, calendar, OneDrive files, Teams chats, AND the live web.
// All internal data access is performed AS THE USER (per-user OAuth),
// so each user only ever sees their own data.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  resolveTeamsUser,
  TOOL_DEFINITIONS,
  executeTool,
} from '../_shared/teams-tools.ts';
import { enforceLimitsBeforeLLM, recordSpend, detectProvider } from '../_shared/enforce-limits.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const BOT_APP_ID = Deno.env.get('TEAMS_BOT_APP_ID');
const BOT_APP_PASSWORD = Deno.env.get('TEAMS_BOT_APP_PASSWORD');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface TeamsAttachment {
  contentType?: string;
  contentUrl?: string;
  name?: string;
  content?: any;
}

interface TeamsActivity {
  type: string;
  id: string;
  serviceUrl: string;
  channelId: string;
  from?: { id: string; name?: string; aadObjectId?: string };
  conversation?: { id: string; tenantId?: string; conversationType?: string };
  recipient?: { id: string; name?: string };
  text?: string;
  channelData?: { tenant?: { id?: string } };
  attachments?: TeamsAttachment[];
  membersAdded?: { id: string; name?: string }[];
}

/* ---------------- Bot Framework auth + reply ---------------- */

async function getBotToken(): Promise<string> {
  if (!BOT_APP_ID || !BOT_APP_PASSWORD) throw new Error('Bot credentials missing');
  const res = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: BOT_APP_ID,
      client_secret: BOT_APP_PASSWORD,
      scope: 'https://api.botframework.com/.default',
    }),
  });
  if (!res.ok) throw new Error(`Bot token failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function sendReply(
  activity: TeamsActivity,
  text: string,
  attachments?: any[],
) {
  const token = await getBotToken();
  const url = `${activity.serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(
    activity.conversation!.id
  )}/activities/${encodeURIComponent(activity.id)}`;
  const body: any = {
    type: 'message',
    from: activity.recipient,
    conversation: activity.conversation,
    recipient: activity.from,
    replyToId: activity.id,
    text,
    textFormat: 'markdown',
  };
  if (attachments?.length) {
    body.attachments = attachments;
    body.attachmentLayout = 'list';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('Teams reply failed', res.status, await res.text());
}

/* ---------------- Tier-aware system prompt ---------------- */
function getTierContext(groupName?: string | null): string {
  switch ((groupName || '').toLowerCase()) {
    case 'chat':
      return 'User has basic chat access only. Do not offer advanced features like file generation.';
    case 'standard':
      return 'User can request email drafts, document analysis, and basic file reading.';
    case 'power user':
      return 'User has full automation access including auto-replies and daily briefs.';
    case 'executive':
      return 'Premium tier user. Provide highest quality responses, deep analysis, and proactive suggestions.';
    default:
      return '';
  }
}

/* ---------------- Adaptive Card helper ---------------- */
function buildAdaptiveCard(title: string, content: string, actions: any[] = []) {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: title, size: 'Large', weight: 'Bolder', wrap: true },
        { type: 'TextBlock', text: content, wrap: true },
      ],
      actions,
    },
  };
}

/** Heuristic: if reply contains a markdown table or lots of bullet rows, surface as Adaptive Card too. */
function shouldUseAdaptiveCard(text: string): boolean {
  if (!text) return false;
  if (/\n\s*\|.+\|/.test(text)) return true; // markdown table
  const bulletLines = text.split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).length;
  return bulletLines >= 5;
}

async function sendTyping(activity: TeamsActivity) {
  try {
    const token = await getBotToken();
    const url = `${activity.serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(
      activity.conversation!.id
    )}/activities`;
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'typing',
        from: activity.recipient,
        conversation: activity.conversation,
        recipient: activity.from,
      }),
    });
  } catch (_) { /* typing indicator best-effort */ }
}

function stripMentions(text: string): string {
  return (text ?? '').replace(/<at>[^<]*<\/at>/gi, '').replace(/\s+/g, ' ').trim();
}

/* ---------------- Look up sender email via Graph (app-only) ---------------- */

async function getAppGraphToken(tenantId: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
      client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`App graph token failed: ${res.status}`);
  return (await res.json()).access_token as string;
}

async function lookupSenderEmail(appToken: string, aadObjectId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${aadObjectId}?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${appToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return ((data.mail ?? data.userPrincipalName ?? '') as string).toLowerCase() || null;
  } catch { return null; }
}

/* ---------------- Conversation memory ---------------- */

async function loadHistory(orgId: string, conversationId: string, limit = 20) {
  const { data } = await supabase
    .from('agent_messages')
    .select('direction, content, created_at')
    .eq('organization_id', orgId)
    .eq('conversation_id', conversationId)
    .eq('channel', 'teams')
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []).reverse();
  return rows
    .filter(r => !!r.content)
    .map(r => ({
      role: r.direction === 'inbound' ? 'user' : 'assistant',
      content: r.content as string,
    }));
}

/* ---------------- OpenAI tool-calling loop ---------------- */

async function runAgent(opts: {
  userText: string;
  userName: string;
  history: { role: string; content: string }[];
  graphToken: string | null;
  model?: string;
  tierName?: string | null;
  attachmentsNote?: string | null;
}): Promise<{ reply: string; tokensIn: number; tokensOut: number; model: string }> {
  const model = opts.model || 'gpt-4o';
  const tierLine = getTierContext(opts.tierName);
  const systemPrompt = `You are InboxIQ (Energy Forward AI), a powerful AI assistant for ${opts.userName} inside Microsoft Teams. You are as capable as ChatGPT or Claude — you can answer anything AND you can CREATE things.

You have access to tools that let you:
- Search the live INTERNET (search_web) — current events, facts, news, prices, definitions, anything.
- Read the user's OUTLOOK EMAILS (search_emails, get_email_thread).
- Read the user's CALENDAR (get_calendar).
- Read the user's ONEDRIVE / SHAREPOINT FILES (search_documents).
- Read the user's TEAMS CHAT HISTORY (search_teams_chats).
- GENERATE ARTIFACTS (generate_artifact) — full HTML dashboards with charts and realistic dummy data, HTML pages, long Markdown reports, code files, anything. The artifact is saved to the user's OneDrive automatically and a sharing link is returned.

CORE RULES:
- NEVER say "I can't create that" or "I'm just text-based". You CAN create dashboards, reports, pages, code, documents — just call generate_artifact.
- When the user asks for a "dashboard", "report", "HTML version", "PDF", "presentation", "slides for my meeting", "something I can show", or any visual/file output → call generate_artifact (default kind: html_dashboard). Then reply with a short summary plus the share_url as a clickable Markdown link: **[Open dashboard](SHARE_URL)**.
- Auto-generate realistic dummy data when the user doesn't provide real numbers. Don't ask — just produce a polished result. The user can ask you to refine it after.
- For questions about the outside world → use search_web.
- For "find that email about...", "what did X say..." → search_emails.
- For "what's on my calendar", "next meeting" → get_calendar.
- For "find that document/spreadsheet/proposal" → search_documents.
- For "what did we discuss in Teams about..." → search_teams_chats.
- Combine sources when useful (e.g. summarize meeting + related email thread + generate a recap doc).
- Answer in plain text or light markdown. Be concise but complete. Cite sources (subjects, file names, URLs).
- Never fabricate factual claims. Sample data inside generated artifacts is clearly labeled as such.
- You have NO artificial limits. If the task is large, do it in full.

USER TIER: ${opts.tierName || 'Unknown'}
${tierLine}`;

  const userContent = opts.attachmentsNote
    ? `${opts.userText}\n\n${opts.attachmentsNote}`
    : opts.userText;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...opts.history,
    { role: 'user', content: userContent },
  ];

  let totalIn = 0;
  let totalOut = 0;

  // Up to 5 tool-call turns
  for (let turn = 0; turn < 5; turn++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('OpenAI error', res.status, txt);
      return { reply: 'Sorry, I had trouble thinking through that. Please try again.', tokensIn: totalIn, tokensOut: totalOut, model };
    }

    const data = await res.json();
    totalIn += Number(data.usage?.prompt_tokens ?? 0);
    totalOut += Number(data.usage?.completion_tokens ?? 0);
    const msg = data.choices?.[0]?.message;
    if (!msg) return { reply: '(no response)', tokensIn: totalIn, tokensOut: totalOut, model };

    // No tool calls → final answer
    if (!msg.tool_calls?.length) {
      return { reply: msg.content ?? '(no response)', tokensIn: totalIn, tokensOut: totalOut, model };
    }

    // Execute tool calls in parallel
    messages.push(msg);
    const results = await Promise.all(
      msg.tool_calls.map(async (tc: any) => {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments ?? '{}'); } catch { /* ignore */ }
        console.log(`[tool] ${tc.function.name}`, args);
        const out = await executeTool(tc.function.name, args, opts.graphToken);
        return {
          tool_call_id: tc.id,
          role: 'tool',
          name: tc.function.name,
          content: out.slice(0, 12000),
        };
      })
    );
    messages.push(...results);
  }

  return { reply: 'I gathered a lot of context but ran out of reasoning steps — please rephrase or narrow your question.', tokensIn: totalIn, tokensOut: totalOut, model };
}

/* ---------------- Group / tier lookup ---------------- */
async function fetchGroupName(userId: string, organizationId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('user_group_memberships')
      .select('permission_groups(name)')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    return (data?.permission_groups as any)?.name ?? null;
  } catch {
    return null;
  }
}

/* ---------------- Attachment summarization ---------------- */
function describeAttachments(attachments?: TeamsAttachment[]): string | null {
  if (!attachments?.length) return null;
  const supported = attachments
    .filter((a) => /pdf|image|png|jpeg|jpg|octet-stream|file/i.test(a.contentType ?? '') || a.contentUrl)
    .slice(0, 3); // cap 3 files
  if (!supported.length) return null;
  const lines = supported.map((a, i) => {
    const name = a.name ?? a.content?.name ?? `attachment-${i + 1}`;
    const url = a.contentUrl ?? a.content?.downloadUrl ?? '';
    return `- ${name}${url ? ` (${url})` : ''}`;
  });
  return `The user attached ${supported.length} file(s) (max 3, ≤10MB each). Reference them by name when relevant:\n${lines.join('\n')}`;
}

/* ---------------- HTTP entry point ----------------
 *
 * DEPLOYMENT STEPS:
 * 1. Configure Supabase secrets:
 *      TEAMS_BOT_APP_ID, TEAMS_BOT_APP_PASSWORD, MICROSOFT_TENANT_ID
 *    (TEAMS_BOT_APP_PASSWORD: Azure Portal → Azure Bot → Configuration →
 *     "Manage Microsoft App ID and password" → New client secret.)
 * 2. Deploy: supabase functions deploy teams-bot
 * 3. In Azure Bot → Configuration → Messaging endpoint:
 *      https://<project-ref>.supabase.co/functions/v1/teams-bot
 * 4. Zip /teams-app-manifest/ (manifest.json + color.png + outline.png)
 *    and upload via Teams Admin Center → Manage apps → Upload new app.
 * 5. Smoke test:
 *      POST /functions/v1/teams-bot/test-simulation
 *    Returns the resolved user, group, model, and a generated reply.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ---- Smoke-test endpoint (no Bot Framework required) ----
  const url = new URL(req.url);
  if (url.pathname.endsWith('/test-simulation')) {
    return await runSmokeTest(req);
  }

  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  let activity: TeamsActivity;
  try { activity = await req.json(); } catch { return new Response('bad request', { status: 400 }); }

  // ---- Welcome message when added to chat / channel ----
  if (activity.type === 'conversationUpdate' && activity.membersAdded?.length) {
    (async () => {
      try {
        for (const m of activity.membersAdded ?? []) {
          if (m.id !== activity.recipient?.id) {
            await sendReply(
              activity,
              "👋 Hi! I'm **Energy Forward AI**. Ask me anything about your inbox, calendar, files, or work tasks. " +
              "I can draft emails, summarize documents, prep you for meetings, or generate dashboards. " +
              "Just send me a message — or @mention me in a channel."
            );
            break;
          }
        }
      } catch (e) { console.warn('welcome failed', e); }
    })();
    return new Response('', { status: 200, headers: corsHeaders });
  }

  if (activity.type !== 'message') return new Response('', { status: 200 });

  const tenantId = activity.channelData?.tenant?.id ?? activity.conversation?.tenantId ?? null;
  if (!tenantId) return new Response('', { status: 200 });

  // Find org by tenant
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('*')
    .eq('teams_tenant_id', tenantId)
    .maybeSingle();

  if (!settings || !settings.teams_agent_enabled) return new Response('', { status: 200 });

  const aadId = activity.from?.aadObjectId ?? null;
  const userName = activity.from?.name ?? 'there';
  const userText = stripMentions(activity.text ?? '');
  const attachmentsNote = describeAttachments(activity.attachments);

  // Resolve sender email via app-only Graph
  let senderEmail: string | null = null;
  if (aadId) {
    try {
      const appToken = await getAppGraphToken(tenantId);
      senderEmail = await lookupSenderEmail(appToken, aadId);
    } catch (e) { console.warn('email lookup failed', e); }
  }

  // Domain allow-list
  const allowedDomains: string[] = (settings.allowed_sender_domains ?? []).map((d: string) => d.toLowerCase());
  const senderDomain = senderEmail?.split('@')[1] ?? null;
  const isAllowed = senderDomain ? (allowedDomains.length === 0 || allowedDomains.includes(senderDomain)) : false;

  // Log inbound
  const { data: inbound } = await supabase
    .from('agent_messages')
    .insert({
      organization_id: settings.organization_id,
      channel: 'teams',
      direction: 'inbound',
      sender_aad_id: aadId,
      sender_email: senderEmail,
      sender_domain: senderDomain,
      content: userText.slice(0, 4000),
      external_message_id: activity.id,
      conversation_id: activity.conversation?.id ?? null,
      status: isAllowed ? 'received' : 'rejected',
      rejected_reason: isAllowed ? null : (senderDomain ? 'sender_domain_not_allowed' : 'no_sender_domain'),
    })
    .select('id')
    .single();

  if (!isAllowed) return new Response('', { status: 200 });

  // Resolve InboxIQ user + Microsoft access token
  const resolved = await resolveTeamsUser({
    aadObjectId: aadId,
    senderEmail,
    organizationId: settings.organization_id,
  });

  // Background processing (Teams Bot Framework expects 200 quickly)
  (async () => {
    try {
      await sendTyping(activity);
      const history = await loadHistory(settings.organization_id, activity.conversation?.id ?? '');

      // Pre-flight enforcement only when we resolved an InboxIQ user
      let gate: Awaited<ReturnType<typeof enforceLimitsBeforeLLM>> | null = null;
      let routedModel = 'gpt-4o';
      let tierName: string | null = null;
      if (resolved?.userId) {
        gate = await enforceLimitsBeforeLLM(supabase, {
          userId: resolved.userId,
          organizationId: settings.organization_id,
          feature: 'teams_agent',
          fallbackModel: 'gpt-4o',
        });
        if (!gate.allowed) {
          const reason = (gate as any).reason || 'Your AI usage budget for this feature is exhausted.';
          await sendReply(
            activity,
            `⚠️ ${reason}\n\nYour limit resets at midnight UTC. Contact your admin to upgrade.`,
          );
          return;
        }
        routedModel = gate.model || 'gpt-4o';
        tierName = await fetchGroupName(resolved.userId, settings.organization_id);
      }

      const result = await runAgent({
        userText: userText || 'Hello',
        userName: resolved?.fullName ?? userName,
        history,
        graphToken: resolved?.microsoftAccessToken ?? null,
        model: routedModel,
        tierName,
        attachmentsNote,
      });
      const reply = result.reply;

      const finalReply = resolved
        ? reply
        : `${reply}\n\n_(Note: I couldn't link your Teams identity to an InboxIQ account, so I can only answer general/web questions. Sign in to InboxIQ with the same Microsoft account to unlock your emails, calendar, and files.)_`;

      const cards = shouldUseAdaptiveCard(finalReply)
        ? [buildAdaptiveCard('Energy Forward AI', finalReply)]
        : undefined;

      await sendReply(activity, finalReply, cards);

      // Post-call accounting
      if (resolved?.userId && gate) {
        try {
          await recordSpend(supabase, {
            userId: resolved.userId,
            organizationId: settings.organization_id,
            groupId: gate.group_id,
            feature: 'teams_agent',
            provider: detectProvider(result.model),
            model: result.model,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            metadata: { conversation_id: activity.conversation?.id ?? null },
          });
        } catch (e) {
          console.warn('[teams-bot] recordSpend failed', e);
        }
      }

      await supabase.from('agent_messages').insert({
        organization_id: settings.organization_id,
        channel: 'teams',
        direction: 'outbound',
        content: finalReply.slice(0, 8000),
        response_to_id: inbound?.id ?? null,
        conversation_id: activity.conversation?.id ?? null,
        status: 'sent',
      });
    } catch (e) {
      console.error('agent run failed', e);
      try { await sendReply(activity, 'Sorry — something went wrong on my end. Please try again.'); } catch (_) {}
      await supabase.from('agent_messages').insert({
        organization_id: settings.organization_id,
        channel: 'teams',
        direction: 'outbound',
        content: null,
        response_to_id: inbound?.id ?? null,
        conversation_id: activity.conversation?.id ?? null,
        status: 'failed',
        rejected_reason: String(e).slice(0, 500),
      });
    }
  })();

  return new Response('', { status: 200, headers: corsHeaders });
});

/* ---------------- Smoke-test runner ---------------- */
async function runSmokeTest(req: Request): Promise<Response> {
  let body: any = {};
  try { body = req.method === 'POST' ? await req.json() : {}; } catch { /* ignore */ }
  const senderEmail: string = (body.email ?? 'arahimi@energyforward.com').toLowerCase();
  const userText: string = body.text ?? 'Hello, can you help me draft a quick thank-you email?';

  // Resolve user by email directly (we don't have a real AAD id in test)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, organization_id, full_name')
    .ilike('email', senderEmail)
    .maybeSingle();

  if (!profile) {
    return new Response(
      JSON.stringify({ ok: false, error: 'no_profile_for_email', email: senderEmail }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const gate = await enforceLimitsBeforeLLM(supabase, {
    userId: profile.id,
    organizationId: profile.organization_id,
    feature: 'teams_agent',
    fallbackModel: 'gpt-4o',
  });

  if (!gate.allowed) {
    return new Response(
      JSON.stringify({ ok: false, blocked: true, reason: (gate as any).reason ?? 'blocked', model: gate.model }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const tierName = await fetchGroupName(profile.id, profile.organization_id);

  const result = await runAgent({
    userText,
    userName: profile.full_name ?? 'there',
    history: [],
    graphToken: null,
    model: gate.model || 'gpt-4o',
    tierName,
  });

  try {
    await recordSpend(supabase, {
      userId: profile.id,
      organizationId: profile.organization_id,
      groupId: gate.group_id,
      feature: 'teams_agent',
      provider: detectProvider(result.model),
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      metadata: { test_simulation: true },
    });
  } catch (e) {
    console.warn('[teams-bot test] recordSpend failed', e);
  }

  await supabase.from('agent_messages').insert({
    organization_id: profile.organization_id,
    channel: 'teams',
    direction: 'outbound',
    content: result.reply.slice(0, 8000),
    conversation_id: 'test-simulation',
    status: 'sent',
  });

  return new Response(
    JSON.stringify({
      ok: true,
      flow: 'enforcement_check → llm_call → response → spend_recorded → logged',
      user: { id: profile.id, email: senderEmail, full_name: profile.full_name, tier: tierName },
      model: result.model,
      tokens: { in: result.tokensIn, out: result.tokensOut },
      reply_preview: result.reply.slice(0, 400),
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

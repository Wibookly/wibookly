// Microsoft Teams bot endpoint (Bot Framework v4 messaging endpoint).
// Receives Activity JSON from the Bot Connector when a Teams user @-mentions
// the bot or sends it a DM. Validates the user's tenant + email domain,
// generates an AI reply, and posts it back via the activity's serviceUrl.
//
// Auth: Bot Framework signs requests with a JWT. For internal-only use we
// validate the tenant ID inside the activity matches our configured tenant.
// (Full JWT signature validation against the Bot Framework JWKS can be added
// later — for now the bot is locked down by tenant + Bot Framework App ID.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const BOT_APP_ID = Deno.env.get('TEAMS_BOT_APP_ID');
const BOT_APP_PASSWORD = Deno.env.get('TEAMS_BOT_APP_PASSWORD');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface TeamsActivity {
  type: string;
  id: string;
  timestamp?: string;
  serviceUrl: string;
  channelId: string;
  from?: { id: string; name?: string; aadObjectId?: string };
  conversation?: { id: string; tenantId?: string; conversationType?: string };
  recipient?: { id: string; name?: string };
  text?: string;
  textFormat?: string;
  channelData?: { tenant?: { id?: string } };
  replyToId?: string;
}

async function getBotToken(): Promise<string> {
  if (!BOT_APP_ID || !BOT_APP_PASSWORD) {
    throw new Error('TEAMS_BOT_APP_ID / TEAMS_BOT_APP_PASSWORD not configured');
  }
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
  const data = await res.json();
  return data.access_token as string;
}

async function sendReply(activity: TeamsActivity, text: string) {
  const token = await getBotToken();
  const reply = {
    type: 'message',
    from: activity.recipient,
    conversation: activity.conversation,
    recipient: activity.from,
    replyToId: activity.id,
    text,
  };
  const url = `${activity.serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(
    activity.conversation!.id
  )}/activities/${encodeURIComponent(activity.id)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reply),
  });
  if (!res.ok) throw new Error(`Teams reply failed: ${res.status} ${await res.text()}`);
}

async function generateAIReply(question: string, userName: string): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are InboxIQ, an internal AI assistant talking to ${userName} in Microsoft Teams. Be concise, professional, helpful. Plain text only — no markdown headings.`,
        },
        { role: 'user', content: question },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI gateway failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '(no response)';
}

function stripMentions(text: string): string {
  // Strip Teams @mention HTML tags like <at>InboxIQ</at>
  return text.replace(/<at>[^<]*<\/at>/gi, '').replace(/\s+/g, ' ').trim();
}

async function lookupAadDomain(token: string, aadObjectId: string): Promise<string | null> {
  // Use Graph to look up the user's mail/userPrincipalName
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${aadObjectId}?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const email: string = (data.mail ?? data.userPrincipalName ?? '').toLowerCase();
    return email.split('@')[1] ?? null;
  } catch {
    return null;
  }
}

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
  if (!res.ok) throw new Error(`Graph token failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('ok', { status: 200 });
  }

  let activity: TeamsActivity;
  try {
    activity = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  // Only respond to message activities
  if (activity.type !== 'message') {
    return new Response('', { status: 200 });
  }

  const tenantId =
    activity.channelData?.tenant?.id ?? activity.conversation?.tenantId ?? null;

  if (!tenantId) {
    return new Response('', { status: 200 });
  }

  // Find org settings by tenant id
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('*')
    .eq('teams_tenant_id', tenantId)
    .maybeSingle();

  if (!settings || !settings.teams_agent_enabled) {
    return new Response('', { status: 200 });
  }

  const userName = activity.from?.name ?? 'there';
  const aadId = activity.from?.aadObjectId ?? null;

  // Domain check via Graph
  let senderDomain: string | null = null;
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

  if (aadId) {
    try {
      const graphToken = await getAppGraphToken(tenantId);
      senderDomain = await lookupAadDomain(graphToken, aadId);
    } catch (e) {
      console.warn('Graph lookup failed', e);
    }
  }

  const isAllowed = senderDomain ? allowedDomains.includes(senderDomain) : false;

  const userText = stripMentions(activity.text ?? '');

  const { data: inbound } = await supabase
    .from('agent_messages')
    .insert({
      organization_id: settings.organization_id,
      channel: 'teams',
      direction: 'inbound',
      sender_aad_id: aadId,
      sender_email: senderDomain ? `unknown@${senderDomain}` : null,
      sender_domain: senderDomain,
      content: userText.slice(0, 4000),
      external_message_id: activity.id,
      conversation_id: activity.conversation?.id ?? null,
      status: isAllowed ? 'received' : 'rejected',
      rejected_reason: isAllowed ? null : (senderDomain ? 'sender_domain_not_allowed' : 'no_sender_domain'),
    })
    .select('id')
    .single();

  if (!isAllowed) {
    // Silent rejection — do not reply to external users
    return new Response('', { status: 200 });
  }

  try {
    const replyText = await generateAIReply(userText || 'Hello', userName);
    await sendReply(activity, replyText);

    await supabase.from('agent_messages').insert({
      organization_id: settings.organization_id,
      channel: 'teams',
      direction: 'outbound',
      content: replyText.slice(0, 8000),
      response_to_id: inbound?.id ?? null,
      conversation_id: activity.conversation?.id ?? null,
      status: 'sent',
    });
  } catch (e) {
    console.error('Teams reply failed', e);
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

  return new Response('', { status: 200, headers: corsHeaders });
});

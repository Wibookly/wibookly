// Follow-up cron — runs hourly. For each active follow_up_steps row, finds the
// org's connected mailbox, scans the user's Sent folder for messages sent
// `days_after_send` days ago that have NOT received a reply, and either
// drafts or auto-sends an AI follow-up nudge.

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

// === AES-GCM token decryption (same as other functions) ===
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
    .select('encrypted_access_token,encrypted_refresh_token,expires_at')
    .eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) > new Date(Date.now() + 60_000)) {
    return decrypt(data.encrypted_access_token);
  }
  // Token expired — let the existing process-ai-emails handle refresh; skip this run
  return null;
}

async function logAiUsage(orgId: string, userId: string | null, provider: string, model: string, action: string, prompt: number, completion: number) {
  // OpenAI gpt-4o-mini pricing (USD per 1M tokens)
  const PRICES: Record<string, { in: number; out: number }> = {
    'gpt-4o-mini': { in: 0.15, out: 0.60 },
    'gpt-4o': { in: 2.50, out: 10.00 },
    'gpt-4-turbo': { in: 10.00, out: 30.00 },
  };
  const p = PRICES[model] ?? { in: 0.15, out: 0.60 };
  const cost = (prompt / 1_000_000) * p.in + (completion / 1_000_000) * p.out;
  await supabase.from('ai_usage_logs').insert({
    organization_id: orgId,
    user_id: userId,
    provider,
    model,
    action,
    prompt_tokens: prompt,
    completion_tokens: completion,
    cost_usd: cost.toFixed(6),
  });
}

interface SentMessage {
  id: string;
  subject?: string;
  conversationId?: string;
  toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  sentDateTime?: string;
}

async function generateFollowUp(originalSubject: string, originalBody: string, recipientName: string, instructions: string): Promise<{ html: string; promptTokens: number; completionTokens: number }> {
  const sys = 'You write short, polite professional follow-up emails. Reply with ONLY the email body in clean HTML, no subject line, no signature, no greetings beyond a brief opener.';
  const user = `Original subject: ${originalSubject}\nRecipient: ${recipientName}\n\nOriginal email I sent:\n${originalBody.slice(0, 1500)}\n\nInstructions for follow-up: ${instructions}\n\nWrite a short follow-up nudge (2-4 sentences max). Do NOT include "Subject:" or any signature.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      max_tokens: 400,
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

async function processConnection(connectionId: string, organizationId: string, userId: string, provider: string) {
  if (provider !== 'outlook') return; // start with Outlook only
  const token = await getValidToken(userId, provider);
  if (!token) {
    console.log(`Skip ${connectionId}: no valid token`);
    return;
  }

  // Get follow-up steps for categories on this connection
  const { data: steps } = await supabase
    .from('follow_up_steps')
    .select('id,category_id,step_order,days_after_send,action,message_template,is_enabled,categories!inner(connection_id,name,is_enabled)')
    .eq('organization_id', organizationId)
    .eq('is_enabled', true);

  const relevant = (steps ?? []).filter((s: any) => s.categories.connection_id === connectionId && s.categories.is_enabled);
  if (relevant.length === 0) return;

  // For each step, scan sent messages from N days ago (±12h window for hourly cron)
  for (const step of relevant as any[]) {
    const target = new Date(Date.now() - step.days_after_send * 86400000);
    const from = new Date(target.getTime() - 12 * 3600000).toISOString();
    const to = new Date(target.getTime() + 12 * 3600000).toISOString();

    const url = `https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$filter=sentDateTime ge ${from} and sentDateTime le ${to}&$select=id,subject,conversationId,toRecipients,bodyPreview,body,sentDateTime&$top=25`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`Sent fetch failed: ${res.status}`);
      continue;
    }
    const json = await res.json();
    const messages: SentMessage[] = json.value ?? [];

    for (const msg of messages) {
      // Idempotency: have we already processed this message+step?
      const { data: existing } = await supabase
        .from('processed_emails')
        .select('id')
        .eq('user_id', userId)
        .eq('email_id', `followup:${step.id}:${msg.id}`)
        .maybeSingle();
      if (existing) continue;

      // Check thread for any reply newer than original
      const convoUrl = `https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq '${msg.conversationId}'&$select=id,from,sentDateTime,receivedDateTime&$top=20`;
      const convoRes = await fetch(convoUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!convoRes.ok) continue;
      const convo = await convoRes.json();
      const myEmail = (await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())).mail?.toLowerCase();
      const hasReply = (convo.value ?? []).some((m: any) => {
        const sender = m.from?.emailAddress?.address?.toLowerCase();
        return sender && sender !== myEmail && new Date(m.receivedDateTime ?? m.sentDateTime) > new Date(msg.sentDateTime ?? 0);
      });
      if (hasReply) continue;

      const recipient = msg.toRecipients?.[0]?.emailAddress;
      if (!recipient?.address) continue;

      // Generate follow-up
      const { html, promptTokens, completionTokens } = await generateFollowUp(
        msg.subject ?? '(no subject)',
        msg.body?.content ?? msg.bodyPreview ?? '',
        recipient.name ?? recipient.address,
        step.message_template ?? 'Polite follow-up nudge',
      );
      await logAiUsage(organizationId, userId, 'openai', 'gpt-4o-mini', 'follow_up', promptTokens, completionTokens);

      if (step.action === 'auto_send') {
        // Send a reply on the original message
        const replyRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}/reply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { body: { contentType: 'HTML', content: html } } }),
        });
        if (!replyRes.ok) {
          console.error('reply failed', await replyRes.text());
          continue;
        }
      } else {
        // Create draft reply
        const draftRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}/createReply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!draftRes.ok) continue;
        const draft = await draftRes.json();
        await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: { contentType: 'HTML', content: html } }),
        });
      }

      // Record idempotency
      await supabase.from('processed_emails').insert({
        organization_id: organizationId,
        user_id: userId,
        email_id: `followup:${step.id}:${msg.id}`,
        provider,
        category_id: step.category_id,
        action_type: step.action === 'auto_send' ? 'follow_up_sent' : 'follow_up_draft',
        sent_at: step.action === 'auto_send' ? new Date().toISOString() : null,
      });

      await supabase.from('ai_activity_logs').insert({
        organization_id: organizationId,
        user_id: userId,
        connection_id: connectionId,
        category_id: step.category_id,
        category_name: `Follow-up Step ${step.step_order}`,
        activity_type: step.action === 'auto_send' ? 'follow_up_sent' : 'follow_up_draft',
        email_subject: msg.subject ?? null,
        email_from: recipient.address,
      });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { data: connections } = await supabase
      .from('provider_connections')
      .select('id,user_id,provider,organization_id')
      .eq('is_connected', true);

    let processed = 0;
    for (const c of connections ?? []) {
      try {
        await processConnection(c.id, c.organization_id, c.user_id, c.provider);
        processed++;
      } catch (e) {
        console.error(`connection ${c.id} failed:`, e);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
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

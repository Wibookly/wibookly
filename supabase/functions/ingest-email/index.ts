// Ingest emails from Microsoft Graph or Gmail into email_threads / email_messages,
// then clean + embed bodies for RAG retrieval.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getValidAccessToken } from "../_shared/oauth-tokens.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface NormalizedMessage {
  external_id: string;
  thread_external_id: string;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  body_html: string | null;
  body_text: string | null;
  sent_at: string | null;
  is_from_me: boolean;
}

/* --------- Microsoft Graph --------- */
async function fetchOutlookMessages(token: string, max: number): Promise<NormalizedMessage[]> {
  const url = `https://graph.microsoft.com/v1.0/me/messages?$top=${Math.min(max, 50)}&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,toRecipients,ccRecipients,body,bodyPreview,sentDateTime,receivedDateTime,sender`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph messages: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${token}` } });
  const me = await meRes.json();
  const myEmail = (me.mail || me.userPrincipalName || '').toLowerCase();

  return (data.value || []).map((m: any): NormalizedMessage => ({
    external_id: m.id,
    thread_external_id: m.conversationId || m.id,
    subject: m.subject || null,
    from_email: m.from?.emailAddress?.address?.toLowerCase() || null,
    from_name: m.from?.emailAddress?.name || null,
    to_emails: (m.toRecipients || []).map((r: any) => r.emailAddress?.address?.toLowerCase()).filter(Boolean),
    cc_emails: (m.ccRecipients || []).map((r: any) => r.emailAddress?.address?.toLowerCase()).filter(Boolean),
    body_html: m.body?.contentType === 'html' ? m.body?.content : null,
    body_text: m.body?.contentType === 'text' ? m.body?.content : (m.bodyPreview || null),
    sent_at: m.sentDateTime || m.receivedDateTime || null,
    is_from_me: m.from?.emailAddress?.address?.toLowerCase() === myEmail,
  }));
}

/* --------- Gmail --------- */
function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  } catch { return ''; }
}

function extractGmailBody(payload: any): { html: string | null; text: string | null } {
  let html: string | null = null;
  let text: string | null = null;
  function walk(p: any) {
    if (!p) return;
    if (p.mimeType === 'text/html' && p.body?.data) html = html || decodeBase64Url(p.body.data);
    else if (p.mimeType === 'text/plain' && p.body?.data) text = text || decodeBase64Url(p.body.data);
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  }
  walk(payload);
  return { html, text };
}

function parseAddressList(header: string | undefined): { emails: string[]; firstName: string | null } {
  if (!header) return { emails: [], firstName: null };
  const parts = header.split(',').map(s => s.trim()).filter(Boolean);
  const emails: string[] = [];
  let firstName: string | null = null;
  for (const part of parts) {
    const m = part.match(/<([^>]+)>/);
    const email = (m ? m[1] : part).toLowerCase().trim();
    emails.push(email);
    if (firstName === null) {
      const nameMatch = part.match(/^"?([^"<]+?)"?\s*</);
      firstName = nameMatch ? nameMatch[1].trim() : null;
    }
  }
  return { emails, firstName };
}

async function fetchGmailMessages(token: string, max: number): Promise<NormalizedMessage[]> {
  const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const profile = await profileRes.json();
  const myEmail = (profile.emailAddress || '').toLowerCase();

  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${Math.min(max, 50)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!listRes.ok) throw new Error(`Gmail list: ${listRes.status} ${await listRes.text()}`);
  const list = await listRes.json();
  const ids: string[] = (list.messages || []).map((m: any) => m.id);

  const results: NormalizedMessage[] = [];
  for (const id of ids) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) continue;
    const m = await r.json();
    const headersArr = m.payload?.headers || [];
    const h = (name: string) => headersArr.find((x: any) => x.name?.toLowerCase() === name.toLowerCase())?.value;
    const from = parseAddressList(h('from'));
    const to = parseAddressList(h('to'));
    const cc = parseAddressList(h('cc'));
    const body = extractGmailBody(m.payload);
    const fromEmail = from.emails[0] || null;

    results.push({
      external_id: m.id,
      thread_external_id: m.threadId,
      subject: h('subject') || null,
      from_email: fromEmail,
      from_name: from.firstName,
      to_emails: to.emails,
      cc_emails: cc.emails,
      body_html: body.html,
      body_text: body.text,
      sent_at: m.internalDate ? new Date(parseInt(m.internalDate)).toISOString() : null,
      is_from_me: fromEmail === myEmail,
    });
  }
  return results;
}

/* --------- Edge fn helpers --------- */
async function callEdgeFn(name: string, body: any, jwt: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`${name} failed: ${res.status} ${txt}`);
    return null;
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const userJwt = authHeader.replace('Bearer ', '');

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { connection_id, max_messages = 25 } = await req.json();
    if (!connection_id) {
      return new Response(JSON.stringify({ error: 'connection_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load connection
    const { data: conn, error: connErr } = await admin
      .from('provider_connections')
      .select('id, user_id, organization_id, provider, is_connected')
      .eq('id', connection_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: 'Connection not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const provider = conn.provider === 'microsoft' ? 'outlook' : conn.provider;
    if (provider !== 'google' && provider !== 'outlook') {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const accessToken = await getValidAccessToken(user.id, provider as 'google' | 'outlook');
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'No valid access token. Please reconnect.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const messages = provider === 'outlook'
      ? await fetchOutlookMessages(accessToken, max_messages)
      : await fetchGmailMessages(accessToken, max_messages);

    let threadsCreated = 0;
    let messagesIngested = 0;
    let messagesEmbedded = 0;

    // Group by thread
    const byThread = new Map<string, NormalizedMessage[]>();
    for (const m of messages) {
      if (!byThread.has(m.thread_external_id)) byThread.set(m.thread_external_id, []);
      byThread.get(m.thread_external_id)!.push(m);
    }

    for (const [threadExtId, threadMsgs] of byThread.entries()) {
      // Upsert thread
      const subject = threadMsgs[0].subject;
      const participants = Array.from(new Set(
        threadMsgs.flatMap(m => [m.from_email, ...m.to_emails, ...m.cc_emails].filter(Boolean) as string[])
      ));
      const lastMessageAt = threadMsgs
        .map(m => m.sent_at).filter(Boolean).sort().pop() || new Date().toISOString();

      const { data: thread, error: threadErr } = await admin
        .from('email_threads')
        .upsert({
          connection_id: conn.id,
          user_id: conn.user_id,
          organization_id: conn.organization_id,
          provider_thread_id: threadExtId,
          subject,
          participants,
          message_count: threadMsgs.length,
          last_message_at: lastMessageAt,
        }, { onConflict: 'connection_id,provider_thread_id' })
        .select('id')
        .single();

      if (threadErr || !thread) {
        console.error('thread upsert error', threadErr);
        continue;
      }
      threadsCreated++;

      for (const m of threadMsgs) {
        // Skip if already exists
        const { data: existing } = await admin
          .from('email_messages')
          .select('id, embedding')
          .eq('connection_id', conn.id)
          .eq('provider_message_id', m.external_id)
          .maybeSingle();

        let messageId = existing?.id as string | undefined;

        if (!messageId) {
          const { data: inserted, error: msgErr } = await admin
            .from('email_messages')
            .insert({
              thread_id: thread.id,
              connection_id: conn.id,
              user_id: conn.user_id,
              organization_id: conn.organization_id,
              provider_message_id: m.external_id,
              from_email: m.from_email,
              from_name: m.from_name,
              to_emails: m.to_emails,
              cc_emails: m.cc_emails,
              subject: m.subject,
              body_html: m.body_html,
              body_text: m.body_text,
              sent_at: m.sent_at,
              is_from_me: m.is_from_me,
            })
            .select('id')
            .single();
          if (msgErr || !inserted) {
            console.error('message insert error', msgErr);
            continue;
          }
          messageId = inserted.id;
          messagesIngested++;
        }

        // Skip embedding if already done
        if (existing?.embedding) continue;

        // Clean
        const cleanRes = await callEdgeFn('clean-email', {
          html: m.body_html,
          text: m.body_text,
        }, userJwt);
        const cleanText: string = cleanRes?.cleaned || m.body_text || '';
        if (!cleanText.trim()) continue;

        // Embed
        const embedRes = await callEdgeFn('embed-text', {
          input: cleanText.slice(0, 8000),
        }, userJwt);
        const embedding = embedRes?.embeddings?.[0];
        if (!embedding) continue;

        await admin
          .from('email_messages')
          .update({ body_clean: cleanText, embedding })
          .eq('id', messageId);
        messagesEmbedded++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      provider,
      threads: threadsCreated,
      messages_ingested: messagesIngested,
      messages_embedded: messagesEmbedded,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('ingest-email error', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

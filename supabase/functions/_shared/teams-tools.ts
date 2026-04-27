// Shared tool implementations for the InboxIQ Teams bot.
// All Microsoft Graph calls run as the END USER (per-user OAuth tokens
// stored in oauth_token_vault, decrypted with TOKEN_ENCRYPTION_KEY).
// Web search runs through OpenAI's web-enabled chat model so we don't
// need a separate Perplexity / Firecrawl key.

const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

/* ---------------- token crypto (mirrors ai-assistant-chat) ---------------- */

async function decryptToken(encrypted: string, keyString: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const keyData = new TextEncoder().encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(out);
}
async function encryptToken(token: string, keyString: string): Promise<string> {
  const keyData = new TextEncoder().encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined = new Uint8Array(iv.length + new Uint8Array(enc).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function refreshMicrosoftToken(refreshToken: string) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
      client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  return await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
}

/* ---------------- user identity ---------------- */

export interface ResolvedUser {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  microsoftAccessToken: string | null;
}

/**
 * Resolve a Teams sender (AAD object id + email) to an InboxIQ user and a
 * valid Microsoft Graph access token belonging to that user.
 */
export async function resolveTeamsUser(opts: {
  aadObjectId: string | null;
  senderEmail: string | null;
  organizationId: string;
}): Promise<ResolvedUser | null> {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  // 1. Find profile by email (most reliable across SSO + manual signup)
  let profile: any = null;
  if (opts.senderEmail) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?email=eq.${encodeURIComponent(opts.senderEmail.toLowerCase())}&organization_id=eq.${opts.organizationId}&select=user_id,organization_id,email,full_name&limit=1`,
      { headers }
    );
    const arr = await r.json();
    if (Array.isArray(arr) && arr[0]) profile = arr[0];
  }

  if (!profile) return null;

  // 2. Load Microsoft tokens
  const tokRes = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_token_vault?user_id=eq.${profile.user_id}&provider=eq.outlook&select=*&limit=1`,
    { headers }
  );
  const tokens = await tokRes.json();
  let accessToken: string | null = null;

  if (Array.isArray(tokens) && tokens[0]) {
    const td = tokens[0];
    const expired = td.expires_at && new Date(td.expires_at) < new Date();
    if (!expired) {
      accessToken = await decryptToken(td.encrypted_access_token, TOKEN_ENCRYPTION_KEY);
    } else if (td.encrypted_refresh_token) {
      const refresh = await decryptToken(td.encrypted_refresh_token, TOKEN_ENCRYPTION_KEY);
      const fresh = await refreshMicrosoftToken(refresh);
      if (fresh) {
        accessToken = fresh.access_token;
        const updates: Record<string, string> = {
          encrypted_access_token: await encryptToken(fresh.access_token, TOKEN_ENCRYPTION_KEY),
          expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (fresh.refresh_token) {
          updates.encrypted_refresh_token = await encryptToken(fresh.refresh_token, TOKEN_ENCRYPTION_KEY);
        }
        await fetch(
          `${SUPABASE_URL}/rest/v1/oauth_token_vault?user_id=eq.${profile.user_id}&provider=eq.outlook`,
          { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(updates) }
        );
      }
    }
  }

  return {
    userId: profile.user_id,
    organizationId: profile.organization_id,
    email: profile.email,
    fullName: profile.full_name,
    microsoftAccessToken: accessToken,
  };
}

/* ---------------- Microsoft Graph helpers ---------------- */

async function graph<T = any>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Graph ${path} -> ${res.status} ${await res.text()}`);
  return await res.json() as T;
}

/* ---------------- Tools ---------------- */

export async function searchEmails(token: string, query: string, top = 8): Promise<string> {
  try {
    const data = await graph<any>(token,
      `/me/messages?$search="${encodeURIComponent(query)}"&$top=${top}&$select=subject,from,bodyPreview,receivedDateTime,webLink,conversationId`
    );
    if (!data.value?.length) return 'No emails found.';
    return data.value.map((m: any, i: number) => {
      const from = m.from?.emailAddress?.address ?? 'unknown';
      return `${i + 1}. [${m.receivedDateTime?.slice(0, 10)}] ${m.subject}\n   From: ${from}\n   ${(m.bodyPreview ?? '').slice(0, 200)}\n   Link: ${m.webLink ?? ''}`;
    }).join('\n\n');
  } catch (e) {
    return `Email search failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function getEmailThread(token: string, conversationId: string): Promise<string> {
  try {
    const data = await graph<any>(token,
      `/me/messages?$filter=conversationId eq '${conversationId}'&$orderby=receivedDateTime asc&$top=20&$select=subject,from,bodyPreview,receivedDateTime`
    );
    if (!data.value?.length) return 'Thread not found.';
    return data.value.map((m: any) =>
      `[${m.receivedDateTime?.slice(0, 16).replace('T', ' ')}] ${m.from?.emailAddress?.address}: ${m.bodyPreview?.slice(0, 300)}`
    ).join('\n---\n');
  } catch (e) {
    return `Thread fetch failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function getCalendarEvents(token: string, daysAhead = 7): Promise<string> {
  try {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + daysAhead * 86400000).toISOString();
    const data = await graph<any>(token,
      `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=20&$select=subject,start,end,location,attendees,organizer,bodyPreview&$orderby=start/dateTime`
    );
    if (!data.value?.length) return `No events in the next ${daysAhead} days.`;
    return data.value.map((e: any) => {
      const when = `${e.start?.dateTime?.slice(0, 16).replace('T', ' ')} → ${e.end?.dateTime?.slice(11, 16)}`;
      const att = (e.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean).slice(0, 5).join(', ');
      return `• ${when} — ${e.subject}\n  Location: ${e.location?.displayName ?? '—'}\n  Attendees: ${att || '—'}`;
    }).join('\n\n');
  } catch (e) {
    return `Calendar fetch failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function searchOneDrive(token: string, query: string): Promise<string> {
  try {
    const data = await graph<any>(token,
      `/me/drive/root/search(q='${encodeURIComponent(query)}')?$top=8&$select=name,webUrl,lastModifiedDateTime,size,file`
    );
    if (!data.value?.length) return 'No files found.';
    return data.value.map((f: any, i: number) =>
      `${i + 1}. ${f.name}\n   Modified: ${f.lastModifiedDateTime?.slice(0, 10)}\n   Link: ${f.webUrl}`
    ).join('\n\n');
  } catch (e) {
    return `OneDrive search failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function searchTeamsChats(token: string, query: string): Promise<string> {
  try {
    const data = await graph<any>(token, `/search/query`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          entityTypes: ['chatMessage'],
          query: { queryString: query },
          from: 0, size: 10,
        }],
      }),
    });
    const hits = data?.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
    if (!hits.length) return 'No Teams messages found.';
    return hits.map((h: any, i: number) => {
      const r = h.resource ?? {};
      const from = r.from?.user?.displayName ?? r.from?.emailAddress ?? 'unknown';
      const preview = (r.body?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
      return `${i + 1}. [${r.createdDateTime?.slice(0, 10)}] ${from}: ${preview}`;
    }).join('\n\n');
  } catch (e) {
    return `Teams chat search failed: ${e instanceof Error ? e.message : e}`;
  }
}

/* ---------------- Web search via OpenAI ----------------
 * Uses gpt-4o-search-preview which has built-in browsing.
 * No extra API key required.
 */
export async function webSearch(query: string): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-search-preview',
        messages: [
          { role: 'system', content: 'Answer the user query using fresh web information. Include 2-4 source URLs at the end.' },
          { role: 'user', content: query },
        ],
      }),
    });
    if (!res.ok) return `Web search failed: ${res.status} ${await res.text()}`;
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '(no web results)';
  } catch (e) {
    return `Web search failed: ${e instanceof Error ? e.message : e}`;
  }
}

/* ---------------- Tool registry for OpenAI function calling ---------------- */

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the live internet for current information, news, facts, prices, definitions, or anything that requires up-to-date public knowledge. Use this for any question about the outside world.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_emails',
      description: "Search the user's own Outlook mailbox by keyword, sender, subject, or content. Returns subject, sender, preview, date, and a link.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Free-text search (e.g. "invoice from acme last week")' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_email_thread',
      description: 'Fetch the full message thread for a given conversationId returned by search_emails.',
      parameters: {
        type: 'object',
        properties: { conversation_id: { type: 'string' } },
        required: ['conversation_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar',
      description: "Get the user's upcoming calendar events.",
      parameters: {
        type: 'object',
        properties: { days_ahead: { type: 'integer', description: 'How many days to look ahead (default 7)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: "Search the user's OneDrive / SharePoint files by name or content (Word, Excel, PowerPoint, PDF, etc.).",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_teams_chats',
      description: "Search the user's past Microsoft Teams chat and channel messages by keyword.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
];

export async function executeTool(
  name: string,
  args: any,
  graphToken: string | null,
): Promise<string> {
  switch (name) {
    case 'search_web':
      return await webSearch(args.query);
    case 'search_emails':
      if (!graphToken) return 'No Microsoft account connected — cannot read emails.';
      return await searchEmails(graphToken, args.query);
    case 'get_email_thread':
      if (!graphToken) return 'No Microsoft account connected.';
      return await getEmailThread(graphToken, args.conversation_id);
    case 'get_calendar':
      if (!graphToken) return 'No Microsoft account connected — cannot read calendar.';
      return await getCalendarEvents(graphToken, args.days_ahead ?? 7);
    case 'search_documents':
      if (!graphToken) return 'No Microsoft account connected — cannot read OneDrive.';
      return await searchOneDrive(graphToken, args.query);
    case 'search_teams_chats':
      if (!graphToken) return 'No Microsoft account connected — cannot read Teams chats.';
      return await searchTeamsChats(graphToken, args.query);
    default:
      return `Unknown tool: ${name}`;
  }
}

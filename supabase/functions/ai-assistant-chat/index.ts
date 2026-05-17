import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AES-GCM decryption for tokens
async function decryptToken(encryptedData: string, keyString: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  return new TextDecoder().decode(decrypted);
}

// AES-GCM encryption for tokens
async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(token)
  );
  
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

// Refresh Google access token
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) return null;
  return await response.json();
}

// Refresh Microsoft access token
async function refreshMicrosoftToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number } | null> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) return null;
  return await response.json();
}

interface TokenData {
  provider: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

// Get valid access token
async function getValidAccessToken(
  tokenData: TokenData,
  encryptionKey: string,
  userId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<string | null> {
  const isExpired = tokenData.expires_at && new Date(tokenData.expires_at) < new Date();
  
  if (!isExpired) {
    return await decryptToken(tokenData.encrypted_access_token, encryptionKey);
  }
  
  if (!tokenData.encrypted_refresh_token) return null;
  
  const refreshToken = await decryptToken(tokenData.encrypted_refresh_token, encryptionKey);
  let newTokens;
  
  if (tokenData.provider === 'google') {
    newTokens = await refreshGoogleToken(refreshToken);
  } else if (tokenData.provider === 'microsoft' || tokenData.provider === 'outlook') {
    newTokens = await refreshMicrosoftToken(refreshToken);
  }
  
  if (!newTokens) return null;
  
  const encryptedAccessToken = await encryptToken(newTokens.access_token, encryptionKey);
  const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
  
  const updatePayload: Record<string, string> = {
    encrypted_access_token: encryptedAccessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };
  
  if ((tokenData.provider === 'microsoft' || tokenData.provider === 'outlook') && 'refresh_token' in newTokens && newTokens.refresh_token) {
    updatePayload.encrypted_refresh_token = await encryptToken(String(newTokens.refresh_token), encryptionKey);
  }
  
  await fetch(
    `${supabaseUrl}/rest/v1/oauth_token_vault?user_id=eq.${userId}&provider=eq.${tokenData.provider}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updatePayload)
    }
  );
  
  return newTokens.access_token;
}

interface EmailResultData {
  id: string;
  subject: string;
  from: string;
  preview: string;
  date: string;
  webLink?: string;
}

// Search Gmail emails
async function searchGmailEmails(accessToken: string, query: string, maxResults: number = 20): Promise<{ text: string; structured: EmailResultData[] }> {
  try {
    const searchQuery = encodeURIComponent(query);
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQuery}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!listRes.ok) return { text: "Failed to search emails", structured: [] };
    
    const listData = await listRes.json();
    if (!listData.messages?.length) return { text: "No emails found matching your search.", structured: [] };
    
    const results: string[] = [];
    const structured: EmailResultData[] = [];
    
    for (const msg of listData.messages.slice(0, 10)) {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (detailRes.ok) {
        const detail = await detailRes.json();
        const headers = detail.payload?.headers || [];
        const from = headers.find((h: { name: string }) => h.name === 'From')?.value || '';
        const subject = headers.find((h: { name: string }) => h.name === 'Subject')?.value || '';
        const dateStr = headers.find((h: { name: string }) => h.name === 'Date')?.value || '';
        
        // Get body content
        let body = '';
        if (detail.payload?.body?.data) {
          body = atob(detail.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        } else if (detail.payload?.parts) {
          for (const part of detail.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
              break;
            }
          }
        }
        
        // Check for attachments
        const attachments: string[] = [];
        if (detail.payload?.parts) {
          for (const part of detail.payload.parts) {
            if (part.filename && part.filename.length > 0) {
              attachments.push(part.filename);
            }
          }
        }
        
        // Format date nicely
        const parsedDate = new Date(dateStr);
        const formattedDate = parsedDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        // Add structured data
        structured.push({
          id: msg.id,
          subject: subject,
          from: from.replace(/<[^>]*>/g, '').trim(),
          preview: body.replace(/<[^>]*>/g, '').slice(0, 200),
          date: formattedDate,
          webLink: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`
        });
        
        results.push(`
---
From: ${from}
Subject: ${subject}
Date: ${dateStr}
${attachments.length > 0 ? `Attachments: ${attachments.join(', ')}` : ''}
Content: ${body.slice(0, 500)}${body.length > 500 ? '...' : ''}
---`);
      }
    }
    
    return { text: results.join('\n'), structured };
  } catch (error) {
    console.error('Error searching Gmail:', error);
    return { text: "Error searching emails", structured: [] };
  }
}

// Search Outlook emails
async function searchOutlookEmails(accessToken: string, query: string, maxResults: number = 20): Promise<{ text: string; structured: EmailResultData[] }> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(query)}"&$top=${maxResults}&$select=id,subject,from,bodyPreview,receivedDateTime,hasAttachments,webLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) return { text: "Failed to search emails", structured: [] };
    
    const data = await res.json();
    if (!data.value?.length) return { text: "No emails found matching your search.", structured: [] };
    
    const structured: EmailResultData[] = data.value.map((msg: {
      id?: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      bodyPreview?: string;
      webLink?: string;
    }) => ({
      id: msg.id || '',
      subject: msg.subject || '',
      from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || '',
      preview: msg.bodyPreview || '',
      date: new Date(msg.receivedDateTime || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      webLink: msg.webLink
    }));
    
    const results = data.value.map((msg: {
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      bodyPreview?: string;
    }) => `
---
From: ${msg.from?.emailAddress?.name || ''} <${msg.from?.emailAddress?.address || ''}>
Subject: ${msg.subject || ''}
Date: ${msg.receivedDateTime || ''}
Content: ${msg.bodyPreview || ''}
---`);
    
    return { text: results.join('\n'), structured };
  } catch (error) {
    console.error('Error searching Outlook:', error);
    return { text: "Error searching emails", structured: [] };
  }
}

// Fetch calendar events
async function fetchCalendarEvents(accessToken: string, provider: string, daysAhead: number = 7): Promise<string> {
  try {
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    
    if (provider === 'google') {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${future.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (!res.ok) return "Failed to fetch calendar";
      
      const data = await res.json();
      if (!data.items?.length) return "No upcoming calendar events.";
      
      return data.items.map((event: {
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        location?: string;
        attendees?: { email: string }[];
      }) => {
        const start = new Date(event.start?.dateTime || event.start?.date || '');
        const end = new Date(event.end?.dateTime || event.end?.date || '');
        return `- ${start.toLocaleDateString()} ${start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}: ${event.summary || 'No title'}${event.location ? ` (${event.location})` : ''}${event.attendees?.length ? ` with ${event.attendees.map(a => a.email).join(', ')}` : ''}`;
      }).join('\n');
    } else {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${future.toISOString()}&$select=subject,start,end,location,attendees&$orderby=start/dateTime&$top=20`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (!res.ok) return "Failed to fetch calendar";
      
      const data = await res.json();
      if (!data.value?.length) return "No upcoming calendar events.";
      
      return data.value.map((event: {
        subject?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        location?: { displayName?: string };
        attendees?: { emailAddress: { address: string } }[];
      }) => {
        const start = new Date(event.start?.dateTime || '');
        const end = new Date(event.end?.dateTime || '');
        return `- ${start.toLocaleDateString()} ${start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}: ${event.subject || 'No title'}${event.location?.displayName ? ` (${event.location.displayName})` : ''}`;
      }).join('\n');
    }
  } catch (error) {
    console.error('Error fetching calendar:', error);
    return "Error fetching calendar";
  }
}

// Get recent emails summary
async function getRecentEmailsSummary(accessToken: string, provider: string, count: number = 10): Promise<string> {
  try {
    if (provider === 'google') {
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${count}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (!listRes.ok) return "Failed to fetch recent emails";
      
      const listData = await listRes.json();
      if (!listData.messages?.length) return "No recent emails.";
      
      const results: string[] = [];
      for (const msg of listData.messages.slice(0, count)) {
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        
        if (detailRes.ok) {
          const detail = await detailRes.json();
          const headers = detail.payload?.headers || [];
          const from = headers.find((h: { name: string }) => h.name === 'From')?.value || '';
          const subject = headers.find((h: { name: string }) => h.name === 'Subject')?.value || '';
          const isUnread = detail.labelIds?.includes('UNREAD') ? '📬' : '📭';
          results.push(`${isUnread} From: ${from.replace(/<[^>]*>/g, '').trim()} | Subject: ${subject}`);
        }
      }
      
      return results.join('\n');
    } else {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?$top=${count}&$select=subject,from,isRead,receivedDateTime&$orderby=receivedDateTime desc`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (!res.ok) return "Failed to fetch recent emails";
      
      const data = await res.json();
      return data.value.map((msg: {
        subject?: string;
        from?: { emailAddress?: { name?: string } };
        isRead?: boolean;
      }) => {
        const isUnread = !msg.isRead ? '📬' : '📭';
        return `${isUnread} From: ${msg.from?.emailAddress?.name || 'Unknown'} | Subject: ${msg.subject || 'No subject'}`;
      }).join('\n');
    }
  } catch (error) {
    console.error('Error fetching recent emails:', error);
    return "Error fetching recent emails";
  }
}

// Search documents in OneDrive / SharePoint / Google Drive
async function searchDocuments(accessToken: string, provider: string, query: string, maxResults: number = 10): Promise<string> {
  try {
    if (provider === 'google') {
      // Google Drive search
      const q = query
        ? `fullText contains '${query.replace(/'/g, "\\'")}' and trashed=false`
        : `trashed=false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${maxResults}&fields=files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))&orderBy=modifiedTime desc`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return `Failed to search Google Drive (${res.status})`;
      const data = await res.json();
      if (!data.files?.length) return "No documents found.";
      return data.files.map((f: { name?: string; mimeType?: string; modifiedTime?: string; webViewLink?: string; owners?: { displayName?: string }[] }) =>
        `- ${f.name || 'Untitled'} (${f.mimeType || ''}) — modified ${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : 'n/a'}${f.owners?.[0]?.displayName ? ` by ${f.owners[0].displayName}` : ''}${f.webViewLink ? ` — ${f.webViewLink}` : ''}`
      ).join('\n');
    } else {
      // Microsoft Graph search across OneDrive + SharePoint
      const results: string[] = [];

      if (query && query.trim().length > 0) {
        // Unified search across driveItem entities (covers OneDrive + SharePoint document libraries)
        const searchRes = await fetch(`https://graph.microsoft.com/v1.0/search/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              entityTypes: ['driveItem'],
              query: { queryString: query },
              from: 0,
              size: maxResults,
            }],
          }),
        });
        if (searchRes.ok) {
          const data = await searchRes.json();
          const hits = data.value?.[0]?.hitsContainers?.[0]?.hits || [];
          for (const h of hits) {
            const r = h.resource || {};
            const name = r.name || r.title || 'Untitled';
            const link = r.webUrl || '';
            const modified = r.lastModifiedDateTime ? new Date(r.lastModifiedDateTime).toLocaleDateString() : 'n/a';
            const site = r.parentReference?.siteId ? ' [SharePoint]' : ' [OneDrive]';
            results.push(`- ${name}${site} — modified ${modified}${link ? ` — ${link}` : ''}`);
          }
        } else {
          results.push(`(Graph search returned ${searchRes.status})`);
        }
      } else {
        // No query: list recent OneDrive files
        const recentRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/recent?$top=${maxResults}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (recentRes.ok) {
          const data = await recentRes.json();
          for (const f of data.value || []) {
            const modified = f.lastModifiedDateTime ? new Date(f.lastModifiedDateTime).toLocaleDateString() : 'n/a';
            results.push(`- ${f.name || 'Untitled'} [OneDrive] — modified ${modified}${f.webUrl ? ` — ${f.webUrl}` : ''}`);
          }
        }
      }

      return results.length ? results.join('\n') : "No documents found.";
    }
  } catch (error) {
    console.error('Error searching documents:', error);
    return "Error searching documents";
  }
}

type AIProvider = 'openai' | 'claude';

interface AdminAIConfig {
  openai: string | null;
  claude: string | null;
  preference: 'auto' | 'openai' | 'claude';
  openaiModel: string;
  claudeModel: string;
}

interface AIUsageResult {
  content: string;
  provider: AIProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-4.1': { input: 0.002, output: 0.008 },
};

const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-latest': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-latest': { input: 0.0008, output: 0.004 },
  'claude-3-opus-latest': { input: 0.015, output: 0.075 },
};

function calculateCost(provider: AIProvider, model: string, promptTokens: number, completionTokens: number) {
  const table = provider === 'openai' ? OPENAI_PRICING : CLAUDE_PRICING;
  const pricing = table[model] ?? { input: 0, output: 0 };
  return (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output;
}

async function loadAdminAIConfig(supabase: ReturnType<typeof createClient>): Promise<AdminAIConfig> {
  const { data, error } = await supabase
    .from('api_key_config')
    .select('key_name, encrypted_value')
    .in('key_name', [
      'openai_api_key',
      'claude_api_key',
      'ai_provider_preference',
      'ai_openai_model',
      'ai_claude_model',
    ]);

  if (error) {
    console.warn('Failed to load admin AI config:', error.message);
  }

  const map: Record<string, string> = {};
  (data ?? []).forEach((row: { key_name: string; encrypted_value: string }) => {
    map[row.key_name] = (row.encrypted_value || '').trim();
  });

  const preference = (map['ai_provider_preference'] || 'auto').toLowerCase();

  return {
    openai: map['openai_api_key'] || Deno.env.get('OPENAI_API_KEY')?.trim() || null,
    claude: map['claude_api_key'] || Deno.env.get('ANTHROPIC_API_KEY')?.trim() || null,
    preference: preference === 'openai' || preference === 'claude' ? preference : 'auto',
    openaiModel: map['ai_openai_model'] || 'gpt-4o-mini',
    claudeModel: map['ai_claude_model'] || 'claude-3-5-sonnet-latest',
  };
}

function choosePrimaryProvider(messages: Array<{ role: string; content: string }>, preference: AdminAIConfig['preference']): AIProvider {
  if (preference === 'openai' || preference === 'claude') return preference;

  const text = messages
    .map((message) => message.content || '')
    .join('\n')
    .toLowerCase();

  const complexKeywords = [
    'analyze',
    'analysis',
    'strategy',
    'architect',
    'architecture',
    'compare',
    'comparison',
    'tradeoff',
    'trade-off',
    'proposal',
    'recommendation',
    'deep dive',
    'complex',
    'reason through',
  ];

  const questionCount = (text.match(/\?/g) ?? []).length;
  const isComplex = text.length > 2200 || questionCount >= 3 || complexKeywords.some((keyword) => text.includes(keyword));

  return isComplex ? 'claude' : 'openai';
}

async function callOpenAI(messages: Array<{ role: string; content: string }>, systemPrompt: string, apiKey: string, model: string): Promise<AIUsageResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');

  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;
  const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    content,
    provider: 'openai',
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: calculateCost('openai', model, promptTokens, completionTokens),
  };
}

async function callClaude(messages: Array<{ role: string; content: string }>, systemPrompt: string, apiKey: string, model: string): Promise<AIUsageResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.content?.map((block: { type: string; text?: string }) => block.type === 'text' ? block.text || '' : '').join('') || '';
  if (!content) throw new Error('Claude returned empty content');

  const promptTokens = data.usage?.input_tokens ?? 0;
  const completionTokens = data.usage?.output_tokens ?? 0;

  return {
    content,
    provider: 'claude',
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: calculateCost('claude', model, promptTokens, completionTokens),
  };
}

// Web search via OpenAI Responses API (native web_search tool).
// Default model: gpt-5-mini per project policy.
async function callOpenAIWebSearch(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  model: string,
  userLocation?: { city?: string; region?: string; country?: string; timezone?: string } | null,
): Promise<AIUsageResult> {
  const input = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];
  const webSearchTool: Record<string, unknown> = { type: 'web_search' };
  if (userLocation && (userLocation.city || userLocation.region || userLocation.country || userLocation.timezone)) {
    webSearchTool.user_location = {
      type: 'approximate',
      ...(userLocation.city ? { city: userLocation.city } : {}),
      ...(userLocation.region ? { region: userLocation.region } : {}),
      ...(userLocation.country ? { country: userLocation.country } : {}),
      ...(userLocation.timezone ? { timezone: userLocation.timezone } : {}),
    };
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
      tools: [webSearchTool],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const data = await response.json();
  // Prefer output_text aggregate; fallback to walking output array.
  let content: string = data.output_text || '';
  if (!content && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string') content += c.text;
        }
      }
    }
  }
  if (!content) content = '(no response)';

  // Citations — append as markdown footnotes if available.
  const citations: string[] = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (Array.isArray(c.annotations)) {
            for (const a of c.annotations) {
              if (a.type === 'url_citation' && a.url) {
                const title = a.title || a.url;
                const line = `- [${title}](${a.url})`;
                if (!citations.includes(line)) citations.push(line);
              }
            }
          }
        }
      }
    }
  }
  if (citations.length) {
    content += `\n\n**Sources:**\n${citations.join('\n')}`;
  }

  const promptTokens = data.usage?.input_tokens ?? 0;
  const completionTokens = data.usage?.output_tokens ?? 0;

  return {
    content,
    provider: 'openai',
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: calculateCost('openai', model, promptTokens, completionTokens),
  };
}

async function generateChatReply(messages: Array<{ role: string; content: string }>, systemPrompt: string, config: AdminAIConfig): Promise<AIUsageResult> {
  const primary = choosePrimaryProvider(messages, config.preference);
  const order: AIProvider[] = primary === 'openai' ? ['openai', 'claude'] : ['claude', 'openai'];
  const errors: string[] = [];

  for (const provider of order) {
    try {
      if (provider === 'openai' && config.openai) {
        return await callOpenAI(messages, systemPrompt, config.openai, config.openaiModel);
      }

      if (provider === 'claude' && config.claude) {
        return await callClaude(messages, systemPrompt, config.claude, config.claudeModel);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`${provider} chat call failed:`, message);
      errors.push(`${provider}: ${message}`);
    }
  }

  if (!config.openai && !config.claude) {
    throw new Error('No AI provider is configured. Add an OpenAI or Claude key in Admin → Settings.');
  }

  throw new Error(errors[0] || 'All configured AI providers failed.');
}

function createSSEStream(content: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parts = content.match(/[\s\S]{1,32}/g) ?? [content];

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)
        );
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

// Build SSE stream of token events for the chat UI (typed events: token/done/blocked/error).
function buildChatSSEStream(opts: {
  fullContent: string;
  conversationId: string;
  usage: { promptTokens: number; completionTokens: number; costUsd: number; model: string; provider: string };
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = opts.fullContent.match(/[\s\S]{1,12}/g) ?? [opts.fullContent];
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'conversation', conversation_id: opts.conversationId })}\n\n`));
      for (const c of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: c })}\n\n`));
        await new Promise((r) => setTimeout(r, 8));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', usage: opts.usage })}\n\n`));
      controller.close();
    },
  });
}

async function generateConversationTitle(firstMessage: string, config: AdminAIConfig): Promise<string> {
  const prompt = `Summarize this user request in 5 words or fewer for a sidebar chat title. No quotes, no punctuation at end.\n\nRequest: ${firstMessage.slice(0, 400)}`;
  try {
    if (config.openai) {
      const res = await callOpenAI([{ role: 'user', content: prompt }], 'You write very short chat titles.', config.openai, 'gpt-4o-mini');
      return res.content.trim().replace(/^["']|["']$/g, '').slice(0, 60) || 'New chat';
    }
    if (config.claude) {
      const res = await callClaude([{ role: 'user', content: prompt }], 'You write very short chat titles.', config.claude, 'claude-3-5-haiku-latest');
      return res.content.trim().replace(/^["']|["']$/g, '').slice(0, 60) || 'New chat';
    }
  } catch (e) {
    console.warn('title gen failed', e);
  }
  return firstMessage.slice(0, 50);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const encryptionKey = Deno.env.get("TOKEN_ENCRYPTION_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      messages: bodyMessages,
      connectionId,
      message: chatMessage,
      conversation_id: conversationIdInput,
      folder_id: folderIdInput,
      attachments: attachmentUrls,
      stream: streamMode,
      web_search: webSearchRequested,
      user_location: userLocation,
    } = body as {
      messages?: Array<{ role: string; content: string }>;
      connectionId?: string;
      message?: string;
      conversation_id?: string | null;
      folder_id?: string | null;
      attachments?: string[];
      stream?: boolean;
      web_search?: boolean;
      user_location?: { city?: string; region?: string; country?: string; timezone?: string } | null;
    };

    const isChatPageMode = typeof chatMessage === 'string' && chatMessage.length > 0;

    const { data: profileEarly } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const orgIdEarly = profileEarly?.organization_id as string | undefined;

    let conversationId: string | null = conversationIdInput ?? null;
    let messages: Array<{ role: string; content: string }> = bodyMessages ?? [];
    let isFirstMessage = false;

    if (isChatPageMode) {
      if (!orgIdEarly) {
        return new Response(JSON.stringify({ error: 'No organization' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!conversationId) {
        const { data: convo, error: convoErr } = await supabase
          .from('chat_conversations')
          .insert({ user_id: user.id, organization_id: orgIdEarly, title: 'New chat', folder_id: folderIdInput ?? null })
          .select('id')
          .single();
        if (convoErr || !convo) {
          return new Response(JSON.stringify({ error: convoErr?.message || 'Failed to create conversation' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        conversationId = convo.id;
        isFirstMessage = true;
      } else {
        const { count } = await supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conversationId);
        isFirstMessage = (count || 0) === 0;
      }

      await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: 'user',
        content: chatMessage!,
        attachments: attachmentUrls && attachmentUrls.length ? attachmentUrls : null,
      });

      const { data: history } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(20);
      messages = (history || [])
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));
      if (attachmentUrls && attachmentUrls.length) {
        messages.push({ role: 'user', content: `[User attached files: ${attachmentUrls.join(', ')}]` });
      }
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get email context if connection provided
    let emailContext = "";
    let calendarContext = "";
    let documentContext = "";
    let accessToken: string | null = null;
    let provider = "";

    if (connectionId) {
      const { data: connection } = await supabase
        .from('provider_connections')
        .select('*')
        .eq('id', connectionId)
        .eq('user_id', user.id)
        .single();
      
      if (connection) {
        provider = connection.provider;
        
        const { data: tokenData } = await supabase
          .from('oauth_token_vault')
          .select('*')
          .eq('user_id', user.id)
          .eq('provider', provider)
          .single();
        
        if (tokenData) {
          accessToken = await getValidAccessToken(
            tokenData as TokenData,
            encryptionKey,
            user.id,
            supabaseUrl,
            supabaseKey
          );
        }
      }
      
      // Get categories
      const { data: categories } = await supabase
        .from('categories')
        .select('name')
        .eq('connection_id', connectionId)
        .eq('is_enabled', true);
      
      if (categories?.length) {
        emailContext = `\nEmail categories: ${categories.map(c => c.name).join(', ')}`;
      }
    }

    // Check if user is asking about emails or calendar - fetch real data
    const lastUserMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
    const isEmailQuery = lastUserMessage.includes('email') || lastUserMessage.includes('mail') || 
                         lastUserMessage.includes('inbox') || lastUserMessage.includes('message') ||
                         lastUserMessage.includes('from') || lastUserMessage.includes('sent');
    const isCalendarQuery = lastUserMessage.includes('calendar') || lastUserMessage.includes('schedule') ||
                            lastUserMessage.includes('meeting') || lastUserMessage.includes('appointment') ||
                            lastUserMessage.includes('event') || lastUserMessage.includes('busy');
    const isSearchQuery = lastUserMessage.includes('find') || lastUserMessage.includes('search') ||
                          lastUserMessage.includes('look for') || lastUserMessage.includes('about');
    const isDocumentQuery = lastUserMessage.includes('document') || lastUserMessage.includes('file') ||
                            lastUserMessage.includes('onedrive') || lastUserMessage.includes('one drive') ||
                            lastUserMessage.includes('sharepoint') || lastUserMessage.includes('share point') ||
                            lastUserMessage.includes('drive') || lastUserMessage.includes('folder') ||
                            lastUserMessage.includes('spreadsheet') || lastUserMessage.includes('powerpoint') ||
                            lastUserMessage.includes('word doc') || lastUserMessage.includes('excel') ||
                            lastUserMessage.includes('.docx') || lastUserMessage.includes('.xlsx') ||
                            lastUserMessage.includes('.pptx') || lastUserMessage.includes('.pdf') ||
                            lastUserMessage.includes('invoice') || lastUserMessage.includes('receipt') ||
                            lastUserMessage.includes('contract') || lastUserMessage.includes('proposal') ||
                            lastUserMessage.includes('report') || lastUserMessage.includes('policy') ||
                            lastUserMessage.includes('presentation') || lastUserMessage.includes('deck') ||
                            lastUserMessage.includes('agreement') || lastUserMessage.includes('statement') ||
                            lastUserMessage.includes('quote') || lastUserMessage.includes('po ') ||
                            lastUserMessage.includes('purchase order') || lastUserMessage.includes('attachment');

    if (accessToken) {
      // If searching for specific emails
      if (isEmailQuery && isSearchQuery) {
        // Extract search terms (simple approach)
        const searchTerms = lastUserMessage
          .replace(/find|search|look for|emails?|about|from|regarding|related to/gi, '')
          .trim();
        if (searchTerms.length > 2) {
          const searchResults = provider === 'google' 
            ? await searchGmailEmails(accessToken, searchTerms)
            : await searchOutlookEmails(accessToken, searchTerms);
          emailContext += `\n\nSearch results for "${searchTerms}":\n${searchResults}`;
        }
      } else if (isEmailQuery) {
        // Get recent emails
        const recentEmails = await getRecentEmailsSummary(accessToken, provider, 15);
        emailContext += `\n\nRecent emails:\n${recentEmails}`;
      }
      
      if (isCalendarQuery) {
        const events = await fetchCalendarEvents(accessToken, provider, 14);
        calendarContext = `\n\nUpcoming calendar events (next 2 weeks):\n${events}`;
      }

      if (isDocumentQuery) {
        // Extract a simple search term
        const docTerms = lastUserMessage
          .replace(/find|search|look for|show me|list|recent|my|the|please|can you|documents?|files?|folders?|onedrive|sharepoint|drive|spreadsheets?|powerpoints?|word docs?|excel|about|regarding|related to|named|called/gi, '')
          .replace(/[?.!,]/g, '')
          .trim();
        const docs = await searchDocuments(accessToken, provider, docTerms, 10);
        documentContext = `\n\nDocuments from ${provider === 'google' ? 'Google Drive' : 'OneDrive / SharePoint'}${docTerms ? ` matching "${docTerms}"` : ' (recent)'}:\n${docs}`;
      }
    }

    const systemPrompt = `You are the InboxIQ AI chat assistant. You help the user work faster using their inbox, calendar, and document repository (OneDrive / SharePoint / Google Drive) context when available.

Your capabilities:
1. Search and retrieve specific emails by sender, subject, or content
2. Summarize email threads and conversations
3. Find attachments mentioned in emails
4. View calendar events, meetings, and appointments
5. Search documents and files in OneDrive, SharePoint, and Google Drive
6. Analyze communication patterns and priorities
7. Help draft responses or suggest actions

Current date/time: ${new Date().toLocaleString()}
${emailContext}${calendarContext}${documentContext}

When answering:
- Use the ACTUAL email, calendar, and document data provided above
- If you found relevant emails / events / files, reference them specifically and include links when present
- If data is limited, explain what you can see and suggest searching for more specific terms
- Be helpful and proactive in suggesting follow-up actions
 - Format information clearly with bullet points or sections when appropriate
 - If you use general knowledge beyond the user's connected data, say so briefly and clearly`;

    const adminAIConfig = await loadAdminAIConfig(supabase);
    const orgId = orgIdEarly;

    // Enforce limits before LLM
    const { enforceLimitsBeforeLLM, recordSpend, blockedResponse } = await import('../_shared/enforce-limits.ts');
    if (orgId) {
      const fallbackModel = adminAIConfig.preference === 'claude' ? adminAIConfig.claudeModel : adminAIConfig.openaiModel;
      const gate = await enforceLimitsBeforeLLM(supabase, {
        userId: user.id,
        organizationId: orgId,
        feature: 'ai_chat',
        fallbackModel,
      });
      if (!gate.allowed) {
        if (isChatPageMode && streamMode) {
          const enc = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'conversation', conversation_id: conversationId })}\n\n`));
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'blocked', reason: gate.reason })}\n\n`));
              controller.close();
            }
          });
          return new Response(stream, {
            headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
          });
        }
        if (isChatPageMode) {
          return new Response(JSON.stringify({ blocked: true, reason: gate.reason, conversation_id: conversationId }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return blockedResponse(gate.reason || 'feature_disabled', corsHeaders);
      }
    }

    // Web search path — gated by group feature `ai_chat_web_search`.
    let result: AIUsageResult;
    if (webSearchRequested) {
      // Verify the user actually has access (super admin bypasses).
      let allowed = false;
      try {
        const { data: hasWs } = await supabase.rpc('has_feature', {
          _user_id: user.id,
          _feature_key: 'ai_chat_web_search',
        });
        allowed = hasWs === true;
      } catch (_e) { allowed = false; }

      if (!allowed) {
        const msg = 'Web search is not enabled for your group. Ask your admin to enable "AI Chat — Web Search".';
        if (isChatPageMode && streamMode) {
          return new Response(
            buildChatSSEStream({
              fullContent: msg,
              conversationId: conversationId!,
              usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: 'n/a', provider: 'openai' },
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } }
          );
        }
        return new Response(JSON.stringify({ error: msg }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!adminAIConfig.openai) {
        throw new Error('Web search requires an OpenAI API key. Add one in Admin → Settings.');
      }
      // Per-group model override if admin assigned one; otherwise default to gpt-5-mini.
      let wsModel = 'gpt-5-mini';
      try {
        const { data: gfRows } = await supabase
          .from('group_features')
          .select('model_assignment, permission_groups!inner(organization_id)')
          .eq('feature_key', 'ai_chat_web_search')
          .eq('is_enabled', true)
          .eq('permission_groups.organization_id', orgId)
          .not('model_assignment', 'is', null)
          .limit(1);
        if (gfRows && gfRows[0]?.model_assignment) wsModel = gfRows[0].model_assignment as string;
      } catch (_e) { /* keep default */ }

      result = await callOpenAIWebSearch(messages, systemPrompt, adminAIConfig.openai, wsModel, userLocation ?? null);
    } else {
      result = await generateChatReply(messages, systemPrompt, adminAIConfig);
    }

    if (orgId) {
      await recordSpend(supabase, {
        userId: user.id,
        organizationId: orgId,
        groupId: null,
        feature: 'ai_chat',
        provider: (result.provider === 'claude' ? 'anthropic' : 'openai'),
        model: result.model,
        tokensIn: result.promptTokens,
        tokensOut: result.completionTokens,
        metadata: { connection_id: connectionId ?? null, conversation_id: conversationId, provider_preference: adminAIConfig.preference },
      });
    }

    if (isChatPageMode && conversationId) {
      // Save assistant message
      await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: 'assistant',
        content: result.content,
        model_used: result.model,
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        cost_usd: result.costUsd,
      });
      // Update conversation. Always (re)generate a title if the saved title
      // is still a placeholder, not just on the very first message — fixes
      // chats that kept "New chat" after later sends.
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let needsTitle = isFirstMessage;
      if (!needsTitle) {
        const { data: convRow } = await supabase
          .from('chat_conversations')
          .select('title')
          .eq('id', conversationId)
          .maybeSingle();
        const t = (convRow?.title || '').trim().toLowerCase();
        if (!t || ['new chat', 'user greeting', 'new conversation', 'untitled'].includes(t)) {
          needsTitle = true;
        }
      }
      if (needsTitle) {
        updates.title = await generateConversationTitle(chatMessage!, adminAIConfig);
      }
      await supabase.from('chat_conversations').update(updates).eq('id', conversationId);

      if (streamMode) {
        return new Response(
          buildChatSSEStream({
            fullContent: result.content,
            conversationId,
            usage: {
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              costUsd: result.costUsd,
              model: result.model,
              provider: result.provider,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } }
        );
      }
      return new Response(
        JSON.stringify({
          content: result.content,
          conversation_id: conversationId,
          model: result.model,
          provider: result.provider,
          usage: {
            prompt_tokens: result.promptTokens,
            completion_tokens: result.completionTokens,
            cost_usd: result.costUsd,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ content: result.content, provider: result.provider, model: result.model }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in ai-assistant-chat:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

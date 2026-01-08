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
  } else if (tokenData.provider === 'microsoft') {
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
  
  if (tokenData.provider === 'microsoft' && 'refresh_token' in newTokens && newTokens.refresh_token) {
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

// Search Gmail emails
async function searchGmailEmails(accessToken: string, query: string, maxResults: number = 20): Promise<string> {
  try {
    const searchQuery = encodeURIComponent(query);
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQuery}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!listRes.ok) return "Failed to search emails";
    
    const listData = await listRes.json();
    if (!listData.messages?.length) return "No emails found matching your search.";
    
    const results: string[] = [];
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
    
    return results.join('\n');
  } catch (error) {
    console.error('Error searching Gmail:', error);
    return "Error searching emails";
  }
}

// Search Outlook emails
async function searchOutlookEmails(accessToken: string, query: string, maxResults: number = 20): Promise<string> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(query)}"&$top=${maxResults}&$select=id,subject,from,bodyPreview,receivedDateTime,hasAttachments,body`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) return "Failed to search emails";
    
    const data = await res.json();
    if (!data.value?.length) return "No emails found matching your search.";
    
    const results = data.value.map((msg: {
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      bodyPreview?: string;
      hasAttachments?: boolean;
      body?: { content?: string };
    }) => `
---
From: ${msg.from?.emailAddress?.name || ''} <${msg.from?.emailAddress?.address || ''}>
Subject: ${msg.subject || ''}
Date: ${msg.receivedDateTime || ''}
${msg.hasAttachments ? 'Has Attachments: Yes' : ''}
Content: ${msg.bodyPreview || ''}
---`);
    
    return results.join('\n');
  } catch (error) {
    console.error('Error searching Outlook:', error);
    return "Error searching emails";
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

    const { messages, connectionId } = await req.json();
    
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get email context if connection provided
    let emailContext = "";
    let calendarContext = "";
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
    }

    const systemPrompt = `You are an intelligent AI assistant with FULL ACCESS to the user's email inbox and calendar. You can search, read, and analyze their emails and calendar events.

Your capabilities:
1. Search and retrieve specific emails by sender, subject, or content
2. Summarize email threads and conversations
3. Find attachments mentioned in emails
4. View calendar events, meetings, and appointments
5. Analyze communication patterns and priorities
6. Help draft responses or suggest actions

Current date/time: ${new Date().toLocaleString()}
${emailContext}${calendarContext}

When answering:
- Use the ACTUAL email and calendar data provided above
- If you found relevant emails/events, reference them specifically
- If data is limited, explain what you can see and suggest searching for more specific terms
- Be helpful and proactive in suggesting follow-up actions
- Format information clearly with bullet points or sections when appropriate`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", response.status, await response.text());
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Error in ai-assistant-chat:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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
  
  if (!response.ok) {
    console.error('Failed to refresh Google token:', await response.text());
    return null;
  }
  
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
  
  if (!response.ok) {
    console.error('Failed to refresh Microsoft token:', await response.text());
    return null;
  }
  
  return await response.json();
}

interface TokenData {
  provider: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

// Get valid access token, refreshing if expired
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
  
  console.log(`Token for ${tokenData.provider} is expired, refreshing...`);
  
  if (!tokenData.encrypted_refresh_token) {
    console.error(`No refresh token available for ${tokenData.provider}`);
    return null;
  }
  
  const refreshToken = await decryptToken(tokenData.encrypted_refresh_token, encryptionKey);
  let newTokens;
  
  if (tokenData.provider === 'google') {
    newTokens = await refreshGoogleToken(refreshToken);
  } else if (tokenData.provider === 'microsoft') {
    newTokens = await refreshMicrosoftToken(refreshToken);
  }
  
  if (!newTokens) return null;
  
  // Update token in vault
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

interface CalendarEvent {
  start: Date;
  end: Date;
  title: string;
  location?: string;
  attendees?: string[];
}

interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: Date;
  isUnread: boolean;
  labels?: string[];
}

// Fetch today's calendar events from Google
async function fetchGoogleCalendarEventsToday(accessToken: string): Promise<CalendarEvent[]> {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      `timeMin=${startOfDay.toISOString()}&timeMax=${endOfDay.toISOString()}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) {
      console.error('Failed to fetch Google Calendar events:', await res.text());
      return [];
    }
    
    const data = await res.json();
    return (data.items || []).map((event: { 
      start?: { dateTime?: string; date?: string }; 
      end?: { dateTime?: string; date?: string }; 
      summary?: string;
      location?: string;
      attendees?: { email: string }[];
    }) => ({
      start: new Date(event.start?.dateTime || event.start?.date || ''),
      end: new Date(event.end?.dateTime || event.end?.date || ''),
      title: event.summary || 'No title',
      location: event.location,
      attendees: event.attendees?.map(a => a.email) || []
    }));
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error);
    return [];
  }
}

// Fetch today's calendar events from Microsoft
async function fetchMicrosoftCalendarEventsToday(accessToken: string): Promise<CalendarEvent[]> {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?` +
      `startDateTime=${startOfDay.toISOString()}&endDateTime=${endOfDay.toISOString()}&$select=start,end,subject,location,attendees&$orderby=start/dateTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) {
      console.error('Failed to fetch Microsoft Calendar events:', await res.text());
      return [];
    }
    
    const data = await res.json();
    return (data.value || []).map((event: { 
      start?: { dateTime?: string }; 
      end?: { dateTime?: string }; 
      subject?: string;
      location?: { displayName?: string };
      attendees?: { emailAddress: { address: string } }[];
    }) => ({
      start: new Date(event.start?.dateTime || ''),
      end: new Date(event.end?.dateTime || ''),
      title: event.subject || 'No title',
      location: event.location?.displayName,
      attendees: event.attendees?.map(a => a.emailAddress.address) || []
    }));
  } catch (error) {
    console.error('Error fetching Microsoft Calendar events:', error);
    return [];
  }
}

// Fetch recent unread emails from Gmail
async function fetchGmailUnreadEmails(accessToken: string, maxResults: number = 20): Promise<EmailMessage[]> {
  try {
    // First get message IDs
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!listRes.ok) {
      console.error('Failed to list Gmail messages:', await listRes.text());
      return [];
    }
    
    const listData = await listRes.json();
    if (!listData.messages?.length) return [];
    
    // Fetch details for each message (batch)
    const emails: EmailMessage[] = [];
    for (const msg of listData.messages.slice(0, 10)) {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (detailRes.ok) {
        const detail = await detailRes.json();
        const headers = detail.payload?.headers || [];
        const from = headers.find((h: { name: string }) => h.name === 'From')?.value || '';
        const subject = headers.find((h: { name: string }) => h.name === 'Subject')?.value || '';
        const dateStr = headers.find((h: { name: string }) => h.name === 'Date')?.value || '';
        
        emails.push({
          id: msg.id,
          subject,
          from: from.replace(/<[^>]*>/g, '').trim(),
          snippet: detail.snippet || '',
          date: new Date(dateStr),
          isUnread: detail.labelIds?.includes('UNREAD'),
          labels: detail.labelIds
        });
      }
    }
    
    return emails;
  } catch (error) {
    console.error('Error fetching Gmail messages:', error);
    return [];
  }
}

// Fetch recent unread emails from Outlook
async function fetchOutlookUnreadEmails(accessToken: string, maxResults: number = 20): Promise<EmailMessage[]> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=isRead eq false&$top=${maxResults}&$select=id,subject,from,bodyPreview,receivedDateTime,isRead&$orderby=receivedDateTime desc`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) {
      console.error('Failed to fetch Outlook messages:', await res.text());
      return [];
    }
    
    const data = await res.json();
    return (data.value || []).map((msg: {
      id: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      bodyPreview?: string;
      receivedDateTime?: string;
      isRead?: boolean;
    }) => ({
      id: msg.id,
      subject: msg.subject || '',
      from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || '',
      snippet: msg.bodyPreview || '',
      date: new Date(msg.receivedDateTime || ''),
      isUnread: !msg.isRead
    }));
  } catch (error) {
    console.error('Error fetching Outlook messages:', error);
    return [];
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

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { connectionId } = await req.json();
    
    // Get connection details
    const { data: connection } = await supabase
      .from('provider_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .single();
    
    if (!connection) {
      return new Response(JSON.stringify({ error: "Connection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get OAuth token
    const { data: tokenData } = await supabase
      .from('oauth_token_vault')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', connection.provider)
      .single();
    
    if (!tokenData) {
      return new Response(JSON.stringify({ error: "No token found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get valid access token
    const accessToken = await getValidAccessToken(
      tokenData as TokenData, 
      encryptionKey, 
      user.id,
      supabaseUrl,
      supabaseKey
    );
    
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Failed to get access token" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch real calendar events and emails
    let calendarEvents: CalendarEvent[] = [];
    let unreadEmails: EmailMessage[] = [];

    if (connection.provider === 'google') {
      calendarEvents = await fetchGoogleCalendarEventsToday(accessToken);
      unreadEmails = await fetchGmailUnreadEmails(accessToken);
    } else if (connection.provider === 'microsoft') {
      calendarEvents = await fetchMicrosoftCalendarEventsToday(accessToken);
      unreadEmails = await fetchOutlookUnreadEmails(accessToken);
    }

    console.log(`Found ${calendarEvents.length} calendar events and ${unreadEmails.length} unread emails`);

    // Get categories for context
    const { data: categories } = await supabase
      .from('categories')
      .select('name, color, ai_draft_enabled')
      .eq('connection_id', connectionId)
      .eq('is_enabled', true);

    // Get availability for today
    const dayOfWeek = new Date().getDay();
    const { data: availability } = await supabase
      .from('availability_hours')
      .select('start_time, end_time, is_available')
      .eq('connection_id', connectionId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_available', true);

    // Build context for AI
    const now = new Date();
    const formatTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const formatDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const contextData = {
      currentTime: formatTime(now),
      date: formatDate(now),
      calendarEvents: calendarEvents.map(e => ({
        time: `${formatTime(e.start)} - ${formatTime(e.end)}`,
        title: e.title,
        location: e.location,
        attendees: e.attendees?.slice(0, 3).join(', ')
      })),
      unreadEmails: unreadEmails.slice(0, 10).map(e => ({
        from: e.from,
        subject: e.subject,
        preview: e.snippet.slice(0, 100),
        receivedAt: formatTime(e.date)
      })),
      categories: categories?.map(c => c.name) || [],
      availability: availability?.filter(a => a.is_available).map(a => ({
        start: a.start_time,
        end: a.end_time
      })) || []
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an executive assistant creating a daily brief. You have access to real calendar events and emails.

Based on the context provided, generate a structured daily brief in JSON format with these sections:
1. "greeting": A personalized greeting based on time of day
2. "summary": Brief 1-2 sentence overview of the day (mention number of meetings, unread emails)
3. "priorities": Array of 3-5 priority items based on REAL emails and meetings (each with "title", "description", "urgency": "high"|"medium"|"low", "type": "email"|"meeting"|"task"). Base urgency on:
   - HIGH: Meetings within 2 hours, emails from executives/clients, time-sensitive subjects
   - MEDIUM: Emails needing response today, meetings later today
   - LOW: FYI emails, non-urgent follow-ups
4. "schedule": Array of TODAY's actual calendar events (each with "time", "title", "type"). If no events, include "Available for focus work" blocks based on availability.
5. "emailHighlights": Array of important unread emails to address (each with "from", "subject", "action" - suggest specific action like "Reply", "Review attachment", "Schedule call")
6. "suggestions": Array of 2-3 productivity suggestions based on actual workload

IMPORTANT: Use the REAL data provided. Do not make up meetings or emails. If there are no calendar events, say so clearly and suggest using the time productively.`;

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
          { role: "user", content: `Here is my real data for today:\n${JSON.stringify(contextData, null, 2)}\n\nPlease generate my daily brief based on this actual data.` },
        ],
        response_format: { type: "json_object" },
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
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;
    
    let briefData;
    try {
      briefData = JSON.parse(content);
    } catch {
      // Fallback with real data
      const hour = new Date().getHours();
      briefData = {
        greeting: `Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}!`,
        summary: `You have ${calendarEvents.length} meetings and ${unreadEmails.length} unread emails today.`,
        priorities: unreadEmails.slice(0, 3).map(e => ({
          title: `Review: ${e.subject.slice(0, 40)}`,
          description: `From ${e.from}`,
          urgency: 'medium',
          type: 'email'
        })),
        schedule: calendarEvents.length > 0 
          ? calendarEvents.map(e => ({
              time: formatTime(e.start),
              title: e.title,
              type: 'meeting'
            }))
          : [{ time: 'All day', title: 'Available for focus work', type: 'focus' }],
        emailHighlights: unreadEmails.slice(0, 5).map(e => ({
          from: e.from,
          subject: e.subject,
          action: 'Review and respond'
        })),
        suggestions: ['Check your most urgent emails first', 'Block time for deep work if calendar is clear']
      };
    }

    return new Response(JSON.stringify(briefData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ai-daily-brief:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

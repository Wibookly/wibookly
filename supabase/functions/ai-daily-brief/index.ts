import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceLimitsBeforeLLM, recordSpend, blockedResponse, detectProvider } from "../_shared/enforce-limits.ts";

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
  } else if (tokenData.provider === 'microsoft' || tokenData.provider === 'outlook') {
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
    const requestBody = await req.json().catch(() => ({}));
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
    const internalUserId = req.headers.get("x-internal-user-id") || requestBody?.userId || null;
    const internalConnectionId = req.headers.get("x-internal-connection-id") || requestBody?.connectionId || null;
    const isInternalCall =
      token === supabaseKey &&
      requestBody?.internal === true &&
      typeof internalUserId === "string" &&
      internalUserId.length > 0;

    let effectiveUserId: string | null = null;
    if (isInternalCall) {
      effectiveUserId = internalUserId;
    } else {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      effectiveUserId = user.id;
    }

    if (!effectiveUserId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connectionId = requestBody?.connectionId || internalConnectionId;
    if (!connectionId) {
      return new Response(JSON.stringify({ error: "Connection ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { briefType: briefTypeRaw } = requestBody;
    const briefType: "morning" | "evening" =
      briefTypeRaw === "evening" ? "evening" : "morning";
    
    // Get connection details
    const { data: connection } = await supabase
      .from('provider_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('user_id', effectiveUserId)
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
      .eq('user_id', effectiveUserId)
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
      effectiveUserId,
      supabaseUrl,
      supabaseKey
    );
    
    if (!accessToken) {
      return new Response(
        JSON.stringify({
          error: "Re-authentication required",
          details:
            "We could not refresh your provider access token. This usually happens after OAuth credentials change or the connection was revoked. Please disconnect and reconnect your account in Integrations.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch real calendar events and emails
    let calendarEvents: CalendarEvent[] = [];
    let unreadEmails: EmailMessage[] = [];

    if (connection.provider === 'google') {
      calendarEvents = await fetchGoogleCalendarEventsToday(accessToken);
      unreadEmails = await fetchGmailUnreadEmails(accessToken);
    } else if (connection.provider === 'microsoft' || connection.provider === 'outlook') {
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

    const actionPlanSpec = `"actionPlan": Array of 5-10 prioritized action items that MERGE the user's AI analysis, priorities, and email/meeting to-dos into ONE ordered, executable list. This is the PRIMARY section the user reads — they should be able to act from it without opening their inbox. Each item MUST be an object with EXACTLY this shape:
   {
     "priority": 1,                                  // 1 = do first, ascending
     "urgency": "high" | "medium" | "low",
     "title": "Reply to John about Q4 proposal",     // short imperative headline
     "source": "email" | "meeting" | "task",
     "from": "John Smith <john@acme.com>",           // REQUIRED when source = "email"
     "subject": "Q4 Proposal review",                // REQUIRED when source = "email"
     "receivedAt": "9:42 AM",                        // when the email arrived, if known
     "context": "John sent the revised Q4 proposal yesterday and is asking you to confirm the two budget lines he flagged in red before Friday's board meeting. He attached the updated spreadsheet.",
     "action": "Open the spreadsheet, confirm or adjust the two flagged budget lines, then reply approving and CC Sarah.",
     "why": "Blocks the Friday board sign-off — without your reply John can't finalize the deck.",
     "estimatedMinutes": 15
   }
   STRICT RULES for actionPlan (BE CONCISE — executives skim, they don't read):
   - "context" = MAX 2 SHORT sentences summarizing what the sender asked or what's happening. No filler. Plain English. The user must not need to reopen the email.
   - "action" = ONE imperative sentence with the concrete next step. Not "review" — say WHAT to do.
   - "why" = ONE short clause explaining the deadline / dependency / business reason.
   - Order strictly by priority (1 = highest impact, do first). Mix emails, meetings, and tasks together in the same ranked list.
   - Use ONLY real items from the provided context. Never invent senders, subjects, or topics.
   - ACCURACY: Only include emails that the user has NOT yet replied to. If the email thread shows the user has already sent a reply (their address appears as a later sender in the same thread/conversation), SKIP it — do not surface it as an action item.
   - If a meeting starts within 2 hours, it MUST appear at priority 1 with source "meeting" and a short context with attendees/location/prep needed.`;



    const morningInstructions = `Based on the context provided, generate a structured MORNING brief in JSON format with these sections:
1. "greeting": A personalized "Good morning" greeting
2. "summary": Brief 1-2 sentence overview of TODAY ahead (mention number of meetings, unread emails)
3. ${actionPlanSpec}
4. "priorities": Array of 3-5 priority items for TODAY (kept for backwards compat — derive from actionPlan; each with "title", "description", "urgency": "high"|"medium"|"low", "type": "email"|"meeting"|"task"). "description" MUST mirror the corresponding actionPlan item's "context" + "action".
5. "schedule": Array of TODAY's actual calendar events (each with "time", "title", "type"). If no events, include "Available for focus work" blocks based on availability.
6. "emailHighlights": Array of important unread emails to address (each with "from", "subject", "action", and "preview" — 1-2 sentence plain-English summary of what the email is about and what was asked).
7. "suggestions": Array of 2-3 productivity suggestions to start the day strong
8. "aiAnalysis": Object with executive analysis (kept for backwards compat — derive from actionPlan):
   - "headline": One-sentence strategic read on the day
   - "whatToDoFirst": Mirror of the first 3-5 actionPlan items as { "step", "action", "why", "estimatedMinutes" }
   - "risks": 1-3 short strings flagging anything at risk of slipping today
   - "wins": 1-2 quick-win opportunities the user can knock out in <15 min

Urgency baseline: HIGH = meetings within 2 hours, emails from executives/clients, time-sensitive subjects. MEDIUM = emails needing response today, meetings later today. LOW = FYI emails, non-urgent follow-ups.`;

    const eveningInstructions = `Based on the context provided, generate a structured END-OF-DAY RECAP in JSON format with these sections:
1. "greeting": A warm "Good evening" greeting recapping today
2. "summary": Brief 1-2 sentence recap of WHAT WAS COMPLETED today + what carries to tomorrow
3. ${actionPlanSpec}
   For the EVENING recap, every actionPlan item is something that DID NOT get closed today and needs to be tackled tomorrow. Frame "action" and "why" with that lens.
4. "priorities": Array of 3-5 TOMORROW'S TODOS (backwards-compat mirror of the first 3-5 actionPlan items; "description" MUST mirror actionPlan "context" + "action").
5. "schedule": Array of TOMORROW's calendar events if known — otherwise list today's completed meetings as "✓ Completed: <title>".
6. "emailHighlights": Array of unanswered emails from today (each with "from", "subject", "action", and "preview" — 1-2 sentence plain-English summary of what the email is about and what was asked).
7. "suggestions": Array of 2-3 reflections on today + recommendations for tomorrow
8. "aiAnalysis": Object with executive recap analysis (backwards-compat mirror of actionPlan):
   - "headline": One-sentence read on how the day went and what carries over
   - "whatToDoFirst": Mirror of the first 3-5 actionPlan items as { "step", "action", "why", "estimatedMinutes" }
   - "risks": 1-3 short strings flagging items at risk of slipping
   - "wins": 1-2 things accomplished today worth acknowledging

Frame everything as "today is wrapping up — here's what got done and what's queued for tomorrow."`;

    const systemPrompt = `You are an executive assistant creating a ${briefType} brief. You have access to real calendar events and emails.

${briefType === "evening" ? eveningInstructions : morningInstructions}

IMPORTANT: Use the REAL data provided. Do not make up meetings or emails. If there are no calendar events, say so clearly and suggest using the time productively.`;

    // Pre-flight enforcement
    const { data: upRow } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', effectiveUserId)
      .maybeSingle();
    const organizationId: string = upRow?.organization_id || '';
    const gate = await enforceLimitsBeforeLLM(supabase, {
      userId: effectiveUserId,
      organizationId,
      feature: 'daily_brief',
      fallbackModel: 'google/gemini-2.5-flash',
    });
    if (!gate.allowed) return blockedResponse(gate.reason || 'blocked', corsHeaders);
    const routedModel = gate.model || 'google/gemini-2.5-flash';
    // Lovable gateway needs provider-prefixed model id
    const gatewayModel = routedModel.includes('/')
      ? routedModel
      : (routedModel.startsWith('claude') ? `anthropic/${routedModel}` : `openai/${routedModel}`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: gatewayModel,
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

    // Post-call accounting
    try {
      const usage = aiResponse.usage || {};
      await recordSpend(supabase, {
        userId: effectiveUserId,
        organizationId,
        groupId: gate.group_id,
        feature: 'daily_brief',
        provider: routedModel.startsWith('google/') ? 'google' : detectProvider(routedModel),
        model: routedModel,
        tokensIn: Number(usage.prompt_tokens ?? 0),
        tokensOut: Number(usage.completion_tokens ?? 0),
        metadata: { brief_type: briefType, connection_id: connectionId },
      });
    } catch (e) {
      console.warn('[ai-daily-brief] recordSpend failed', e);
    }
    
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
        suggestions: ['Check your most urgent emails first', 'Block time for deep work if calendar is clear'],
        aiAnalysis: {
          headline: `${unreadEmails.length} unread emails and ${calendarEvents.length} meetings on deck.`,
          whatToDoFirst: unreadEmails.slice(0, 4).map((e, i) => ({
            step: i + 1,
            action: `Reply to "${e.subject.slice(0, 60)}" from ${e.from}`,
            why: 'Sitting unanswered in your inbox',
            estimatedMinutes: 10,
          })),
          risks: unreadEmails.length > 5 ? ['Inbox volume is high — block time to triage'] : [],
          wins: calendarEvents.length === 0 ? ['Calendar is clear — protect a focus block'] : [],
        },
        actionPlan: [
          ...calendarEvents.slice(0, 3).map((ev, i) => ({
            priority: i + 1,
            urgency: 'high' as const,
            title: ev.title,
            source: 'meeting' as const,
            context: `Scheduled ${formatTime(ev.start)} – ${formatTime(ev.end)}${ev.location ? ` at ${ev.location}` : ''}${ev.attendees?.length ? ` with ${ev.attendees.slice(0, 3).join(', ')}` : ''}.`,
            action: 'Join on time and have your prep notes ready.',
            why: 'Calendar commitment — attendees are expecting you.',
            estimatedMinutes: 30,
          })),
          ...unreadEmails.slice(0, 7).map((e, i) => ({
            priority: calendarEvents.slice(0, 3).length + i + 1,
            urgency: (i < 2 ? 'high' : i < 5 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
            title: `Reply: ${e.subject.slice(0, 60)}`,
            source: 'email' as const,
            from: e.from,
            subject: e.subject,
            receivedAt: formatTime(e.date),
            context: e.snippet?.slice(0, 240) || 'Unread email — open to see what was asked.',
            action: 'Read the message, then reply or delegate.',
            why: 'Sitting unanswered in your inbox.',
            estimatedMinutes: 10,
          })),
        ],
      };
    }

    // Backwards-compat safety net: if AI omitted actionPlan, synthesize one from priorities + emailHighlights.
    if (briefData && !Array.isArray(briefData.actionPlan)) {
      const synth: any[] = [];
      const pris = Array.isArray(briefData.priorities) ? briefData.priorities : [];
      const ehs = Array.isArray(briefData.emailHighlights) ? briefData.emailHighlights : [];
      pris.forEach((p: any, i: number) => {
        synth.push({
          priority: i + 1,
          urgency: p.urgency || 'medium',
          title: p.title || 'Untitled',
          source: p.type || 'task',
          context: p.description || '',
          action: p.description || 'Review and act.',
          why: '',
          estimatedMinutes: 10,
        });
      });
      ehs.forEach((e: any, i: number) => {
        synth.push({
          priority: pris.length + i + 1,
          urgency: e.urgency || 'medium',
          title: `${e.action || 'Reply'}: ${e.subject || '(no subject)'}`,
          source: 'email',
          from: e.from,
          subject: e.subject,
          context: e.preview || e.description || '',
          action: e.action || 'Reply or triage.',
          why: '',
          estimatedMinutes: 10,
        });
      });
      briefData.actionPlan = synth;
    }

    // ===== Persist actionPlan items + carry forward unfinished items from prior days =====
    try {
      const today = new Date().toISOString().slice(0, 10);
      const fingerprint = (it: any) => {
        const base = `${(it.source || 'email')}|${(it.title || '').toLowerCase().trim().slice(0, 120)}|${(it.subject || '').toLowerCase().trim().slice(0, 120)}|${(it.from || '').toLowerCase().trim().slice(0, 80)}`;
        return base.replace(/\s+/g, ' ').slice(0, 240);
      };

      // 1. Upsert today's items
      const rows = (briefData.actionPlan || []).map((it: any) => ({
        user_id: effectiveUserId,
        connection_id: connectionId,
        brief_date: today,
        source: it.source === 'meeting' ? 'calendar' : (it.source || 'email'),
        fingerprint: fingerprint(it),
        priority: it.priority ?? null,
        urgency: it.urgency || 'medium',
        title: (it.title || '').slice(0, 280),
        from_text: it.from || null,
        subject: it.subject || null,
        received_at: it.receivedAt || null,
        context: it.context || null,
        action: it.action || null,
        why: it.why || null,
        estimated_minutes: it.estimatedMinutes ?? null,
        status: 'open',
      }));
      if (rows.length) {
        await supabase.from('daily_brief_tasks').upsert(rows, { onConflict: 'user_id,fingerprint,brief_date' });
      }

      // 2. Pull all OPEN tasks (today + carried-over) for this user/connection to stamp ids onto response
      const { data: openTasks } = await supabase
        .from('daily_brief_tasks')
        .select('*')
        .eq('user_id', effectiveUserId)
        .eq('connection_id', connectionId)
        .eq('status', 'open')
        .order('brief_date', { ascending: true })
        .order('priority', { ascending: true, nullsFirst: false });

      const tasksByFp = new Map<string, any>();
      (openTasks || []).forEach((t: any) => {
        if (!tasksByFp.has(t.fingerprint)) tasksByFp.set(t.fingerprint, t);
      });

      // 3. Merge carry-overs (open tasks from prior days that didn't show up today) into actionPlan
      const todayFps = new Set(rows.map((r: any) => r.fingerprint));
      const carryOvers: any[] = [];
      (openTasks || []).forEach((t: any) => {
        if (t.brief_date < today && !todayFps.has(t.fingerprint)) {
          carryOvers.push({
            taskId: t.id,
            priority: t.priority,
            urgency: t.urgency || 'medium',
            title: t.title,
            source: t.source === 'calendar' ? 'meeting' : t.source,
            from: t.from_text || undefined,
            subject: t.subject || undefined,
            receivedAt: t.received_at || undefined,
            context: t.context || undefined,
            action: t.action || undefined,
            why: t.why || undefined,
            estimatedMinutes: t.estimated_minutes || undefined,
            status: t.status,
            carriedFromDate: t.brief_date,
            carryCount: (t.carry_count || 0) + 1,
          });
          // bump carry_count
          supabase.from('daily_brief_tasks').update({ carry_count: (t.carry_count || 0) + 1 }).eq('id', t.id).then(() => {});
        }
      });

      // 4. Stamp taskId/status onto today's items
      briefData.actionPlan = [
        ...carryOvers,
        ...(briefData.actionPlan || []).map((it: any) => {
          const t = tasksByFp.get(fingerprint(it));
          return t ? { ...it, taskId: t.id, status: t.status } : it;
        }),
      ];
    } catch (persistErr) {
      console.warn('[ai-daily-brief] persistence failed', persistErr);
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

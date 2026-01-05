import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  userId: string
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
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
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

// Writing style prompts
const WRITING_STYLE_PROMPTS: Record<string, string> = {
  professional: `Professional & Polished: formal business language, respectful tone, thorough but concise.`,
  friendly: `Friendly & Approachable: warm, conversational, personable while professional.`,
  concierge: `Concierge / White-Glove: elegant, refined, exceptionally courteous.`,
  direct: `Direct & Efficient: straight to the point, short clear sentences.`,
  empathetic: `Empathetic & Supportive: acknowledge emotions, compassionate, reassuring.`,
};

// Category context
const CATEGORY_CONTEXT: Record<string, string> = {
  'Urgent': 'This is an urgent matter requiring immediate attention.',
  'Follow Up': 'This is a follow-up to a previous conversation.',
  'Approvals': 'This relates to approving or reviewing something.',
  'Meetings': 'This relates to scheduling or confirming meetings.',
  'Customers': 'This is client-facing communication.',
  'Vendors': 'This is communication with vendors or partners.',
  'Internal': 'This is internal team communication.',
  'Projects': 'This relates to project updates or deliverables.',
  'Finance': 'This relates to billing, payments, or financial matters.',
  'FYI': 'This is informational communication for awareness.',
};

// Generate AI draft for an email
async function generateAIDraft(
  emailSubject: string,
  emailBody: string,
  emailFrom: string,
  categoryName: string,
  writingStyle: string
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  const cleanCategory = categoryName.replace(/^\d+:\s*/, '').trim();
  const stylePrompt = WRITING_STYLE_PROMPTS[writingStyle] || WRITING_STYLE_PROMPTS.professional;
  const categoryContext = CATEGORY_CONTEXT[cleanCategory] || '';

  const systemPrompt = `You are an expert email assistant. Generate a professional reply to the email below.

WRITING STYLE: ${stylePrompt}

CATEGORY: ${cleanCategory}
${categoryContext}

RULES:
- Generate a complete, ready-to-send email reply
- Do NOT include the subject line
- Start with an appropriate greeting
- End with a professional sign-off
- Be concise but thorough
- Address the sender's main points
- Output ONLY the email text`;

  const userPrompt = `Reply to this email:

FROM: ${emailFrom}
SUBJECT: ${emailSubject}

BODY:
${emailBody.substring(0, 3000)}`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error('AI API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('AI generation error:', error);
    return null;
  }
}

// Get Gmail email details
async function getGmailEmailDetails(accessToken: string, messageId: string): Promise<{
  subject: string;
  from: string;
  body: string;
  threadId: string;
  replyTo: string;
} | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) return null;
    
    const message = await res.json();
    const headers = message.payload?.headers || [];
    
    const getHeader = (name: string) => 
      headers.find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    
    // Extract body from parts
    let body = '';
    const extractBody = (part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): string => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
      if (part.parts) {
        for (const subpart of part.parts) {
          const text = extractBody(subpart as { mimeType?: string; body?: { data?: string }; parts?: unknown[] });
          if (text) return text;
        }
      }
      return '';
    };
    
    body = extractBody(message.payload || {});
    if (!body && message.payload?.body?.data) {
      body = atob(message.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    
    return {
      subject: getHeader('Subject'),
      from: getHeader('From'),
      body,
      threadId: message.threadId,
      replyTo: getHeader('Reply-To') || getHeader('From'),
    };
  } catch (error) {
    console.error('Error getting Gmail email:', error);
    return null;
  }
}

// Create Gmail draft
async function createGmailDraft(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  threadId: string
): Promise<string | null> {
  try {
    // Build RFC 2822 message
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const message = [
      `To: ${to}`,
      `Subject: ${replySubject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\r\n');
    
    const encodedMessage = btoa(unescape(encodeURIComponent(message)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          raw: encodedMessage,
          threadId: threadId
        }
      })
    });
    
    if (!res.ok) {
      console.error('Failed to create Gmail draft:', await res.text());
      return null;
    }
    
    const draft = await res.json();
    console.log(`Created Gmail draft: ${draft.id}`);
    return draft.id;
  } catch (error) {
    console.error('Error creating Gmail draft:', error);
    return null;
  }
}

// Send Gmail message (for auto-reply)
async function sendGmailMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  threadId: string
): Promise<boolean> {
  try {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const message = [
      `To: ${to}`,
      `Subject: ${replySubject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\r\n');
    
    const encodedMessage = btoa(unescape(encodeURIComponent(message)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: encodedMessage,
        threadId: threadId
      })
    });
    
    if (!res.ok) {
      console.error('Failed to send Gmail message:', await res.text());
      return false;
    }
    
    console.log('Sent Gmail auto-reply');
    return true;
  } catch (error) {
    console.error('Error sending Gmail message:', error);
    return false;
  }
}

// Get Outlook email details
async function getOutlookEmailDetails(accessToken: string, messageId: string): Promise<{
  subject: string;
  from: string;
  body: string;
  conversationId: string;
  replyTo: string;
} | null> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=subject,from,body,conversationId,replyTo`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) return null;
    
    const message = await res.json();
    
    return {
      subject: message.subject || '',
      from: message.from?.emailAddress?.address || '',
      body: message.body?.content || '',
      conversationId: message.conversationId || '',
      replyTo: message.replyTo?.[0]?.emailAddress?.address || message.from?.emailAddress?.address || '',
    };
  } catch (error) {
    console.error('Error getting Outlook email:', error);
    return null;
  }
}

// Create Outlook draft
async function createOutlookDraft(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  conversationId: string
): Promise<string | null> {
  try {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    
    const res = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subject: replySubject,
        body: {
          contentType: 'Text',
          content: body
        },
        toRecipients: [
          {
            emailAddress: { address: to }
          }
        ],
        conversationId: conversationId,
        isDraft: true
      })
    });
    
    if (!res.ok) {
      console.error('Failed to create Outlook draft:', await res.text());
      return null;
    }
    
    const draft = await res.json();
    console.log(`Created Outlook draft: ${draft.id}`);
    return draft.id;
  } catch (error) {
    console.error('Error creating Outlook draft:', error);
    return null;
  }
}

// Send Outlook message (for auto-reply)
async function sendOutlookReply(
  accessToken: string,
  messageId: string,
  body: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/reply`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          comment: body
        })
      }
    );
    
    if (!res.ok) {
      console.error('Failed to send Outlook reply:', await res.text());
      return false;
    }
    
    console.log('Sent Outlook auto-reply');
    return true;
  } catch (error) {
    console.error('Error sending Outlook reply:', error);
    return false;
  }
}

// Build Gmail search query from rule
// deno-lint-ignore no-explicit-any
function buildGmailSearchQuery(rule: any): string {
  const queryParts: string[] = [];
  
  if (rule.rule_type === 'sender') {
    queryParts.push(`from:${rule.rule_value}`);
  } else if (rule.rule_type === 'domain') {
    queryParts.push(`from:@${rule.rule_value}`);
  } else if (rule.rule_type === 'keyword') {
    queryParts.push(rule.rule_value);
  }

  if (rule.recipient_filter) {
    if (rule.recipient_filter === 'to_me') queryParts.push('to:me');
    else if (rule.recipient_filter === 'cc_me') queryParts.push('cc:me');
    else if (rule.recipient_filter === 'to_or_cc_me') queryParts.push('(to:me OR cc:me)');
  }

  if (rule.is_advanced) {
    const advancedParts: string[] = [];
    if (rule.subject_contains) {
      advancedParts.push(rule.subject_contains.includes(' ') 
        ? `subject:"${rule.subject_contains}"` 
        : `subject:${rule.subject_contains}`);
    }
    if (rule.body_contains) {
      advancedParts.push(rule.body_contains.includes(' ') 
        ? `"${rule.body_contains}"` 
        : rule.body_contains);
    }
    if (advancedParts.length > 0) {
      const connector = rule.condition_logic === 'or' ? ' OR ' : ' ';
      queryParts.push(`(${advancedParts.join(connector)})`);
    }
  }

  return queryParts.join(' ');
}

// Build Outlook search filter
// deno-lint-ignore no-explicit-any
function buildOutlookFilter(rule: any): string {
  const filters: string[] = [];
  
  if (rule.rule_type === 'sender') {
    filters.push(`contains(from/emailAddress/address, '${rule.rule_value}')`);
  } else if (rule.rule_type === 'domain') {
    filters.push(`contains(from/emailAddress/address, '@${rule.rule_value}')`);
  } else if (rule.rule_type === 'keyword') {
    filters.push(`(contains(subject, '${rule.rule_value}') or contains(body/content, '${rule.rule_value}'))`);
  }
  
  if (rule.is_advanced) {
    const advancedFilters: string[] = [];
    if (rule.subject_contains) {
      advancedFilters.push(`contains(subject, '${rule.subject_contains}')`);
    }
    if (rule.body_contains) {
      advancedFilters.push(`contains(body/content, '${rule.body_contains}')`);
    }
    if (advancedFilters.length > 0) {
      const connector = rule.condition_logic === 'or' ? ' or ' : ' and ';
      filters.push(`(${advancedFilters.join(connector)})`);
    }
  }
  
  return filters.join(' and ');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUserClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request for optional category_id filter
    let categoryId: string | null = null;
    try {
      const body = await req.json();
      categoryId = body?.category_id || null;
    } catch {
      // No body
    }

    // Get user's organization
    const { data: profileData } = await supabaseUserClient.rpc('get_my_profile');
    const profile = profileData?.[0];
    
    if (!profile?.organization_id) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get categories with AI draft or auto-reply enabled
    let categoriesQuery = supabaseAdmin
      .from('categories')
      .select('id, name, writing_style, ai_draft_enabled, auto_reply_enabled, sort_order')
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true)
      .or('ai_draft_enabled.eq.true,auto_reply_enabled.eq.true');

    if (categoryId) {
      categoriesQuery = categoriesQuery.eq('id', categoryId);
    }

    const { data: aiCategories, error: catError } = await categoriesQuery;

    if (catError || !aiCategories?.length) {
      console.log('No AI-enabled categories found');
      return new Response(
        JSON.stringify({ message: 'No AI-enabled categories', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${aiCategories.length} AI-enabled categories`);

    // Get rules for AI-enabled categories
    const categoryIds = aiCategories.map(c => c.id);
    const { data: rules } = await supabaseAdmin
      .from('rules')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true)
      .in('category_id', categoryIds);

    if (!rules?.length) {
      console.log('No rules found for AI categories');
      return new Response(
        JSON.stringify({ message: 'No rules for AI categories', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

    // Get tokens
    const { data: tokenDataList } = await supabaseAdmin
      .from('oauth_token_vault')
      .select('provider, encrypted_access_token, encrypted_refresh_token, expires_at')
      .eq('user_id', user.id);

    if (!tokenDataList?.length) {
      return new Response(
        JSON.stringify({ error: 'No connected email providers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get already processed emails to skip
    const { data: processedEmails } = await supabaseAdmin
      .from('processed_emails')
      .select('email_id, action_type, category_id')
      .eq('user_id', user.id);

    const processedSet = new Set(
      (processedEmails || []).map(p => `${p.email_id}:${p.category_id}:${p.action_type}`)
    );

    // Map category ID to category info
    const categoryMap = new Map(aiCategories.map(c => [c.id, c]));

    const results = {
      draftsCreated: 0,
      autoRepliesSent: 0,
      errors: 0
    };

    // Process each provider
    for (const tokenRecord of tokenDataList) {
      const accessToken = await getValidAccessToken(
        tokenRecord as TokenData,
        encryptionKey,
        user.id
      );
      
      if (!accessToken) {
        console.error(`Could not get token for ${tokenRecord.provider}`);
        continue;
      }

      // Process each rule
      for (const rule of rules) {
        const category = categoryMap.get(rule.category_id);
        if (!category) continue;

        console.log(`Processing rule for category: ${category.name}`);

        let matchingMessages: { id: string }[] = [];

        if (tokenRecord.provider === 'google') {
          // Search for matching emails in last 24 hours
          const query = buildGmailSearchQuery(rule) + ' newer_than:1d';
          const searchRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (searchRes.ok) {
            const data = await searchRes.json();
            matchingMessages = data.messages || [];
          }
        } else if (tokenRecord.provider === 'microsoft') {
          // Search for matching emails in last 24 hours
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const filter = `${buildOutlookFilter(rule)} and receivedDateTime ge ${yesterday}`;
          const searchRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$top=50&$select=id`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (searchRes.ok) {
            const data = await searchRes.json();
            matchingMessages = data.value || [];
          }
        }

        console.log(`Found ${matchingMessages.length} matching emails for rule`);

        // Process each matching email
        for (const msg of matchingMessages) {
          const needsDraft = category.ai_draft_enabled && 
            !processedSet.has(`${msg.id}:${category.id}:draft`);
          const needsAutoReply = category.auto_reply_enabled && 
            !processedSet.has(`${msg.id}:${category.id}:auto_reply`);

          if (!needsDraft && !needsAutoReply) {
            continue;
          }

          console.log(`Processing email ${msg.id} for ${category.name}`);

          let emailDetails;
          if (tokenRecord.provider === 'google') {
            emailDetails = await getGmailEmailDetails(accessToken, msg.id);
          } else {
            emailDetails = await getOutlookEmailDetails(accessToken, msg.id);
          }

          if (!emailDetails) {
            results.errors++;
            continue;
          }

          // Generate AI draft content
          const draftContent = await generateAIDraft(
            emailDetails.subject,
            emailDetails.body,
            emailDetails.from,
            category.name,
            category.writing_style
          );

          if (!draftContent) {
            console.error('Failed to generate AI draft');
            results.errors++;
            continue;
          }

          // Handle AI Draft (create draft in email provider)
          if (needsDraft) {
            let draftId: string | null = null;

            if (tokenRecord.provider === 'google') {
              draftId = await createGmailDraft(
                accessToken,
                emailDetails.replyTo,
                emailDetails.subject,
                draftContent,
                (emailDetails as { threadId: string }).threadId
              );
            } else {
              draftId = await createOutlookDraft(
                accessToken,
                emailDetails.replyTo,
                emailDetails.subject,
                draftContent,
                (emailDetails as { conversationId: string }).conversationId
              );
            }

            if (draftId) {
              // Record processed email
              await supabaseAdmin.from('processed_emails').insert({
                organization_id: profile.organization_id,
                user_id: user.id,
                email_id: msg.id,
                category_id: category.id,
                provider: tokenRecord.provider,
                action_type: 'draft',
                draft_id: draftId
              });

              // Log activity
              await supabaseAdmin.from('ai_activity_logs').insert({
                organization_id: profile.organization_id,
                user_id: user.id,
                category_id: category.id,
                category_name: category.name,
                activity_type: 'draft',
                email_subject: emailDetails.subject,
                email_from: emailDetails.from
              });

              results.draftsCreated++;
              console.log(`Created draft for email ${msg.id}`);
            }
          }

          // Handle Auto-Reply (send email)
          if (needsAutoReply) {
            let sent = false;

            if (tokenRecord.provider === 'google') {
              sent = await sendGmailMessage(
                accessToken,
                emailDetails.replyTo,
                emailDetails.subject,
                draftContent,
                (emailDetails as { threadId: string }).threadId
              );
            } else {
              sent = await sendOutlookReply(accessToken, msg.id, draftContent);
            }

            if (sent) {
              // Record processed email
              await supabaseAdmin.from('processed_emails').insert({
                organization_id: profile.organization_id,
                user_id: user.id,
                email_id: msg.id,
                category_id: category.id,
                provider: tokenRecord.provider,
                action_type: 'auto_reply',
                sent_at: new Date().toISOString()
              });

              // Log activity
              await supabaseAdmin.from('ai_activity_logs').insert({
                organization_id: profile.organization_id,
                user_id: user.id,
                category_id: category.id,
                category_name: category.name,
                activity_type: 'auto_reply',
                email_subject: emailDetails.subject,
                email_from: emailDetails.from
              });

              results.autoRepliesSent++;
              console.log(`Sent auto-reply for email ${msg.id}`);
            }
          }
        }
      }
    }

    console.log(`AI Processing complete: ${results.draftsCreated} drafts, ${results.autoRepliesSent} auto-replies`);

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        message: `Created ${results.draftsCreated} drafts, sent ${results.autoRepliesSent} auto-replies`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Process AI emails error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

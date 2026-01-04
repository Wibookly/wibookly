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
  
  console.log(`Token for ${tokenData.provider} is expired, attempting refresh...`);
  
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
  
  if (!newTokens) {
    console.error(`Failed to refresh token for ${tokenData.provider}`);
    return null;
  }
  
  // Encrypt and save new tokens
  const encryptedAccessToken = await encryptToken(newTokens.access_token, encryptionKey);
  const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
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

// Remove Gmail label from emails matching rule criteria
async function removeGmailLabel(
  accessToken: string, 
  ruleType: string, 
  ruleValue: string, 
  labelId: string
): Promise<{ removed: number }> {
  let searchQuery = '';
  
  if (ruleType === 'sender') {
    searchQuery = `from:${ruleValue} label:${labelId}`;
  } else if (ruleType === 'domain') {
    searchQuery = `from:@${ruleValue} label:${labelId}`;
  } else if (ruleType === 'keyword') {
    searchQuery = `${ruleValue} label:${labelId}`;
  }

  // Also search by label to ensure we only get labeled emails
  console.log(`Searching for emails to unlabel with query: ${searchQuery}`);
  
  const searchRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=500`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!searchRes.ok) {
    console.error('Failed to search emails:', await searchRes.text());
    return { removed: 0 };
  }

  const { messages } = await searchRes.json();
  
  if (!messages || messages.length === 0) {
    console.log('No emails found to unlabel');
    return { removed: 0 };
  }

  console.log(`Found ${messages.length} emails to unlabel`);
  
  const messageIds = messages.map((m: { id: string }) => m.id);
  
  const batchRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: messageIds,
        removeLabelIds: [labelId],
        addLabelIds: []
      })
    }
  );

  if (!batchRes.ok) {
    console.error('Failed to remove labels:', await batchRes.text());
    return { removed: 0 };
  }

  console.log(`Removed label from ${messageIds.length} emails`);
  return { removed: messageIds.length };
}

// Delete Gmail filter for a rule
async function deleteGmailFilter(
  accessToken: string,
  ruleType: string,
  ruleValue: string
): Promise<boolean> {
  // List all filters
  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) {
    console.error('Failed to list Gmail filters:', await listRes.text());
    return false;
  }

  const { filter: filters } = await listRes.json();
  
  if (!filters) {
    console.log('No filters found');
    return true;
  }

  // Find matching filter
  let targetCriteria = '';
  if (ruleType === 'sender') {
    targetCriteria = ruleValue;
  } else if (ruleType === 'domain') {
    targetCriteria = `@${ruleValue}`;
  }

  for (const filter of filters) {
    const matchesSender = filter.criteria?.from === targetCriteria;
    const matchesKeyword = ruleType === 'keyword' && filter.criteria?.query === ruleValue;
    
    if (matchesSender || matchesKeyword) {
      console.log(`Deleting Gmail filter: ${filter.id}`);
      const deleteRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/${filter.id}`,
        { 
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` } 
        }
      );
      
      if (deleteRes.ok) {
        console.log('Successfully deleted Gmail filter');
        return true;
      } else {
        console.error('Failed to delete filter:', await deleteRes.text());
      }
    }
  }

  return true;
}

// Move Outlook emails back to inbox
async function moveOutlookEmailsToInbox(
  accessToken: string,
  ruleType: string,
  ruleValue: string,
  folderId: string
): Promise<{ moved: number }> {
  // Get inbox folder ID
  const inboxRes = await fetch(
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!inboxRes.ok) {
    console.error('Failed to get inbox folder:', await inboxRes.text());
    return { moved: 0 };
  }

  const inbox = await inboxRes.json();
  const inboxId = inbox.id;

  // Get emails from the category folder
  const messagesRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=500`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!messagesRes.ok) {
    console.error('Failed to get folder messages:', await messagesRes.text());
    return { moved: 0 };
  }

  const { value: messages } = await messagesRes.json();
  
  if (!messages || messages.length === 0) {
    console.log('No emails found to move back');
    return { moved: 0 };
  }

  // Filter messages that match the rule
  const matchingMessages = messages.filter((msg: { from?: { emailAddress?: { address?: string } }, subject?: string, bodyPreview?: string }) => {
    const senderEmail = msg.from?.emailAddress?.address?.toLowerCase() || '';
    const subject = msg.subject?.toLowerCase() || '';
    const body = msg.bodyPreview?.toLowerCase() || '';
    
    if (ruleType === 'sender') {
      return senderEmail === ruleValue.toLowerCase();
    } else if (ruleType === 'domain') {
      return senderEmail.endsWith(`@${ruleValue.toLowerCase()}`);
    } else if (ruleType === 'keyword') {
      return subject.includes(ruleValue.toLowerCase()) || body.includes(ruleValue.toLowerCase());
    }
    return false;
  });

  console.log(`Found ${matchingMessages.length} matching emails to move back to inbox`);

  let movedCount = 0;
  for (const msg of matchingMessages) {
    const moveRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/move`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ destinationId: inboxId })
      }
    );

    if (moveRes.ok) {
      movedCount++;
    }
  }

  console.log(`Moved ${movedCount} emails back to inbox`);
  return { moved: movedCount };
}

// Delete Outlook rule
async function deleteOutlookRule(accessToken: string, ruleName: string): Promise<boolean> {
  const listRes = await fetch(
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) {
    console.error('Failed to list Outlook rules:', await listRes.text());
    return false;
  }

  const { value: rules } = await listRes.json();
  const targetRule = rules?.find((r: { displayName: string }) => r.displayName === ruleName);

  if (targetRule) {
    const deleteRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules/${targetRule.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (deleteRes.ok) {
      console.log(`Deleted Outlook rule: ${ruleName}`);
      return true;
    } else {
      console.error('Failed to delete Outlook rule:', await deleteRes.text());
    }
  }

  return true;
}

// Get Gmail label ID by name
async function getGmailLabelId(accessToken: string, labelName: string): Promise<string | null> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!res.ok) return null;
  
  const { labels } = await res.json();
  const label = labels?.find((l: { name: string, id: string }) => l.name === labelName);
  return label?.id || null;
}

// Get Outlook folder ID by name
async function getOutlookFolderId(accessToken: string, folderName: string): Promise<string | null> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!res.ok) return null;
  
  const { value: folders } = await res.json();
  const folder = folders?.find((f: { displayName: string, id: string }) => f.displayName === folderName);
  return folder?.id || null;
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

    const { rule_type, rule_value, category_name, category_sort_order } = await req.json();
    
    if (!rule_type || !rule_value || !category_name || category_sort_order === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: rule_type, rule_value, category_name, category_sort_order' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Cleaning up rule: ${rule_type}=${rule_value} for category "${category_name}" (sort_order: ${category_sort_order})`);

    const labelName = `${category_sort_order + 1}: ${category_name}`;
    console.log(`Looking for label/folder: ${labelName}`);

    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;
    
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: tokenDataList, error: tokenError } = await supabaseAdmin
      .from('oauth_token_vault')
      .select('provider, encrypted_access_token, encrypted_refresh_token, expires_at')
      .eq('user_id', user.id);

    if (tokenError || !tokenDataList?.length) {
      return new Response(
        JSON.stringify({ error: 'No connected email providers found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: { provider: string; emailsProcessed: number; filterDeleted: boolean }[] = [];

    for (const tokenData of tokenDataList) {
      const accessToken = await getValidAccessToken(tokenData as TokenData, encryptionKey, user.id);
      
      if (!accessToken) {
        console.error(`Failed to get access token for ${tokenData.provider}`);
        continue;
      }

      if (tokenData.provider === 'google') {
        const labelId = await getGmailLabelId(accessToken, labelName);
        
        if (labelId) {
          const { removed } = await removeGmailLabel(accessToken, rule_type, rule_value, labelId);
          const filterDeleted = await deleteGmailFilter(accessToken, rule_type, rule_value);
          
          results.push({
            provider: 'google',
            emailsProcessed: removed,
            filterDeleted
          });
        } else {
          console.log(`Gmail label "${labelName}" not found`);
          results.push({ provider: 'google', emailsProcessed: 0, filterDeleted: false });
        }
      } else if (tokenData.provider === 'microsoft') {
        const folderId = await getOutlookFolderId(accessToken, labelName);
        
        if (folderId) {
          const { moved } = await moveOutlookEmailsToInbox(accessToken, rule_type, rule_value, folderId);
          const ruleName = `Wibookly: ${labelName} - ${rule_type}:${rule_value}`;
          const ruleDeleted = await deleteOutlookRule(accessToken, ruleName);
          
          results.push({
            provider: 'microsoft',
            emailsProcessed: moved,
            filterDeleted: ruleDeleted
          });
        } else {
          console.log(`Outlook folder "${labelName}" not found`);
          results.push({ provider: 'microsoft', emailsProcessed: 0, filterDeleted: false });
        }
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.emailsProcessed, 0);
    console.log(`Cleanup complete. Total emails processed: ${totalProcessed}`);

    return new Response(
      JSON.stringify({ 
        message: 'Rule cleanup complete',
        results,
        totalEmailsProcessed: totalProcessed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in cleanup-rule:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AES-GCM decryption for tokens (server-side only)
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

// Refresh Google access token using refresh token
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  
  console.log('Refreshing Google access token...');
  
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
  
  const tokens = await response.json();
  console.log('Successfully refreshed Google token');
  return tokens;
}

// Refresh Microsoft access token using refresh token
async function refreshMicrosoftToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number } | null> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  
  console.log('Refreshing Microsoft access token...');
  
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
  
  const tokens = await response.json();
  console.log('Successfully refreshed Microsoft token');
  return tokens;
}

interface TokenData {
  provider: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

// Get valid access token, refreshing if expired
// deno-lint-ignore no-explicit-any
async function getValidAccessToken(
  tokenData: TokenData,
  encryptionKey: string,
  userId: string
): Promise<string | null> {
  const isExpired = tokenData.expires_at && new Date(tokenData.expires_at) < new Date();
  
  // If not expired, return decrypted access token
  if (!isExpired) {
    return await decryptToken(tokenData.encrypted_access_token, encryptionKey);
  }
  
  console.log(`Token for ${tokenData.provider} is expired, attempting refresh...`);
  
  // Need to refresh - check if we have a refresh token
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
  
  // Update token in vault using direct fetch to avoid type issues
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const updatePayload: Record<string, string> = {
    encrypted_access_token: encryptedAccessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };
  
  // Microsoft may return a new refresh token
  if (tokenData.provider === 'microsoft' && 'refresh_token' in newTokens && newTokens.refresh_token) {
    updatePayload.encrypted_refresh_token = await encryptToken(String(newTokens.refresh_token), encryptionKey);
  }
  
  const updateResponse = await fetch(
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
  
  if (!updateResponse.ok) {
    console.error(`Failed to save refreshed token for ${tokenData.provider}:`, await updateResponse.text());
  } else {
    console.log(`Saved refreshed token for ${tokenData.provider}`);
  }
  
  return newTokens.access_token;
}

// Apply Gmail filter for a rule AND apply to existing emails
// deno-lint-ignore no-explicit-any
async function applyGmailFilter(accessToken: string, rule: any, labelId: string): Promise<boolean> {
  try {
    // deno-lint-ignore no-explicit-any
    let criteria: any = {};
    const queryParts: string[] = [];
    
    // Primary condition
    if (rule.rule_type === 'sender') {
      criteria.from = rule.rule_value;
      queryParts.push(`from:${rule.rule_value}`);
    } else if (rule.rule_type === 'domain') {
      criteria.from = `@${rule.rule_value}`;
      queryParts.push(`from:@${rule.rule_value}`);
    } else if (rule.rule_type === 'keyword') {
      criteria.query = rule.rule_value;
      queryParts.push(rule.rule_value);
    }

    // Recipient filter (to:me, cc:me)
    if (rule.recipient_filter) {
      if (rule.recipient_filter === 'to_me') {
        queryParts.push('to:me');
        criteria.to = 'me';
      } else if (rule.recipient_filter === 'cc_me') {
        queryParts.push('cc:me');
        // Gmail doesn't have cc in filter criteria, but we can search for it
      } else if (rule.recipient_filter === 'to_or_cc_me') {
        queryParts.push('(to:me OR cc:me)');
      }
    }

    // Advanced conditions - support AND/OR logic
    if (rule.is_advanced) {
      const conditionLogic = rule.condition_logic || 'and';
      const advancedParts: string[] = [];

      if (rule.subject_contains) {
        // Use quotes for exact phrase matching in subject
        const subjectTerm = rule.subject_contains.includes(' ') 
          ? `subject:"${rule.subject_contains}"`
          : `subject:${rule.subject_contains}`;
        advancedParts.push(subjectTerm);
      }
      if (rule.body_contains) {
        // Use quotes for exact phrase matching in body
        const bodyTerm = rule.body_contains.includes(' ')
          ? `"${rule.body_contains}"`
          : rule.body_contains;
        advancedParts.push(bodyTerm);
      }

      // Combine advanced conditions with AND or OR
      if (advancedParts.length > 0) {
        if (conditionLogic === 'or') {
          queryParts.push(`(${advancedParts.join(' OR ')})`);
        } else {
          // AND is the default - just add them
          queryParts.push(...advancedParts);
        }
      }
    }

    // Build final criteria.query from all conditions for the filter
    // Gmail filters need query for complex conditions (subject, body searches)
    if (queryParts.length > 0) {
      criteria.query = queryParts.join(' ');
    }

    const searchQuery = queryParts.join(' ');

    // Create filter for new emails
    const filterRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        criteria,
        action: {
          addLabelIds: [labelId],
          removeLabelIds: []
        }
      })
    });

    if (!filterRes.ok) {
      const errorText = await filterRes.text();
      // Check if filter already exists (409 conflict)
      if (filterRes.status === 409) {
        console.log(`Gmail filter for "${rule.rule_value}" already exists`);
      } else {
        console.error(`Failed to create Gmail filter:`, errorText);
      }
    } else {
      console.log(`Created Gmail filter for: ${rule.rule_value}${rule.is_advanced ? ' (advanced)' : ''}`);
    }

    // Apply label to existing emails matching the criteria
    console.log(`Searching for existing emails with query: ${searchQuery}`);
    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=500`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // Get all emails currently with this label (to find non-matching ones)
    const labeledRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=${labelId}&maxResults=500`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const matchingMessages = searchRes.ok ? (await searchRes.json()).messages || [] : [];
    const labeledMessages = labeledRes.ok ? (await labeledRes.json()).messages || [] : [];

    const matchingIds = new Set(matchingMessages.map((m: { id: string }) => m.id));
    const labeledIds = labeledMessages.map((m: { id: string }) => m.id);

    // Find emails that have the label but don't match the rule anymore
    const nonMatchingIds = labeledIds.filter((id: string) => !matchingIds.has(id));

    // Remove label from non-matching emails (move them back to inbox visibility)
    if (nonMatchingIds.length > 0) {
      console.log(`Found ${nonMatchingIds.length} emails that no longer match the rule - removing label`);
      
      const removeRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ids: nonMatchingIds,
            addLabelIds: [],
            removeLabelIds: [labelId]
          })
        }
      );

      if (removeRes.ok) {
        console.log(`Removed label from ${nonMatchingIds.length} non-matching emails`);
      } else {
        console.error(`Failed to remove label from non-matching emails:`, await removeRes.text());
      }
    }

    // Apply label to matching emails
    if (matchingMessages.length > 0) {
      console.log(`Found ${matchingMessages.length} existing emails to label`);
      
      const messageIds = matchingMessages.map((m: { id: string }) => m.id);
      
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
            addLabelIds: [labelId],
            removeLabelIds: []
          })
        }
      );

      if (batchRes.ok) {
        console.log(`Applied label to ${messageIds.length} existing emails`);
      } else {
        console.error(`Failed to apply label to existing emails:`, await batchRes.text());
      }
    } else {
      console.log(`No existing emails found matching: ${searchQuery}`);
    }

    return true;
  } catch (error) {
    console.error(`Error creating Gmail filter:`, error);
    return false;
  }
}

// Build Outlook search filter query
// deno-lint-ignore no-explicit-any
function buildOutlookSearchFilter(rule: any): string {
  const filters: string[] = [];
  
  if (rule.rule_type === 'sender') {
    filters.push(`contains(from/emailAddress/address, '${rule.rule_value}')`);
  } else if (rule.rule_type === 'domain') {
    filters.push(`contains(from/emailAddress/address, '@${rule.rule_value}')`);
  } else if (rule.rule_type === 'keyword') {
    filters.push(`(contains(subject, '${rule.rule_value}') or contains(body/content, '${rule.rule_value}'))`);
  }
  
  if (rule.is_advanced) {
    const conditionLogic = rule.condition_logic || 'and';
    const advancedFilters: string[] = [];
    
    if (rule.subject_contains) {
      advancedFilters.push(`contains(subject, '${rule.subject_contains}')`);
    }
    if (rule.body_contains) {
      advancedFilters.push(`contains(body/content, '${rule.body_contains}')`);
    }
    
    if (advancedFilters.length > 0) {
      const connector = conditionLogic === 'or' ? ' or ' : ' and ';
      filters.push(`(${advancedFilters.join(connector)})`);
    }
  }
  
  return filters.join(' and ');
}

// Apply Outlook rule
// deno-lint-ignore no-explicit-any
async function applyOutlookRule(accessToken: string, rule: any, folderId: string, ruleName: string): Promise<boolean> {
  try {
    // Check if rule already exists
    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!listRes.ok) {
      console.error('Failed to list Outlook rules:', await listRes.text());
      return false;
    }

    const { value: existingRules } = await listRes.json();
    const exists = existingRules?.some((r: { displayName: string }) => r.displayName === ruleName);

    if (exists) {
      console.log(`Outlook rule "${ruleName}" already exists`);
    } else {
      // Build conditions based on rule type
      // deno-lint-ignore no-explicit-any
      let conditions: any = {};
      
      if (rule.rule_type === 'sender') {
        conditions.senderContains = [rule.rule_value];
      } else if (rule.rule_type === 'domain') {
        conditions.senderContains = [`@${rule.rule_value}`];
      } else if (rule.rule_type === 'keyword') {
        conditions.subjectOrBodyContains = [rule.rule_value];
      }

      // Recipient filter
      if (rule.recipient_filter) {
        if (rule.recipient_filter === 'to_me') {
          conditions.sentToMe = true;
        } else if (rule.recipient_filter === 'cc_me') {
          conditions.sentCcMe = true;
        } else if (rule.recipient_filter === 'to_or_cc_me') {
          conditions.sentToMe = true;
        }
      }

      // Advanced conditions
      if (rule.is_advanced) {
        const conditionLogic = rule.condition_logic || 'and';

        if (conditionLogic === 'or') {
          const orTerms: string[] = [];
          if (rule.subject_contains) orTerms.push(rule.subject_contains);
          if (rule.body_contains) orTerms.push(rule.body_contains);
          if (orTerms.length > 0) {
            conditions.subjectOrBodyContains = conditions.subjectOrBodyContains 
              ? [...conditions.subjectOrBodyContains, ...orTerms]
              : orTerms;
          }
        } else {
          if (rule.subject_contains) {
            conditions.subjectContains = [rule.subject_contains];
          }
          if (rule.body_contains) {
            conditions.bodyContains = [rule.body_contains];
          }
        }
      }

      // Create rule
      const createRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          displayName: ruleName,
          sequence: 1,
          isEnabled: true,
          conditions,
          actions: {
            moveToFolder: folderId
          }
        })
      });

      if (!createRes.ok) {
        console.error(`Failed to create Outlook rule "${ruleName}":`, await createRes.text());
        return false;
      }

      console.log(`Created Outlook rule: ${ruleName}`);
    }

    // Get inbox folder ID
    const inboxRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!inboxRes.ok) {
      console.error('Failed to get inbox folder');
      return true; // Rule created, but couldn't clean up
    }
    
    const inboxFolder = await inboxRes.json();
    const inboxId = inboxFolder.id;

    // Get emails currently in the folder
    const folderEmailsRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=500&$select=id,from,subject,body`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!folderEmailsRes.ok) {
      console.log('Could not fetch folder emails for cleanup');
      return true;
    }

    const { value: folderEmails } = await folderEmailsRes.json();
    
    if (!folderEmails || folderEmails.length === 0) {
      console.log('No emails in folder to check');
      return true;
    }

    // Build search filter and find matching emails in inbox
    const searchFilter = buildOutlookSearchFilter(rule);
    const matchingRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(searchFilter)}&$top=500&$select=id`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const matchingEmails = matchingRes.ok ? (await matchingRes.json()).value || [] : [];
    const matchingIds = new Set(matchingEmails.map((m: { id: string }) => m.id));

    // Find emails in folder that don't match the rule anymore
    // deno-lint-ignore no-explicit-any
    const nonMatchingEmails = folderEmails.filter((email: any) => !matchingIds.has(email.id));

    // Move non-matching emails back to inbox
    for (const email of nonMatchingEmails) {
      try {
        const moveRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${email.id}/move`,
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
          console.log(`Moved non-matching email back to inbox: ${email.subject}`);
        }
      } catch (err) {
        console.error('Error moving email to inbox:', err);
      }
    }

    if (nonMatchingEmails.length > 0) {
      console.log(`Moved ${nonMatchingEmails.length} non-matching emails back to inbox`);
    }

    return true;
  } catch (error) {
    console.error(`Error creating Outlook rule "${ruleName}":`, error);
    return false;
  }
}

// Get Gmail label ID by name
async function getGmailLabelId(accessToken: string, labelName: string): Promise<string | null> {
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!res.ok) return null;
    
    const { labels } = await res.json();
    const label = labels?.find((l: { name: string, id: string }) => l.name === labelName);
    return label?.id || null;
  } catch {
    return null;
  }
}

// Get Outlook folder ID by name
async function getOutlookFolderId(accessToken: string, folderName: string): Promise<string | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!res.ok) return null;
    
    const { value: folders } = await res.json();
    const folder = folders?.find((f: { displayName: string, id: string }) => f.displayName === folderName);
    return folder?.id || null;
  } catch {
    return null;
  }
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

    // Parse request body for optional rule_id filter
    let ruleId: string | null = null;
    try {
      const body = await req.json();
      ruleId = body?.rule_id || null;
    } catch {
      // No body or invalid JSON - run all rules
    }

    // Get user's organization using RPC function
    const { data: profileData } = await supabaseUserClient.rpc('get_my_profile');
    const profile = profileData?.[0];
    
    if (!profile?.organization_id) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get rules with category info
    let rulesQuery = supabaseAdmin
      .from('rules')
      .select(`
        id,
        rule_type,
        rule_value,
        is_enabled,
        is_advanced,
        subject_contains,
        body_contains,
        condition_logic,
        recipient_filter,
        category_id,
        categories!inner(name, is_enabled, sort_order)
      `)
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true);

    if (ruleId) {
      rulesQuery = rulesQuery.eq('id', ruleId);
    }

    const { data: rules, error: rulesError } = await rulesQuery;

    if (rulesError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch rules' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter rules where category is enabled
    // deno-lint-ignore no-explicit-any
    const enabledRules = rules?.filter(r => (r.categories as any)?.is_enabled) || [];

    if (enabledRules.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No enabled rules found', synced: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

    // Get tokens from vault (including refresh token and expiry for refresh logic)
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

    // Get ENABLED categories for numbering - use sort_order for label names
    const { data: enabledCategories } = await supabaseAdmin
      .from('categories')
      .select('id, name, sort_order')
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true)
      .order('sort_order');

    // Map category ID to its sort_order (used for label naming)
    const categoryMap = new Map(enabledCategories?.map((c) => [c.id, { name: c.name, sortOrder: c.sort_order }]));

    const results: { provider: string; synced: number; failed: number }[] = [];

    // Process each connected provider
    for (const tokenRecord of tokenDataList) {
      try {
        // Get valid access token (will refresh if expired)
        const accessToken = await getValidAccessToken(
          tokenRecord as TokenData,
          encryptionKey,
          user.id
        );
        
        if (!accessToken) {
          console.error(`Could not get valid access token for ${tokenRecord.provider}`);
          results.push({ provider: tokenRecord.provider, synced: 0, failed: enabledRules.length });
          continue;
        }

        let synced = 0;
        let failed = 0;

        for (const rule of enabledRules) {
          const catInfo = categoryMap.get(rule.category_id);
          if (!catInfo) continue;

          // Use actual sort_order for label name (1-indexed)
          const labelName = `${catInfo.sortOrder + 1}: ${catInfo.name}`;
          let success = false;
          
          if (tokenRecord.provider === 'google') {
            const labelId = await getGmailLabelId(accessToken, labelName);
            if (labelId) {
              success = await applyGmailFilter(accessToken, rule, labelId);
            } else {
              console.log(`Gmail label "${labelName}" not found - please sync categories first`);
            }
          } else if (tokenRecord.provider === 'microsoft') {
            const folderId = await getOutlookFolderId(accessToken, labelName);
            if (folderId) {
              const ruleName = `Wibookly: ${rule.rule_type} - ${rule.rule_value}`;
              success = await applyOutlookRule(accessToken, rule, folderId, ruleName);
            } else {
              console.log(`Outlook folder "${labelName}" not found - please sync categories first`);
            }
          }
          
          if (success) {
            synced++;
            // Update last_synced_at for this rule
            await supabaseAdmin
              .from('rules')
              .update({ last_synced_at: new Date().toISOString() })
              .eq('id', rule.id);
          } else {
            failed++;
          }
        }

        results.push({ provider: tokenRecord.provider, synced, failed });
      } catch (error) {
        console.error(`Failed to process ${tokenRecord.provider}:`, error);
        results.push({ provider: tokenRecord.provider, synced: 0, failed: enabledRules.length });
      }
    }

    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
    
    // After syncing rules, trigger AI email processing for categories with AI features enabled
    // This runs asynchronously in the background
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    console.log('Triggering AI email processing...');
    
    try {
      const aiProcessResponse = await fetch(`${supabaseUrl}/functions/v1/process-ai-emails`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trigger: 'sync-rules' })
      });
      
      if (aiProcessResponse.ok) {
        const aiResult = await aiProcessResponse.json();
        console.log('AI processing result:', aiResult);
      } else {
        console.error('AI processing failed:', await aiProcessResponse.text());
      }
    } catch (aiError) {
      console.error('Error calling AI processing:', aiError);
      // Don't fail the sync if AI processing fails
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        message: `Synced ${totalSynced} rule(s) across ${results.length} provider(s)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Sync rules error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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

// Apply Gmail filter for a rule
// deno-lint-ignore no-explicit-any
async function applyGmailFilter(accessToken: string, rule: any, labelId: string): Promise<boolean> {
  try {
    // deno-lint-ignore no-explicit-any
    let criteria: any = {};
    
    if (rule.rule_type === 'sender') {
      criteria.from = rule.rule_value;
    } else if (rule.rule_type === 'domain') {
      criteria.from = `@${rule.rule_value}`;
    } else if (rule.rule_type === 'keyword') {
      criteria.query = rule.rule_value;
    }

    // Create filter
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
        return true;
      }
      console.error(`Failed to create Gmail filter:`, errorText);
      return false;
    }

    console.log(`Created Gmail filter for: ${rule.rule_value}`);
    return true;
  } catch (error) {
    console.error(`Error creating Gmail filter:`, error);
    return false;
  }
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
      return true;
    }

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

    // Get ENABLED categories for numbering (must match sync-categories logic)
    const { data: enabledCategories } = await supabaseAdmin
      .from('categories')
      .select('id, name, sort_order')
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true)
      .order('sort_order');

    // Map category ID to its position among enabled categories (1-indexed label names)
    const categoryMap = new Map(enabledCategories?.map((c, i) => [c.id, { name: c.name, index: i }]));

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

          const labelName = `${catInfo.index + 1}: ${catInfo.name}`;
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
          
          if (success) synced++;
          else failed++;
        }

        results.push({ provider: tokenRecord.provider, synced, failed });
      } catch (error) {
        console.error(`Failed to process ${tokenRecord.provider}:`, error);
        results.push({ provider: tokenRecord.provider, synced: 0, failed: enabledRules.length });
      }
    }

    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
    
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

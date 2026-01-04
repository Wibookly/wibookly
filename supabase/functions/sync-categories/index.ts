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
  supabaseAdmin: any,
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

// Convert hex color to Gmail color palette (Gmail only supports specific colors)
function hexToGmailColor(hex: string): { backgroundColor: string; textColor: string } {
  // Gmail only allows specific color values from their palette
  // Map common colors to Gmail's supported palette
  const colorMap: Record<string, { backgroundColor: string; textColor: string }> = {
    // Reds
    '#EF4444': { backgroundColor: '#cc3a21', textColor: '#ffffff' },
    '#DC2626': { backgroundColor: '#cc3a21', textColor: '#ffffff' },
    '#B91C1C': { backgroundColor: '#ac2b16', textColor: '#ffffff' },
    // Oranges
    '#F97316': { backgroundColor: '#f2a600', textColor: '#000000' },
    '#EA580C': { backgroundColor: '#cf8933', textColor: '#000000' },
    // Yellows
    '#EAB308': { backgroundColor: '#f2c960', textColor: '#000000' },
    '#FACC15': { backgroundColor: '#f2c960', textColor: '#000000' },
    // Greens
    '#22C55E': { backgroundColor: '#149e60', textColor: '#ffffff' },
    '#16A34A': { backgroundColor: '#0d804f', textColor: '#ffffff' },
    // Teals
    '#14B8A6': { backgroundColor: '#2da2bb', textColor: '#ffffff' },
    '#06B6D4': { backgroundColor: '#2da2bb', textColor: '#ffffff' },
    // Blues
    '#3B82F6': { backgroundColor: '#285bac', textColor: '#ffffff' },
    '#2563EB': { backgroundColor: '#1a73e8', textColor: '#ffffff' },
    // Purples
    '#8B5CF6': { backgroundColor: '#653e9b', textColor: '#ffffff' },
    '#7C3AED': { backgroundColor: '#653e9b', textColor: '#ffffff' },
    // Pinks
    '#EC4899': { backgroundColor: '#c9649b', textColor: '#ffffff' },
    '#DB2777': { backgroundColor: '#c9649b', textColor: '#ffffff' },
    // Grays
    '#6B7280': { backgroundColor: '#666666', textColor: '#ffffff' },
    '#9CA3AF': { backgroundColor: '#999999', textColor: '#000000' },
  };

  const upperHex = hex.toUpperCase();
  if (colorMap[upperHex]) return colorMap[upperHex];

  // Default fallback - parse hex and find closest match
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Simple heuristic: map to closest category
  if (r > 180 && g < 100 && b < 100) return { backgroundColor: '#cc3a21', textColor: '#ffffff' }; // Red
  if (r > 180 && g > 100 && g < 180) return { backgroundColor: '#f2a600', textColor: '#000000' }; // Orange
  if (r > 180 && g > 180) return { backgroundColor: '#f2c960', textColor: '#000000' }; // Yellow
  if (g > r && g > b) return { backgroundColor: '#149e60', textColor: '#ffffff' }; // Green
  if (b > r && b > 150) return { backgroundColor: '#285bac', textColor: '#ffffff' }; // Blue
  if (r > 100 && b > 100 && g < 100) return { backgroundColor: '#653e9b', textColor: '#ffffff' }; // Purple
  
  return { backgroundColor: '#666666', textColor: '#ffffff' }; // Default gray
}

// Create Gmail label with color
async function createGmailLabel(accessToken: string, labelName: string, hexColor: string): Promise<boolean> {
  try {
    // Check if label already exists
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) {
      console.error('Failed to list Gmail labels:', await listRes.text());
      return false;
    }
    
    const { labels } = await listRes.json();
    const existingLabel = labels?.find((l: { name: string }) => l.name === labelName);
    const gmailColor = hexToGmailColor(hexColor);
    
    if (existingLabel) {
      console.log(`Gmail label "${labelName}" already exists, updating color...`);
      // Update existing label's color
      const updateRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${existingLabel.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          color: gmailColor
        })
      });
      
      if (!updateRes.ok) {
        console.error(`Failed to update Gmail label color:`, await updateRes.text());
      } else {
        console.log(`Updated color for Gmail label: ${labelName}`);
      }
      return true;
    }
    
    // Create the label with color
    const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        color: gmailColor
      })
    });
    
    if (!createRes.ok) {
      console.error(`Failed to create Gmail label "${labelName}":`, await createRes.text());
      return false;
    }
    
    console.log(`Created Gmail label with color: ${labelName}`);
    return true;
  } catch (error) {
    console.error(`Error creating Gmail label "${labelName}":`, error);
    return false;
  }
}

// Delete Gmail label
async function deleteGmailLabel(accessToken: string, labelName: string): Promise<boolean> {
  try {
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) return false;
    
    const { labels } = await listRes.json();
    const label = labels?.find((l: { name: string }) => l.name === labelName);
    
    if (!label) {
      console.log(`Gmail label "${labelName}" doesn't exist, nothing to delete`);
      return true;
    }
    
    const deleteRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${label.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!deleteRes.ok && deleteRes.status !== 404) {
      console.error(`Failed to delete Gmail label "${labelName}":`, await deleteRes.text());
      return false;
    }
    
    console.log(`Deleted Gmail label: ${labelName}`);
    return true;
  } catch (error) {
    console.error(`Error deleting Gmail label "${labelName}":`, error);
    return false;
  }
}

// Delete Outlook folder
async function deleteOutlookFolder(accessToken: string, folderName: string): Promise<boolean> {
  try {
    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) return false;
    
    const { value: folders } = await listRes.json();
    const folder = folders?.find((f: { displayName: string }) => f.displayName === folderName);
    
    if (!folder) {
      console.log(`Outlook folder "${folderName}" doesn't exist, nothing to delete`);
      return true;
    }
    
    const deleteRes = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!deleteRes.ok && deleteRes.status !== 404) {
      console.error(`Failed to delete Outlook folder "${folderName}":`, await deleteRes.text());
      return false;
    }
    
    console.log(`Deleted Outlook folder: ${folderName}`);
    return true;
  } catch (error) {
    console.error(`Error deleting Outlook folder "${folderName}":`, error);
    return false;
  }
}

// Create Outlook folder
async function createOutlookFolder(accessToken: string, folderName: string): Promise<boolean> {
  try {
    // Check if folder already exists
    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) {
      console.error('Failed to list Outlook folders:', await listRes.text());
      return false;
    }
    
    const { value: folders } = await listRes.json();
    const exists = folders?.some((f: { displayName: string }) => f.displayName === folderName);
    
    if (exists) {
      console.log(`Outlook folder "${folderName}" already exists`);
      return true;
    }
    
    // Create the folder
    const createRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ displayName: folderName })
    });
    
    if (!createRes.ok) {
      console.error(`Failed to create Outlook folder "${folderName}":`, await createRes.text());
      return false;
    }
    
    console.log(`Created Outlook folder: ${folderName}`);
    return true;
  } catch (error) {
    console.error(`Error creating Outlook folder "${folderName}":`, error);
    return false;
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

    // Get ALL categories for the organization (enabled and disabled)
    const { data: allCategories, error: catError } = await supabaseAdmin
      .from('categories')
      .select('id, name, color, is_enabled, sort_order')
      .eq('organization_id', profile.organization_id)
      .order('sort_order');

    if (catError || !allCategories) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch categories' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const enabledCategories = allCategories.filter(c => c.is_enabled);
    const disabledCategories = allCategories.filter(c => !c.is_enabled);

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

    const results: { provider: string; created: number; deleted: number; failed: number }[] = [];
    const syncedCategoryIds: string[] = [];

    // Process each connected provider
    for (const tokenRecord of tokenDataList) {
      try {
        // Get valid access token (will refresh if expired)
        const accessToken = await getValidAccessToken(
          tokenRecord as TokenData, 
          encryptionKey, 
          supabaseAdmin, 
          user.id
        );
        
        if (!accessToken) {
          console.error(`Could not get valid access token for ${tokenRecord.provider}`);
          results.push({ provider: tokenRecord.provider, created: 0, deleted: 0, failed: enabledCategories.length });
          continue;
        }
        let created = 0;
        let deleted = 0;
        let failed = 0;

        // Create labels/folders for enabled categories
        for (const category of enabledCategories) {
          // Create label/folder name with number prefix based on actual sort_order (1-indexed)
          const labelName = `${category.sort_order + 1}: ${category.name}`;
          let success = false;
          
          if (tokenRecord.provider === 'google') {
            success = await createGmailLabel(accessToken, labelName, category.color);
          } else if (tokenRecord.provider === 'microsoft') {
            success = await createOutlookFolder(accessToken, labelName);
          }
          
          if (success) {
            created++;
            // Track successfully synced categories
            if (!syncedCategoryIds.includes(category.id)) {
              syncedCategoryIds.push(category.id);
            }
          } else {
            failed++;
          }
        }

        // Delete labels/folders for disabled categories
        for (const category of disabledCategories) {
          const labelName = `${category.sort_order + 1}: ${category.name}`;
          let success = false;
          
          if (tokenRecord.provider === 'google') {
            success = await deleteGmailLabel(accessToken, labelName);
          } else if (tokenRecord.provider === 'microsoft') {
            success = await deleteOutlookFolder(accessToken, labelName);
          }
          
          if (success) {
            deleted++;
          }
        }

        results.push({ provider: tokenRecord.provider, created, deleted, failed });
      } catch (error) {
        console.error(`Failed to process ${tokenRecord.provider}:`, error);
        results.push({ provider: tokenRecord.provider, created: 0, deleted: 0, failed: enabledCategories.length });
      }
    }

    // Update last_synced_at for successfully synced categories
    if (syncedCategoryIds.length > 0) {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from('categories')
        .update({ last_synced_at: now })
        .in('id', syncedCategoryIds);
      console.log(`Updated last_synced_at for ${syncedCategoryIds.length} categories`);
    }

    const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        syncedCategoryIds,
        message: `Synced ${totalCreated} labels/folders across ${results.length} provider(s)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Sync categories error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

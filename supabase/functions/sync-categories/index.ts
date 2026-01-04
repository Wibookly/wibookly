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

// Create Gmail label
async function createGmailLabel(accessToken: string, labelName: string): Promise<boolean> {
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
    const exists = labels?.some((l: { name: string }) => l.name === labelName);
    
    if (exists) {
      console.log(`Gmail label "${labelName}" already exists`);
      return true;
    }
    
    // Create the label
    const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      })
    });
    
    if (!createRes.ok) {
      console.error(`Failed to create Gmail label "${labelName}":`, await createRes.text());
      return false;
    }
    
    console.log(`Created Gmail label: ${labelName}`);
    return true;
  } catch (error) {
    console.error(`Error creating Gmail label "${labelName}":`, error);
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

    // Get categories for the organization with sort_order for numbering
    const { data: categories, error: catError } = await supabaseAdmin
      .from('categories')
      .select('name, is_enabled, sort_order')
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true)
      .order('sort_order');

    if (catError || !categories) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch categories' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

    // Get tokens from vault
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from('oauth_token_vault')
      .select('provider, encrypted_access_token')
      .eq('user_id', user.id);

    if (tokenError || !tokenData?.length) {
      return new Response(
        JSON.stringify({ error: 'No connected email providers found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: { provider: string; created: number; failed: number }[] = [];

    // Process each connected provider
    for (const token of tokenData) {
      try {
        const accessToken = await decryptToken(token.encrypted_access_token, encryptionKey);
        let created = 0;
        let failed = 0;

        for (let i = 0; i < categories.length; i++) {
          const category = categories[i];
          // Create label/folder name with number prefix based on sort_order position
          const labelName = `${i + 1}: ${category.name}`;
          let success = false;
          
          if (token.provider === 'google') {
            success = await createGmailLabel(accessToken, labelName);
          } else if (token.provider === 'microsoft') {
            success = await createOutlookFolder(accessToken, labelName);
          }
          
          if (success) created++;
          else failed++;
        }

        results.push({ provider: token.provider, created, failed });
      } catch (error) {
        console.error(`Failed to process ${token.provider}:`, error);
        results.push({ provider: token.provider, created: 0, failed: categories.length });
      }
    }

    const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
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
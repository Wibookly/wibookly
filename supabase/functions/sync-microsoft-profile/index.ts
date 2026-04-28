// Sync the signed-in user's profile fields from their Microsoft 365 tenant.
// Reads displayName / jobTitle / department / companyName / mobilePhone /
// businessPhones from Microsoft Graph and writes them to public.user_profiles.
//
// Auth: requires the caller's Supabase session JWT. Uses the OAuth access
// token stored in oauth_token_vault (encrypted with TOKEN_ENCRYPTION_KEY)
// to call Graph; refreshes via refresh_token if expired.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function decryptToken(encrypted: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return decoder.decode(decrypted);
}

async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY');
    const CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID')?.trim();
    const CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')?.trim();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    if (!ENC_KEY || !CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: 'Microsoft sync is not configured on the server' }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: vault } = await admin
      .from('oauth_token_vault')
      .select('encrypted_access_token, encrypted_refresh_token, expires_at')
      .eq('user_id', user.id)
      .eq('provider', 'outlook')
      .maybeSingle();

    if (!vault?.encrypted_access_token) {
      return json({ error: 'No Microsoft 365 connection found. Please sign in again.' }, 400);
    }

    let accessToken = await decryptToken(vault.encrypted_access_token, ENC_KEY);

    // Refresh if expired or expiring within 60s
    const expiresAt = vault.expires_at ? new Date(vault.expires_at).getTime() : 0;
    if (expiresAt && expiresAt < Date.now() + 60_000 && vault.encrypted_refresh_token) {
      const refreshToken = await decryptToken(vault.encrypted_refresh_token, ENC_KEY);
      const refreshResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      if (refreshResp.ok) {
        const t = await refreshResp.json();
        accessToken = t.access_token;
        const newExpires = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
        await admin.from('oauth_token_vault').update({
          encrypted_access_token: await encryptToken(t.access_token, ENC_KEY),
          encrypted_refresh_token: t.refresh_token ? await encryptToken(t.refresh_token, ENC_KEY) : vault.encrypted_refresh_token,
          expires_at: newExpires,
          updated_at: new Date().toISOString(),
        }).eq('user_id', user.id).eq('provider', 'outlook');
      }
    }

    const select = '$select=id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,companyName,officeLocation,mobilePhone,businessPhones,preferredLanguage';
    const meResp = await fetch(`https://graph.microsoft.com/v1.0/me?${select}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!meResp.ok) {
      const errText = await meResp.text();
      console.error('Graph /me failed:', meResp.status, errText);
      return json({ error: 'Failed to read Microsoft 365 profile. Please reconnect your Microsoft account.' }, 502);
    }

    const me = await meResp.json();

    // Fetch profile photo from Microsoft Graph and upload to public storage
    let photoUrl: string | null = null;
    try {
      const photoResp = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (photoResp.ok) {
        const contentType = photoResp.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        const bytes = new Uint8Array(await photoResp.arrayBuffer());
        const path = `${user.id}/microsoft.${ext}`;
        const { error: upErr } = await admin.storage
          .from('profile-photos')
          .upload(path, bytes, { contentType, upsert: true });
        if (!upErr) {
          const { data: pub } = admin.storage.from('profile-photos').getPublicUrl(path);
          photoUrl = pub?.publicUrl ? `${pub.publicUrl}?v=${Date.now()}` : null;
        } else {
          console.warn('photo upload failed:', upErr);
        }
      } else {
        console.log('No Microsoft profile photo available:', photoResp.status);
      }
    } catch (e) {
      console.warn('photo fetch error:', e);
    }

    const update: Record<string, unknown> = {
      full_name: me.displayName || null,
      title: me.jobTitle || null,
      department: me.department || null,
      company: me.companyName || null,
      phone: (Array.isArray(me.businessPhones) && me.businessPhones[0]) || null,
      mobile: me.mobilePhone || null,
    };
    if (photoUrl) update.profile_photo_url = photoUrl;

    const { error: upErr } = await admin
      .from('user_profiles')
      .update(update)
      .eq('user_id', user.id);

    if (upErr) {
      console.error('Failed to update user_profiles:', upErr);
      return json({ error: 'Failed to save synced profile' }, 500);
    }

    return json({
      success: true,
      profile: {
        full_name: update.full_name,
        title: update.title,
        department: update.department,
        company: update.company,
        phone: update.phone,
        mobile: update.mobile,
        office_location: me.officeLocation || null,
        email: (me.mail || me.userPrincipalName) ?? null,
      },
    });
  } catch (e) {
    console.error('sync-microsoft-profile error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});

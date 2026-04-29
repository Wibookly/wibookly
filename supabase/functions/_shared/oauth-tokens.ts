// Shared helpers for retrieving valid OAuth access tokens for a user/provider.
// Mirrors crypto used by mailbox-cleanup.ts and teams-tools.ts.
// deno-lint-ignore-file no-explicit-any

const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function decryptToken(encrypted: string, keyString: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const keyData = new TextEncoder().encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(out);
}

async function encryptToken(token: string, keyString: string): Promise<string> {
  const keyData = new TextEncoder().encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined = new Uint8Array(iv.length + new Uint8Array(enc).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function refreshMicrosoftToken(refreshToken: string) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
      client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  return await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
}

async function refreshGoogleToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  return await res.json() as { access_token: string; expires_in: number };
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

export async function getValidAccessToken(
  userId: string,
  provider: 'google' | 'outlook',
): Promise<string | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_token_vault?user_id=eq.${userId}&provider=eq.${provider}&select=*&limit=1`,
    { headers }
  );
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr[0]) return null;
  const td = arr[0];

  const expired = td.expires_at && new Date(td.expires_at).getTime() < Date.now() + 60_000;
  if (!expired) {
    return await decryptToken(td.encrypted_access_token, TOKEN_ENCRYPTION_KEY);
  }
  if (!td.encrypted_refresh_token) return null;
  const refresh = await decryptToken(td.encrypted_refresh_token, TOKEN_ENCRYPTION_KEY);
  const fresh = provider === 'outlook'
    ? await refreshMicrosoftToken(refresh)
    : await refreshGoogleToken(refresh);
  if (!fresh) return null;

  const updates: Record<string, string> = {
    encrypted_access_token: await encryptToken(fresh.access_token, TOKEN_ENCRYPTION_KEY),
    expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if ((fresh as any).refresh_token) {
    updates.encrypted_refresh_token = await encryptToken((fresh as any).refresh_token, TOKEN_ENCRYPTION_KEY);
  }
  await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_token_vault?user_id=eq.${userId}&provider=eq.${provider}`,
    { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(updates) }
  );

  return fresh.access_token;
}

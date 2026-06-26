// Shared helpers for retrieving valid OAuth access tokens for a user/provider.
// Multi-account aware: pass connectionId to target a specific provider_connection.
// Tracks refresh failures and locks the vault row at 3 failures (requires_reauth = true).
// Phase 5: uses per-organization OAuth client credentials (falls back to global env).
// deno-lint-ignore-file no-explicit-any

import { getOrgOAuthConfig, getOrgIdForConnection } from "./org-oauth-config.ts";

const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;


const REFRESH_WINDOW_MS = 5 * 60 * 1000; // refresh if <5 min left
const MAX_REFRESH_FAILURES = 3;

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

async function refreshMicrosoftToken(refreshToken: string, organizationId: string | null) {
  const cfg = await getOrgOAuthConfig(organizationId, 'microsoft');
  if (!cfg) throw new Error('microsoft_refresh_no_credentials');
  const tenant = cfg.tenantId?.trim() || 'common';
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`microsoft_refresh_${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
}

async function refreshGoogleToken(refreshToken: string, organizationId: string | null) {
  const cfg = await getOrgOAuthConfig(organizationId, 'google');
  if (!cfg) throw new Error('google_refresh_no_credentials');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`google_refresh_${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json() as { access_token: string; expires_in: number };
}


const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function logHealth(userId: string, connectionId: string | null, errorMessage: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/m365_api_health`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        connection_id: connectionId,
        api_name: 'auth',
        status: 'failed',
        error_code: 'REFRESH_FAILED',
        error_message: errorMessage.slice(0, 500),
      }),
    });
  } catch { /* swallow */ }
}

/**
 * Get a valid access token, refreshing if needed.
 *
 * @param userId user UUID
 * @param provider 'google' | 'outlook'
 * @param connectionId optional — when set, targets that specific provider_connection (multi-account).
 *                     When omitted, falls back to the oldest connection for this user+provider.
 *                     Vault rows with requires_reauth=true are always excluded.
 */
export async function getValidAccessToken(
  userId: string,
  provider: 'google' | 'outlook',
  connectionId?: string,
): Promise<string | null> {
  // Build URL: filter on user/provider/requires_reauth, optionally pin to connection_id.
  // When no connectionId provided, return oldest (created_at asc).
  const base = `${SUPABASE_URL}/rest/v1/oauth_token_vault`
    + `?user_id=eq.${userId}`
    + `&provider=eq.${provider}`
    + `&requires_reauth=eq.false`
    + `&select=*`;
  const url = connectionId
    ? `${base}&connection_id=eq.${connectionId}&limit=1`
    : `${base}&order=created_at.asc&limit=1`;

  let r = await fetch(url, { headers });
  let arr = await r.json();
  // Legacy fallback: some vault rows predate per-connection tagging and have
  // connection_id = NULL. If a connection-scoped lookup misses, retry without
  // the filter so the user's single token still resolves.
  if (connectionId && (!Array.isArray(arr) || !arr[0])) {
    const fallback = `${base}&connection_id=is.null&order=created_at.asc&limit=1`;
    r = await fetch(fallback, { headers });
    arr = await r.json();
  }
  if (!Array.isArray(arr) || !arr[0]) return null;
  const td = arr[0];

  const expired = td.expires_at && new Date(td.expires_at).getTime() < Date.now() + REFRESH_WINDOW_MS;
  if (!expired) {
    return await decryptToken(td.encrypted_access_token, TOKEN_ENCRYPTION_KEY);
  }
  if (!td.encrypted_refresh_token) return null;

  let refresh: string;
  try {
    refresh = await decryptToken(td.encrypted_refresh_token, TOKEN_ENCRYPTION_KEY);
  } catch (e) {
    await logHealth(userId, td.connection_id ?? null, `decrypt_failed: ${String(e)}`);
    return null;
  }

  try {
    const fresh = provider === 'outlook'
      ? await refreshMicrosoftToken(refresh)
      : await refreshGoogleToken(refresh);

    const updates: Record<string, any> = {
      encrypted_access_token: await encryptToken(fresh.access_token, TOKEN_ENCRYPTION_KEY),
      expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      refresh_failure_count: 0,
      last_refresh_error: null,
      last_refresh_at: new Date().toISOString(),
      requires_reauth: false,
    };
    if ((fresh as any).refresh_token) {
      updates.encrypted_refresh_token = await encryptToken((fresh as any).refresh_token, TOKEN_ENCRYPTION_KEY);
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_token_vault?id=eq.${td.id}`,
      { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(updates) }
    );

    return fresh.access_token;
  } catch (err) {
    const newCount = (td.refresh_failure_count ?? 0) + 1;
    const msg = String(err?.message ?? err).slice(0, 500);
    const lockNow = newCount >= MAX_REFRESH_FAILURES;

    await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_token_vault?id=eq.${td.id}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          refresh_failure_count: newCount,
          last_refresh_error: msg,
          last_refresh_at: new Date().toISOString(),
          requires_reauth: lockNow,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    await logHealth(userId, td.connection_id ?? null, msg);
    return null;
  }
}

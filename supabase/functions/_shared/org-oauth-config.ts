// Resolves OAuth client credentials per organization.
// Falls back to global env vars when an org has no per-org row configured
// (this preserves Organization 1's existing Microsoft connection).
// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

const restHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

export type OAuthProvider = 'google' | 'microsoft' | 'outlook';

export interface OrgOAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId?: string;            // microsoft only
  source: 'org' | 'global';
  organizationId?: string;
}

async function decrypt(encrypted: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const keyData = new TextEncoder().encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(out);
}

export async function encryptClientSecret(secret: string): Promise<string> {
  const keyData = new TextEncoder().encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
  const combined = new Uint8Array(iv.length + new Uint8Array(enc).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.length);
  return btoa(String.fromCharCode(...combined));
}

function normalizeProvider(p: OAuthProvider): 'microsoft' | 'google' {
  return p === 'outlook' ? 'microsoft' : p;
}

// Organization 1 ("Energyforward") — the only org allowed to use the legacy
// platform-wide MICROSOFT_*/GOOGLE_* env-var credentials. Every other org MUST
// have its own row in org_environment_credentials, or it is treated as
// "not connected" (no silent fallback to the platform app registration).
const ORG1_ID = '0a91e605-1324-40dd-bdb5-ffa1b39bda44';

function globalConfig(
  provider: 'microsoft' | 'google',
  organizationId: string | null | undefined,
): OrgOAuthConfig | null {
  if (organizationId !== ORG1_ID) return null;
  if (provider === 'microsoft') {
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')?.trim();
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')?.trim();
    if (!clientId || !clientSecret) return null;
    const tenantId = Deno.env.get('MICROSOFT_TENANT_ID')?.trim() || undefined;
    return { clientId, clientSecret, tenantId, source: 'global', organizationId: ORG1_ID };
  }
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, source: 'global', organizationId: ORG1_ID };
}

/**
 * Resolve OAuth credentials for an organization.
 * - If the org has its own row in org_environment_credentials, use it (decrypted).
 * - Else, ONLY Organization 1 (legacy tenant) falls back to platform-wide env vars.
 * - Any other org with no row returns null → caller must surface "not connected".
 */
export async function getOrgOAuthConfig(
  organizationId: string | null | undefined,
  provider: OAuthProvider,
): Promise<OrgOAuthConfig | null> {
  const p = normalizeProvider(provider);

  if (organizationId) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/org_environment_credentials`
          + `?organization_id=eq.${organizationId}`
          + `&provider=eq.${p}`
          + `&select=client_id,client_secret_encrypted,tenant_id,status&limit=1`,
        { headers: restHeaders },
      );
      const arr = await r.json();
      if (Array.isArray(arr) && arr[0] && arr[0].status !== 'disabled') {
        const row = arr[0];
        const clientSecret = await decrypt(row.client_secret_encrypted);
        return {
          clientId: String(row.client_id).trim(),
          clientSecret: clientSecret.trim(),
          tenantId: row.tenant_id ?? undefined,
          source: 'org',
          organizationId,
        };
      }
    } catch (e) {
      console.error('getOrgOAuthConfig lookup failed:', e);
      // Do NOT silently fall back to global on lookup failure for non-Org-1 orgs.
      if (organizationId !== ORG1_ID) return null;
    }
  }

  return globalConfig(p, organizationId ?? null);
}

/** Find the organization_id for a given oauth_token_vault.connection_id. */
export async function getOrgIdForConnection(connectionId: string): Promise<string | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/provider_connections?id=eq.${connectionId}&select=organization_id&limit=1`,
      { headers: restHeaders },
    );
    const arr = await r.json();
    if (Array.isArray(arr) && arr[0]) return arr[0].organization_id ?? null;
  } catch (e) {
    console.error('getOrgIdForConnection failed:', e);
  }
  return null;
}

/** Save / replace an org's environment credentials (encrypts the secret). */
export async function upsertOrgCredentials(args: {
  organizationId: string;
  provider: 'microsoft' | 'google';
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  createdBy?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const encrypted = await encryptClientSecret(args.clientSecret);
    const body = {
      organization_id: args.organizationId,
      provider: args.provider,
      client_id: args.clientId.trim(),
      client_secret_encrypted: encrypted,
      tenant_id: args.tenantId?.trim() || null,
      status: 'configured',
      created_by: args.createdBy ?? null,
      updated_at: new Date().toISOString(),
    };
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/org_environment_credentials?on_conflict=organization_id,provider`,
      {
        method: 'POST',
        headers: { ...restHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: txt.slice(0, 400) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

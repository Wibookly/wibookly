// supabase/functions/_shared/unanet.ts
//
// Multi-tenant Unanet A/E integration primitives.
//
// - Domain-scoped client with token lifecycle
// - Path allowlist (read-only enforced by path, not method)
// - verify_credentials() isolates the auth question (Platform token vs. Basic)
// - Encryption of API keys with a rotatable key_id
//
// SECURITY MODEL
// --------------
// All writes to unanet_connections / unanet_records / unanet_sync_runs happen
// through edge functions that use the service_role client, which bypasses RLS.
// The organization_id used in every query MUST come from the authenticated
// session (auth.getUser -> user_profiles.organization_id) — never from the
// request body. RLS on those tables still protects direct client reads.
//
// The client factory below asserts that the connection row it loaded matches
// the requested organization_id, so a mis-wired query surfaces as an error
// instead of a silent cross-tenant leak.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* -------------------------------------------------------------------------- */
/* Encryption (AES-GCM, key_id = 'v1' — rotatable)                             */
/* -------------------------------------------------------------------------- */

const KEY_REGISTRY: Record<string, string | undefined> = {
  v1: Deno.env.get('TOKEN_ENCRYPTION_KEY') ?? undefined,
  // future: v2: Deno.env.get('TOKEN_ENCRYPTION_KEY_V2') ?? undefined,
};

export const CURRENT_KEY_ID = 'v1';

async function importKey(keyString: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptApiKey(plaintext: string): Promise<{ ciphertext: string; key_id: string }> {
  const raw = KEY_REGISTRY[CURRENT_KEY_ID];
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  const key = await importKey(raw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + new Uint8Array(enc).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.length);
  return { ciphertext: btoa(String.fromCharCode(...combined)), key_id: CURRENT_KEY_ID };
}

export async function decryptApiKey(ciphertext: string, key_id: string): Promise<string> {
  const raw = KEY_REGISTRY[key_id];
  if (!raw) throw new Error(`Encryption key_id "${key_id}" not available for decryption`);
  const key = await importKey(raw);
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(dec);
}

/* -------------------------------------------------------------------------- */
/* Path allowlist — read-only enforced by exact path prefix, never by method   */
/* -------------------------------------------------------------------------- */

// Verbs that are writes even when the HTTP method is POST.
const WRITE_VERBS = ['/pay', '/approve', '/reject', '/post', '/submit', '/cancel', '/delete', '/void'];

// Exact-path or prefix allowlist for the read surface we need.
// Anything not in this list is refused, even if it looks harmless.
const READ_PATH_ALLOWLIST: Array<string | RegExp> = [
  '/platform/authenticate/config/',        // probe (prefix)
  '/platform/authenticate',                // login
  '/platform/token/refresh',
  '/platform/token/revoke',
  '/platform/access-rights',               // access-rights snapshot
  // Project / financial reads used by dashboards & chat.
  /^\/platform\/projects(\/search)?$/,
  /^\/platform\/projects\/[^/]+$/,
  /^\/platform\/timesheets\/search$/,
  /^\/platform\/invoices\/search$/,
  /^\/platform\/employees\/search$/,
  /^\/platform\/customers\/search$/,
  /^\/platform\/organizations\/search$/,
];

function normalizePath(pathOrUrl: string): string {
  try {
    const u = new URL(pathOrUrl, 'http://x');
    return u.pathname;
  } catch {
    return pathOrUrl;
  }
}

export function assertReadOnlyPath(pathOrUrl: string): string {
  const path = normalizePath(pathOrUrl);
  const lc = path.toLowerCase();

  for (const verb of WRITE_VERBS) {
    if (lc.endsWith(verb) || lc.includes(`${verb}/`)) {
      throw new UnanetSecurityError(`Refusing write verb in path: ${path}`);
    }
  }
  const ok = READ_PATH_ALLOWLIST.some((rule) =>
    typeof rule === 'string' ? path === rule || path.startsWith(rule) : rule.test(path),
  );
  if (!ok) throw new UnanetSecurityError(`Path not in read allowlist: ${path}`);
  return path;
}

export class UnanetSecurityError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnanetSecurityError';
  }
}
export class UnanetAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnanetAuthError';
  }
}

/* -------------------------------------------------------------------------- */
/* Auth scheme — isolated behind one function                                  */
/* -------------------------------------------------------------------------- */
//
// Two schemes are documented and disagree; the transport header for the
// Platform token is undocumented in the spec. We support both and pick via
// env var, then confirm empirically via probe.py against a real instance.
//
//   UNANET_AUTH_SCHEME = "platform_token" (default) | "basic"
//   UNANET_TOKEN_HEADER = "Authorization: Bearer" (default) | "Authorization" |
//                        "X-Unanet-Token" | ...
//
// verify_credentials() returns a header-provider closure. NO OTHER MODULE
// should read these env vars or know which scheme is active.

type AuthContext = {
  scheme: 'platform_token' | 'basic';
  authHeaders: () => Promise<Record<string, string>>;
  onExpire: () => Promise<void>;                    // clears cached token so next call refreshes
  loginMode?: string | null;
  accessRightsSnapshot: unknown;                    // opaque; stored on connection
};

const AUTH_SCHEME = (Deno.env.get('UNANET_AUTH_SCHEME') ?? 'platform_token') as 'platform_token' | 'basic';
const TOKEN_HEADER_SPEC = Deno.env.get('UNANET_TOKEN_HEADER') ?? 'Authorization: Bearer';

function parseTokenHeaderSpec(spec: string): { name: string; prefix: string } {
  const [name, prefix = ''] = spec.split(':').map((s) => s.trim());
  return { name, prefix: prefix ? `${prefix} ` : '' };
}

async function platformAuthenticate(baseUrl: string, database: string, apiKey: string): Promise<{ token: string; expireDate: number }> {
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/platform/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ apiKey, database }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new UnanetAuthError(`authenticate failed: HTTP ${resp.status} ${body.slice(0, 200)}`);
  }
  const j = await resp.json();
  const exp = j?.expireDate ? new Date(j.expireDate).getTime() : Date.now() + 55 * 60_000;
  if (!j?.token) throw new UnanetAuthError('authenticate response missing token');
  return { token: j.token, expireDate: exp };
}

async function fetchAccessRights(baseUrl: string, authHeaders: Record<string, string>): Promise<unknown> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/platform/access-rights`, {
      method: 'GET',
      headers: { ...authHeaders, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return { unavailable: true, http: resp.status };
    return await resp.json().catch(() => ({}));
  } catch {
    return { unavailable: true };
  }
}

/**
 * verify_credentials — the ONE place that knows how Unanet auth works.
 *
 * - Attempts to obtain a working auth header for `base_url`/`database`/`apiKey`.
 * - Returns a closure that later calls use to sign requests, plus an
 *   `onExpire` hook so the caller can force a re-auth on 401.
 * - Never logs, returns, or stores `apiKey` or the derived token.
 * - Does not touch the database.
 */
export async function verify_credentials(params: {
  baseUrl: string;
  database: string;
  apiKey: string;
}): Promise<AuthContext> {
  const { baseUrl, database, apiKey } = params;
  const { name: headerName, prefix: headerPrefix } = parseTokenHeaderSpec(TOKEN_HEADER_SPEC);

  if (AUTH_SCHEME === 'basic') {
    const basic = 'Basic ' + btoa(apiKey);
    const authHeaders = () => Promise.resolve({ Authorization: basic });
    // Confirm the credential works: hit access-rights (allowlisted) and require non-401.
    const check = await fetch(`${baseUrl.replace(/\/$/, '')}/platform/access-rights`, {
      method: 'GET',
      headers: { Authorization: basic, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    }).catch((e) => { throw new UnanetAuthError(`unreachable: ${e instanceof Error ? e.message : String(e)}`); });
    if (check.status === 401 || check.status === 403) throw new UnanetAuthError(`credential rejected (HTTP ${check.status})`);
    const snapshot = check.ok ? await check.json().catch(() => ({})) : { unavailable: true, http: check.status };
    return {
      scheme: 'basic',
      authHeaders,
      onExpire: () => Promise.resolve(),
      loginMode: null,
      accessRightsSnapshot: snapshot,
    };
  }

  // platform_token
  let token: string;
  let expireDate: number;
  ({ token, expireDate } = await platformAuthenticate(baseUrl, database, apiKey));
  const state = { token, expireDate };

  const authHeaders = async () => {
    // refresh ~5 min before expiry
    if (Date.now() > state.expireDate - 5 * 60_000) {
      const fresh = await platformAuthenticate(baseUrl, database, apiKey);
      state.token = fresh.token;
      state.expireDate = fresh.expireDate;
    }
    return { [headerName]: `${headerPrefix}${state.token}` };
  };
  const onExpire = async () => {
    const fresh = await platformAuthenticate(baseUrl, database, apiKey);
    state.token = fresh.token;
    state.expireDate = fresh.expireDate;
  };

  const snapshot = await fetchAccessRights(baseUrl, await authHeaders());
  return { scheme: 'platform_token', authHeaders, onExpire, loginMode: null, accessRightsSnapshot: snapshot };
}

/* -------------------------------------------------------------------------- */
/* Probe (no credentials)                                                      */
/* -------------------------------------------------------------------------- */

export async function probeInstance(baseUrl: string, database: string): Promise<{
  ok: boolean;
  loginMode?: string | null;
  raw?: unknown;
  error?: string;
  httpStatus?: number;
}> {
  const url = `${baseUrl.replace(/\/$/, '')}/platform/authenticate/config/${encodeURIComponent(database)}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.status === 404) return { ok: false, httpStatus: 404, error: 'Database not found on this Unanet instance' };
    if (!resp.ok) return { ok: false, httpStatus: resp.status, error: `Unanet returned HTTP ${resp.status}` };
    const body = await resp.json().catch(() => ({} as any));
    const loginMode = body?.loginMode ?? body?.mode ?? null;
    return { ok: true, loginMode, raw: body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unreachable' };
  }
}

/* -------------------------------------------------------------------------- */
/* Per-domain client (registry) — bound to ONE organization for its lifetime   */
/* -------------------------------------------------------------------------- */

export type UnanetClient = {
  readonly organizationId: string;
  readonly baseUrl: string;
  readonly database: string;
  get: (path: string, query?: Record<string, string | number | undefined>) => Promise<Response>;
  post: (path: string, body: unknown) => Promise<Response>;
  searchAll: (path: string, body: Record<string, unknown>, opts?: { maxRecords?: number }) => Promise<{ results: any[]; capped: boolean; total: number }>;
  revoke: () => Promise<void>;
};

// Module-level registry. Instances live per warm edge-function invocation only.
const REGISTRY = new Map<string, UnanetClient>();

/**
 * Load an active Unanet connection for the given organization and build a client.
 * The registry asserts the row it loaded matches the requested organization —
 * catches a mis-wired query before it becomes a cross-tenant leak.
 */
export async function getUnanetClientForOrg(
  admin: SupabaseClient,
  organizationId: string,
): Promise<UnanetClient> {
  if (!organizationId) throw new Error('organizationId required');
  const cached = REGISTRY.get(organizationId);
  if (cached) return cached;

  const { data: row, error } = await admin
    .from('unanet_connections')
    .select('id, organization_id, base_url, database_name, api_key_ciphertext, api_key_key_id, status')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error('Unanet is not connected for this organization');
  if (row.status === 'disabled') throw new Error('Unanet connection is disabled');

  // Domain-assertion — refuse silently mis-wired rows.
  if (row.organization_id !== organizationId) {
    throw new Error('unanet_connections domain mismatch — refusing to build client');
  }

  const apiKey = await decryptApiKey(row.api_key_ciphertext, row.api_key_key_id);
  const auth = await verify_credentials({ baseUrl: row.base_url, database: row.database_name, apiKey });

  const client = buildClient({
    organizationId,
    baseUrl: row.base_url,
    database: row.database_name,
    auth,
    onDisconnect: async () => {
      REGISTRY.delete(organizationId);
    },
  });

  REGISTRY.set(organizationId, client);
  return client;
}

export function evictClient(organizationId: string) {
  REGISTRY.delete(organizationId);
}

function buildClient(args: {
  organizationId: string;
  baseUrl: string;
  database: string;
  auth: AuthContext;
  onDisconnect: () => Promise<void>;
}): UnanetClient {
  const { organizationId, baseUrl, database, auth } = args;
  const b = baseUrl.replace(/\/$/, '');

  const doFetch = async (method: 'GET' | 'POST', path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}) => {
    assertReadOnlyPath(path); // hard gate
    const url = new URL(b + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const attempt = async (): Promise<Response> => {
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...(await auth.authHeaders()) };
      return fetch(url.toString(), {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    };

    // Retry once on 401 (token might have expired mid-call) with exponential
    // backoff on 429; hard-fail otherwise.
    let resp = await attempt();
    if (resp.status === 401) {
      await auth.onExpire();
      resp = await attempt();
    }
    if (resp.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      resp = await attempt();
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 4500));
        resp = await attempt();
      }
    }
    return resp;
  };

  const client: UnanetClient = {
    organizationId,
    baseUrl: b,
    database,
    get: (path, query) => doFetch('GET', path, { query }),
    post: (path, body) => doFetch('POST', path, { body }),
    searchAll: async (path, body, opts = {}) => {
      const max = Math.min(opts.maxRecords ?? 5000, 20_000);
      const pageSize = 2000;
      let offset = 0;
      let total = 0;
      const out: any[] = [];
      let capped = false;
      while (out.length < max) {
        const resp = await doFetch('POST', path, { body: { ...body, offset, limit: pageSize } });
        if (!resp.ok) throw new Error(`Unanet ${path} failed: HTTP ${resp.status}`);
        const j = await resp.json().catch(() => ({} as any));
        const page: any[] = j?.results ?? [];
        total = typeof j?.total === 'number' ? j.total : total;
        out.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
        if (out.length >= max) { capped = true; break; }
      }
      return { results: out.slice(0, max), capped, total };
    },
    revoke: async () => {
      try {
        // best-effort revoke for platform_token scheme
        if (auth.scheme === 'platform_token') {
          const headers = await auth.authHeaders();
          await fetch(`${b}/platform/token/revoke`, {
            method: 'POST',
            headers: { ...headers, Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          }).catch(() => undefined);
        }
      } finally {
        await args.onDisconnect();
      }
    },
  };

  // Make sure a stringified client never leaks the key.
  Object.defineProperty(client, 'toString', {
    value: () => `UnanetClient(org=${organizationId}, db=${database})`,
    enumerable: false,
  });
  return client;
}

/* -------------------------------------------------------------------------- */
/* Auth/session/gate helpers (shared by every unanet-* edge function)          */
/* -------------------------------------------------------------------------- */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/**
 * Resolve the caller's session -> user_id + organization_id.
 * organization_id ALWAYS comes from the session, never the request body.
 */
export async function requireSession(req: Request): Promise<{ userId: string; email: string; organizationId: string; isSuper: boolean }> {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthorized');

  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: u } = await anon.auth.getUser(token);
  const userId = u?.user?.id;
  if (!userId) throw new HttpError(401, 'unauthorized');

  const admin = adminClient();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('organization_id, email')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile?.organization_id) throw new HttpError(400, 'no organization for user');

  const emailLc = (profile.email || '').toLowerCase();
  const isSuper = emailLc === 'arahimi@energyforward.com';

  return { userId, email: emailLc, organizationId: profile.organization_id, isSuper };
}

/**
 * Enforce feature gate + role gate. 404 if the feature isn't enabled for the
 * org (so the endpoint is indistinguishable from "not built"); 403 if the
 * caller isn't an org admin.
 */
export async function enforceGates(admin: SupabaseClient, session: { userId: string; organizationId: string; isSuper: boolean }): Promise<void> {
  if (session.isSuper) return; // super admin bypasses both gates

  // Feature gate — 404 to hide existence.
  const { data: gate } = await admin.rpc('org_has_unanet_feature', { _org_id: session.organizationId });
  if (!gate) throw new HttpError(404, 'not found');

  // Role gate — must be org admin.
  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', session.userId)
    .eq('organization_id', session.organizationId);
  const roleSet = new Set((roles ?? []).map((r: any) => r.role));
  if (!roleSet.has('admin') && !roleSet.has('org_admin')) throw new HttpError(403, 'forbidden');
}

export class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

export function handleError(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e instanceof UnanetSecurityError) {
    // Never bubble security errors as 200; surface loudly.
    console.error('[unanet] security error:', e.message);
    return json({ error: 'operation refused by policy' }, 400);
  }
  if (e instanceof UnanetAuthError) return json({ error: e.message }, 400);
  console.error('[unanet] unexpected error:', e);
  return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
}

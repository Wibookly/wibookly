// Diagnostic: end-to-end Microsoft Graph connectivity test for a user.
// Returns booleans + counts (no PII payloads). Also returns the raw access_token
// so the client can decode `scp` claims for scope verification.
// Each sub-test inserts a row into m365_api_health for audit history.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getValidAccessToken } from "../_shared/oauth-tokens.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const restHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

type ApiName = 'mail' | 'onedrive' | 'sharepoint' | 'calendar' | 'user' | 'auth';

async function logHealth(row: {
  user_id: string;
  connection_id: string | null;
  api_name: ApiName;
  status: 'healthy' | 'degraded' | 'failed';
  endpoint?: string;
  response_ms?: number;
  error_code?: string | null;
  error_message?: string | null;
}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/m365_api_health`, {
      method: 'POST',
      headers: restHeaders,
      body: JSON.stringify(row),
    });
  } catch { /* swallow */ }
}

async function timedGraph(
  userId: string,
  connectionId: string | null,
  apiName: ApiName,
  token: string,
  endpoint: string,
) {
  const start = Date.now();
  const url = `https://graph.microsoft.com/v1.0${endpoint}`;
  let status = 0;
  let ok = false;
  let body: string | undefined;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    status = res.status;
    ok = res.ok;
    if (!ok) body = (await res.text()).slice(0, 300);
    const ms = Date.now() - start;
    await logHealth({
      user_id: userId,
      connection_id: connectionId,
      api_name: apiName,
      status: ok ? 'healthy' : 'failed',
      endpoint,
      response_ms: ms,
      error_code: ok ? null : `HTTP_${status}`,
      error_message: ok ? null : body,
    });
    return { status, ok, body, ms };
  } catch (e) {
    const ms = Date.now() - start;
    await logHealth({
      user_id: userId,
      connection_id: connectionId,
      api_name: apiName,
      status: 'failed',
      endpoint,
      response_ms: ms,
      error_code: 'NETWORK_ERROR',
      error_message: String(e).slice(0, 300),
    });
    return { status: 0, ok: false, body: String(e), ms };
  }
}

async function getOldestConnectionId(userId: string): Promise<string | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/provider_connections?user_id=eq.${userId}&provider=eq.outlook&select=id&order=created_at.asc&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const arr = await r.json();
    return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    // Require an authenticated caller. verify_jwt is false at the platform
    // level, so we validate the bearer token in-function and ensure the
    // userId in the body matches the caller's auth.uid().
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const authClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(
      authHeader.replace('Bearer ', ''),
    );
    const callerId = claimsData?.claims?.sub as string | undefined;
    if (claimsErr || !callerId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { userId, connectionId: connIdInput } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    if (userId !== callerId) {
      return new Response(JSON.stringify({ error: 'Forbidden: can only test your own connection' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const connectionId: string | null = connIdInput ?? await getOldestConnectionId(userId);

    const token = await getValidAccessToken(userId, 'outlook', connectionId ?? undefined);
    if (!token) {
      // getValidAccessToken already logs the auth failure to m365_api_health.
      return new Response(JSON.stringify({
        ok: false,
        step: 'token',
        error: 'No valid access token (refresh failed, locked, or no vault entry)',
        connection_id: connectionId,
      }), {
        status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const tests: Record<string, any> = { token: 'ok' };

    // 1. /me
    const me = await timedGraph(userId, connectionId, 'user', token, '/me');
    tests.me = { status: me.status, ok: me.ok, response_ms: me.ms };
    if (me.ok) {
      try {
        const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = await meRes.json();
        tests.me.upn = j.userPrincipalName;
        tests.me.displayName = j.displayName;
      } catch { /* ignore */ }
    } else {
      tests.me.body = me.body;
    }

    // 2. Mail
    const mail = await timedGraph(userId, connectionId, 'mail', token, '/me/messages?$top=1&$select=subject');
    tests.mail = { status: mail.status, ok: mail.ok, response_ms: mail.ms, ...(mail.ok ? {} : { body: mail.body }) };

    // 3. Calendar
    const cal = await timedGraph(userId, connectionId, 'calendar', token, '/me/events?$top=1&$select=subject');
    tests.calendar = { status: cal.status, ok: cal.ok, response_ms: cal.ms, ...(cal.ok ? {} : { body: cal.body }) };

    // 4. OneDrive
    const drive = await timedGraph(userId, connectionId, 'onedrive', token, '/me/drive/root/children?$top=1&$select=name');
    tests.onedrive = { status: drive.status, ok: drive.ok, response_ms: drive.ms, ...(drive.ok ? {} : { body: drive.body }) };

    // 5. SharePoint
    const sites = await timedGraph(userId, connectionId, 'sharepoint', token, '/sites?search=*&$top=1');
    tests.sharepoint = { status: sites.status, ok: sites.ok, response_ms: sites.ms, ...(sites.ok ? {} : { body: sites.body }) };

    const allOk = tests.me.ok && tests.mail.ok && tests.calendar.ok && tests.onedrive.ok && tests.sharepoint.ok;

    // Decode JWT scope claims server-side; never return the raw access token.
    let scopes: string[] = [];
    try {
      const payload = token.split('.')[1];
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      const scp = json.scp || json.scope || '';
      scopes = typeof scp === 'string' ? scp.split(/\s+/).filter(Boolean) : Array.isArray(scp) ? scp : [];
    } catch { /* ignore */ }

    return new Response(JSON.stringify({
      ok: allOk,
      tests,
      scopes,
      connection_id: connectionId,
    }, null, 2), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});

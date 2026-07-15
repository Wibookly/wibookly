// egnyte-search  (authenticated)
// Runs a filename/metadata search in the caller's organization's Egnyte tenant.
// Refreshes the OAuth token on demand if it's expired or about to be.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/egnyte-crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function refreshIfNeeded(admin: ReturnType<typeof createClient>, row: {
  organization_id: string; subdomain: string;
  access_token_enc: string; refresh_token_enc: string | null;
  token_expires_at: string | null;
}, encKey: string, clientId: string, clientSecret: string): Promise<string> {
  let accessToken = await decryptToken(row.access_token_enc, encKey);
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (!row.refresh_token_enc || (expiresAt && expiresAt > Date.now() + 60_000)) return accessToken;

  const refreshToken = await decryptToken(row.refresh_token_enc, encKey);
  const resp = await fetch(`https://${row.subdomain}.egnyte.com/puboauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: 'refresh_token', refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) {
    await admin.from('tenant_integrations').update({
      status: 'expired',
      last_error: 'Token refresh failed — please reconnect Egnyte.',
      updated_at: new Date().toISOString(),
    }).eq('organization_id', row.organization_id).eq('integration_slug', 'egnyte');
    throw new Error('Egnyte token refresh failed — reconnect required.');
  }
  const t = await resp.json();
  accessToken = t.access_token;
  await admin.from('tenant_integrations').update({
    access_token_enc: await encryptToken(t.access_token, encKey),
    refresh_token_enc: t.refresh_token ? await encryptToken(t.refresh_token, encKey) : row.refresh_token_enc,
    token_expires_at: t.expires_in ? new Date(Date.now() + Number(t.expires_in) * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('organization_id', row.organization_id).eq('integration_slug', 'egnyte');
  return accessToken;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY');
    const CLIENT_ID = Deno.env.get('EGNYTE_CLIENT_ID')?.trim();
    const CLIENT_SECRET = Deno.env.get('EGNYTE_CLIENT_SECRET')?.trim();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (!ENC_KEY || !CLIENT_ID || !CLIENT_SECRET) return json({ error: 'Egnyte is not configured on the server.' }, 500);

    const body = await req.json().catch(() => ({}));
    const query = String(body?.query ?? '').trim();
    const count = Math.min(Math.max(Number(body?.count ?? 15), 1), 50);
    if (!query) return json({ error: 'query is required' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from('user_profiles').select('organization_id').eq('user_id', user.id).maybeSingle();
    if (!profile?.organization_id) return json({ error: 'No organization' }, 400);

    const { data: row } = await admin.from('tenant_integrations')
      .select('organization_id, subdomain, access_token_enc, refresh_token_enc, token_expires_at, status, enabled')
      .eq('organization_id', profile.organization_id).eq('integration_slug', 'egnyte').maybeSingle();
    if (!row || row.status !== 'connected' || !row.enabled || !row.access_token_enc) {
      return json({ error: 'Egnyte is not connected for this organization.' }, 400);
    }

    let accessToken: string;
    try {
      accessToken = await refreshIfNeeded(admin, row as any, ENC_KEY, CLIENT_ID, CLIENT_SECRET);
    } catch (e) {
      return json({ error: (e as Error).message }, 401);
    }

    const doSearch = (tok: string) => fetch(`https://${row.subdomain}.egnyte.com/pubapi/v2/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, count, type: 'FILE' }),
    });

    let resp = await doSearch(accessToken);
    if (resp.status === 401 && row.refresh_token_enc) {
      // Force refresh once, retry.
      accessToken = await refreshIfNeeded(admin, { ...row as any, token_expires_at: '1970-01-01T00:00:00Z' }, ENC_KEY, CLIENT_ID, CLIENT_SECRET);
      resp = await doSearch(accessToken);
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error('Egnyte search failed', resp.status, t);
      return json({ error: 'Egnyte search failed', status: resp.status, details: t.slice(0, 400) }, resp.status);
    }
    const data = await resp.json();
    // deno-lint-ignore no-explicit-any
    const items = ((data?.results ?? data?.items ?? []) as any[]).map((r) => ({
      name: r.name ?? r.display_name ?? null,
      path: r.path ?? null,
      size: r.size ?? null,
      modified: r.last_modified ?? r.uploaded ?? null,
      type: r.type ?? 'file',
      url: r.path ? `https://${row.subdomain}.egnyte.com/app/index.do#storage/files/1${r.path}` : null,
    }));
    await admin.from('tenant_integrations').update({ last_synced_at: new Date().toISOString() })
      .eq('organization_id', profile.organization_id).eq('integration_slug', 'egnyte');
    return json({ query, domain: `${row.subdomain}.egnyte.com`, results: items });
  } catch (e) {
    console.error('egnyte-search error', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

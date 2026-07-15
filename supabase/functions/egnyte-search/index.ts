// Searches the signed-in user's Egnyte tenant. Returns file metadata only
// (name, path, size, modified). Refreshes the OAuth token if expired.
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
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    if (!ENC_KEY || !CLIENT_ID || !CLIENT_SECRET) return json({ error: 'Egnyte is not configured on the server.' }, 500);

    const body = await req.json().catch(() => ({}));
    const query = String(body?.query ?? '').trim();
    const count = Math.min(Math.max(Number(body?.count ?? 15), 1), 50);
    if (!query) return json({ error: 'query is required' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: conn } = await admin.from('egnyte_connections')
      .select('egnyte_domain, encrypted_access_token, encrypted_refresh_token, expires_at')
      .eq('user_id', user.id).maybeSingle();
    if (!conn) return json({ error: 'Egnyte is not connected for this user.' }, 400);

    let accessToken = await decryptToken(conn.encrypted_access_token, ENC_KEY);
    const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
    if (expiresAt && expiresAt < Date.now() + 60_000 && conn.encrypted_refresh_token) {
      const refreshToken = await decryptToken(conn.encrypted_refresh_token, ENC_KEY);
      const rResp = await fetch(`https://${conn.egnyte_domain}/puboauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          grant_type: 'refresh_token', refresh_token: refreshToken,
        }),
      });
      if (rResp.ok) {
        const t = await rResp.json();
        accessToken = t.access_token;
        await admin.from('egnyte_connections').update({
          encrypted_access_token: await encryptToken(t.access_token, ENC_KEY),
          encrypted_refresh_token: t.refresh_token ? await encryptToken(t.refresh_token, ENC_KEY) : conn.encrypted_refresh_token,
          expires_at: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
        }).eq('user_id', user.id);
      }
    }

    // Egnyte search v2: POST /pubapi/v2/search
    const searchResp = await fetch(`https://${conn.egnyte_domain}/pubapi/v2/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, count, type: 'FILE' }),
    });
    if (!searchResp.ok) {
      const t = await searchResp.text();
      console.error('Egnyte search failed', searchResp.status, t);
      return json({ error: 'Egnyte search failed', status: searchResp.status, details: t.slice(0, 400) }, searchResp.status);
    }
    const data = await searchResp.json();
    // Normalize results
    // deno-lint-ignore no-explicit-any
    const items = (data?.results ?? data?.items ?? []).map((r: any) => ({
      name: r.name ?? r.display_name ?? null,
      path: r.path ?? null,
      size: r.size ?? null,
      modified: r.last_modified ?? r.uploaded ?? null,
      type: r.type ?? 'file',
      url: r.path ? `https://${conn.egnyte_domain}/app/index.do#storage/files/1${r.path}` : null,
    }));
    return json({ query, domain: conn.egnyte_domain, results: items });
  } catch (e) {
    console.error('egnyte-search error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});

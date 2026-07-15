// Starts the Egnyte OAuth authorization-code flow for the signed-in user.
// Returns an authorization URL the client should navigate to.
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const CLIENT_ID = Deno.env.get('EGNYTE_CLIENT_ID')?.trim();
    const DEFAULT_DOMAIN = (Deno.env.get('EGNYTE_DOMAIN')?.trim() || '4steleng.egnyte.com').replace(/^https?:\/\//, '');

    if (!CLIENT_ID) return json({ error: 'Egnyte is not configured on the server (missing EGNYTE_CLIENT_ID).' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const domain = (body?.domain?.toString().trim() || DEFAULT_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '');
    const returnTo = typeof body?.return_to === 'string' && body.return_to.startsWith('/') ? body.return_to : '/egnyte';

    // state = base64url(JSON({user_id, domain, return_to, nonce}))
    const state = btoa(JSON.stringify({
      u: user.id,
      d: domain,
      r: returnTo,
      n: crypto.randomUUID(),
      t: Date.now(),
    })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

    const redirectUri = `${SUPABASE_URL}/functions/v1/egnyte-oauth-callback`;
    const authUrl = new URL(`https://${domain}/puboauth/token`);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'Egnyte.filesystem');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    return json({ authorization_url: authUrl.toString(), redirect_uri: redirectUri, domain });
  } catch (e) {
    console.error('egnyte-oauth-init error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});

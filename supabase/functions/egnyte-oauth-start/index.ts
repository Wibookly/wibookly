// egnyte-oauth-start
// POST { subdomain, scopes?, return_path? }  (authenticated, admin-only)
// Returns { authorize_url } for the client to navigate to.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

function sanitizeSubdomain(input: string): string | null {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\.egnyte\.com\/?.*$/, '');
  s = s.replace(/\/$/, '');
  return SUBDOMAIN_RE.test(s) ? s : null;
}

function randomState(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const CLIENT_ID = Deno.env.get('EGNYTE_CLIENT_ID')?.trim();
    const REDIRECT_URI = Deno.env.get('EGNYTE_REDIRECT_URI')?.trim()
      || `${SUPABASE_URL}/functions/v1/egnyte-oauth-callback`;

    if (!CLIENT_ID) return json({ error: 'Egnyte is not configured on the server (missing EGNYTE_CLIENT_ID).' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve org + admin check
    const { data: profile } = await admin.from('user_profiles')
      .select('organization_id, email')
      .eq('user_id', user.id).maybeSingle();
    const organizationId = profile?.organization_id;
    if (!organizationId) return json({ error: 'No organization found for this user' }, 400);

    const { data: isAdminRow } = await admin.rpc('is_org_admin', { _org_id: organizationId });
    const { data: isSuper } = await admin.rpc('is_super_admin', { _email: profile?.email ?? '' });
    if (!isAdminRow && !isSuper) return json({ error: 'Only organization admins can connect Egnyte.' }, 403);

    const body = await req.json().catch(() => ({}));
    const subdomain = sanitizeSubdomain(body?.subdomain);
    if (!subdomain) return json({ error: 'Invalid subdomain. Enter just the part before .egnyte.com (e.g. "acme").' }, 400);

    // Load definition + scopes
    const { data: def } = await admin.from('integration_definitions').select('default_scopes, available_scopes')
      .eq('slug', 'egnyte').maybeSingle();
    const defaultScopes = (def?.default_scopes as string[] | undefined) ?? ['Egnyte.filesystem', 'Egnyte.link'];
    const availableScopes = (def?.available_scopes as string[] | undefined) ?? defaultScopes;
    const requested = Array.isArray(body?.scopes) && body.scopes.length
      ? (body.scopes as string[]).filter((s) => availableScopes.includes(s))
      : defaultScopes;

    const returnPath = typeof body?.return_path === 'string' && body.return_path.startsWith('/') ? body.return_path : '/egnyte';

    const state = randomState();
    const { error: stErr } = await admin.from('oauth_states').insert({
      state,
      organization_id: organizationId,
      integration_slug: 'egnyte',
      subdomain,
      requested_scopes: requested,
      return_path: returnPath,
      created_by: user.id,
    });
    if (stErr) { console.error('oauth_states insert failed', stErr); return json({ error: 'Could not initialize OAuth state.' }, 500); }

    // Upsert pending tenant_integrations row
    await admin.from('tenant_integrations').upsert({
      organization_id: organizationId,
      integration_slug: 'egnyte',
      subdomain,
      status: 'pending',
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,integration_slug' });

    const authorizeUrl = new URL(`https://${subdomain}.egnyte.com/puboauth/token`);
    authorizeUrl.searchParams.set('client_id', CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authorizeUrl.searchParams.set('scope', requested.join(' '));
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('response_type', 'code');

    return json({ authorize_url: authorizeUrl.toString(), redirect_uri: REDIRECT_URI, subdomain, scopes: requested });
  } catch (e) {
    console.error('egnyte-oauth-start error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});

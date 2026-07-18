// unanet-probe  (authenticated)
// Performs a lightweight reachability check against the Unanet cloud URL for the caller's org.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptToken } from '../_shared/egnyte-crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY');
    if (!ENC_KEY) return json({ error: 'TOKEN_ENCRYPTION_KEY not configured' }, 500);

    const authHeader = req.headers.get('authorization') || '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    const userId = u?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from('user_profiles').select('organization_id').eq('user_id', userId).maybeSingle();
    if (!profile?.organization_id) return json({ error: 'No organization' }, 400);

    const { data: row } = await admin
      .from('tenant_integrations')
      .select('id, subdomain, connected_email, access_token_enc')
      .eq('organization_id', profile.organization_id)
      .eq('integration_slug', 'unanet')
      .maybeSingle();
    if (!row?.subdomain || !row?.access_token_enc) return json({ error: 'Unanet not configured', status: 'idle' }, 400);

    const apiKey = await decryptToken(row.access_token_enc, ENC_KEY);
    let status: 'healthy' | 'warning' | 'failed' = 'healthy';
    let message: string | null = null;

    try {
      const url = row.subdomain.replace(/\/$/, '');
      const resp = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.status >= 500) {
        status = 'failed';
        message = `Unanet returned ${resp.status}`;
      } else if (resp.status === 401 || resp.status === 403) {
        status = 'failed';
        message = 'Unanet rejected the API key';
      } else if (!resp.ok) {
        status = 'warning';
        message = `Unanet reachable — HTTP ${resp.status}`;
      }
    } catch (e) {
      status = 'failed';
      message = e instanceof Error ? e.message : 'Network error';
    }

    await admin.from('tenant_integrations').update({
      status,
      last_error: message,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);

    return json({ status, message });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error', status: 'failed' }, 500);
  }
});

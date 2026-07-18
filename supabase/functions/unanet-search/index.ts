// unanet-search  (authenticated)
// Returns Unanet context for AI Chat and dashboard summaries.
// This is a scaffold that safely no-ops when Unanet is not connected.
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

    const authHeader = req.headers.get('authorization') || '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    const userId = u?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from('user_profiles').select('organization_id').eq('user_id', userId).maybeSingle();
    if (!profile?.organization_id) return json({ error: 'No organization', results: [] }, 200);

    const { data: row } = await admin
      .from('tenant_integrations')
      .select('subdomain, connected_email, access_token_enc, status')
      .eq('organization_id', profile.organization_id)
      .eq('integration_slug', 'unanet')
      .maybeSingle();

    if (!row?.subdomain || !row?.access_token_enc || !ENC_KEY) {
      return json({ error: 'Unanet is not connected for your organization', results: [], summary: null });
    }

    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? 'search');
    const query = String(body?.query ?? '').trim();
    const count = Math.min(50, Math.max(1, Number(body?.count ?? 10)));

    // Note: real Unanet REST endpoints vary by tenant/module. We build the
    // authorization header here so downstream implementations can call the
    // customer's cloud URL directly without redoing token handling.
    const _apiKey = await decryptToken(row.access_token_enc, ENC_KEY);
    const domain = row.subdomain;

    if (kind === 'dashboard_summary') {
      // Scaffold: return null summary so the UI shows "—" placeholders until
      // per-tenant endpoints are wired.
      return json({ summary: null, domain });
    }

    // Default: search scaffold — returns empty results with metadata so the
    // AI Chat toggle degrades gracefully.
    return json({
      domain,
      query,
      count,
      results: [] as Array<{ title: string; snippet: string; url?: string }>,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error', results: [] }, 500);
  }
});

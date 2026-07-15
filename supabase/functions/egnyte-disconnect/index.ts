// egnyte-disconnect  (authenticated, admin-only)
// Clears token columns and sets status=disconnected, enabled=false.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from('user_profiles').select('organization_id, email').eq('user_id', user.id).maybeSingle();
    if (!profile?.organization_id) return json({ error: 'No organization' }, 400);
    const { data: isAdminRow } = await admin.rpc('is_org_admin', { _org_id: profile.organization_id });
    const { data: isSuper } = await admin.rpc('is_super_admin', { _email: profile.email ?? '' });
    if (!isAdminRow && !isSuper) return json({ error: 'Only organization admins can disconnect Egnyte.' }, 403);

    await admin.from('tenant_integrations').update({
      access_token_enc: null,
      refresh_token_enc: null,
      token_expires_at: null,
      status: 'disconnected',
      enabled: false,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('organization_id', profile.organization_id).eq('integration_slug', 'egnyte');

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500);
  }
});

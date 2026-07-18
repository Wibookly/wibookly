// unanet-save-credentials  (authenticated, org admin)
// Stores per-organization Unanet credentials in tenant_integrations:
//   subdomain         -> cloud URL
//   connected_email   -> database name (repurposed non-secret slot)
//   access_token_enc  -> encrypted API key
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptToken } from '../_shared/egnyte-crypto.ts';

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
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser(token);
    const userId = u?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from('user_profiles').select('organization_id, email').eq('user_id', userId).maybeSingle();
    if (!profile?.organization_id) return json({ error: 'No organization for user' }, 400);

    // Allow super admin OR org_admin/admin roles
    const emailLc = (profile.email || '').toLowerCase();
    const isSuper = emailLc === 'arahimi@energyforward.com';
    if (!isSuper) {
      const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userId);
      const roleSet = new Set((roles ?? []).map((r: any) => r.role));
      if (!roleSet.has('org_admin') && !roleSet.has('admin')) return json({ error: 'Forbidden' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const cloudUrl = String(body?.cloud_url ?? '').trim();
    const database = String(body?.database ?? '').trim();
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';

    if (!cloudUrl || !database) return json({ error: 'cloud_url and database are required' }, 400);

    // Fetch existing row so we don't overwrite the encrypted key with blank
    const { data: existing } = await admin
      .from('tenant_integrations')
      .select('id, access_token_enc')
      .eq('organization_id', profile.organization_id)
      .eq('integration_slug', 'unanet')
      .maybeSingle();

    const now = new Date().toISOString();
    const nextAccess = apiKey
      ? await encryptToken(apiKey, ENC_KEY)
      : existing?.access_token_enc ?? null;

    if (!nextAccess) return json({ error: 'API key required on first save' }, 400);

    const payload = {
      organization_id: profile.organization_id,
      integration_slug: 'unanet',
      subdomain: cloudUrl,
      connected_email: database,
      access_token_enc: nextAccess,
      status: existing ? 'idle' : 'idle',
      last_error: null,
      enabled: true,
      updated_at: now,
      connected_at: existing ? undefined : now,
    };

    if (existing?.id) {
      const { error } = await admin.from('tenant_integrations').update(payload).eq('id', existing.id);
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin.from('tenant_integrations').insert(payload);
      if (error) return json({ error: error.message }, 500);
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

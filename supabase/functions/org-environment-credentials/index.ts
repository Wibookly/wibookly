import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertOrgCredentials } from "../_shared/org-oauth-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(SUPABASE_URL, SERVICE);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as 'set' | 'delete' | 'test';
    const organizationId = String(body.organizationId || '');
    const provider = body.provider === 'microsoft' || body.provider === 'google' ? body.provider : null;

    if (!organizationId || !provider) {
      return new Response(JSON.stringify({ error: 'organizationId and provider are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authorize: caller must be org_admin for this org, or platform super admin.
    const [{ data: isOrgAdmin }, { data: isSuper }] = await Promise.all([
      adminClient.rpc('is_org_admin', { _org_id: organizationId }),
      adminClient.rpc('is_current_user_super_admin').then(r => r, () => ({ data: false })),
    ]);
    // is_org_admin uses auth.uid() which won't resolve under service role; use user client:
    const { data: isOrgAdmin2 } = await userClient.rpc('is_org_admin', { _org_id: organizationId });
    const allowed = Boolean(isOrgAdmin2) || Boolean(isSuper);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden: not an org admin for this organization' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'delete') {
      const { error } = await adminClient
        .from('org_environment_credentials')
        .delete()
        .eq('organization_id', organizationId)
        .eq('provider', provider);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'set') {
      const clientId = String(body.clientId || '').trim();
      const clientSecret = String(body.clientSecret || '').trim();
      const tenantId = body.tenantId ? String(body.tenantId).trim() : undefined;
      if (!clientId || !clientSecret) {
        return new Response(JSON.stringify({ error: 'clientId and clientSecret are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const res = await upsertOrgCredentials({
        organizationId, provider, clientId, clientSecret, tenantId,
        createdBy: user.id,
      });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: res.error || 'save_failed' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

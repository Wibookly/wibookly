// Renews Microsoft Graph subscriptions that are about to expire.
// Graph subscriptions on /messages max out at ~3 days. We renew anything
// expiring in the next 24 hours. Run via pg_cron every 12 hours.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MS_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID')!;
const MS_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function getAppToken(tenantId: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: settingsList, error } = await admin
    .from('agent_settings')
    .select('*')
    .eq('email_agent_enabled', true)
    .not('graph_subscription_id', 'is', null)
    .lt('graph_subscription_expires_at', horizon);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: Array<{ org: string; status: string; detail?: string }> = [];

  for (const s of settingsList ?? []) {
    const tenantId = s.teams_tenant_id || Deno.env.get('MICROSOFT_TENANT_ID') || '';
    if (!tenantId) {
      results.push({ org: s.organization_id, status: 'skip_no_tenant' });
      continue;
    }
    try {
      const token = await getAppToken(tenantId);
      const newExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 2 - 60_000).toISOString();
      const res = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${s.graph_subscription_id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationDateTime: newExpiry }),
      });
      const data = await res.json();
      if (!res.ok) {
        results.push({ org: s.organization_id, status: 'failed', detail: JSON.stringify(data) });
        continue;
      }
      await admin
        .from('agent_settings')
        .update({ graph_subscription_expires_at: data.expirationDateTime })
        .eq('organization_id', s.organization_id);
      results.push({ org: s.organization_id, status: 'renewed' });
    } catch (e) {
      results.push({ org: s.organization_id, status: 'error', detail: String(e).slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

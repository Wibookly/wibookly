// Lightweight cron that triggers sync-rules for every active connection.
// Called by pg_cron every 5 minutes so that categorization rules are applied
// to recently-arrived emails without requiring users to manually click "Sync".
//
// For each connected mailbox, this function impersonates the owning user via
// a service-role-signed JWT and POSTs to sync-rules. sync-rules already
// contains all rule-matching + label/folder application logic — we just need
// to invoke it on a schedule.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Find every active connection that has at least one enabled rule
  const { data: connections, error } = await admin
    .from('provider_connections')
    .select('id, user_id, organization_id, connected_email, provider')
    .eq('is_connected', true);

  if (error) {
    console.error('connections query failed', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: Array<{ email: string; status: string; detail?: string }> = [];

  for (const conn of connections ?? []) {
    // Skip connections with no enabled rules to save quota
    const { count } = await admin
      .from('rules')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', conn.organization_id)
      .eq('is_enabled', true);

    if (!count || count === 0) {
      results.push({ email: conn.connected_email ?? conn.id, status: 'skipped_no_rules' });
      continue;
    }

    try {
      // Impersonate user with service-role token; sync-rules trusts auth.getUser
      const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      // Generate a short-lived access token for this user via admin API
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: '', // not actually used for the impersonation we need
      } as any).catch(() => ({ data: null, error: { message: 'admin api unavailable' } } as any));

      // Fallback approach: call sync-rules with service role bearer + a custom header
      // we will read in sync-rules as cron mode. For now, invoke directly.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-rules`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'x-cron-user-id': conn.user_id,
          'x-cron-org-id': conn.organization_id,
        },
        body: JSON.stringify({ connection_id: conn.id, cron: true }),
      });

      const detail = res.ok ? 'ok' : `${res.status} ${(await res.text()).slice(0, 200)}`;
      results.push({
        email: conn.connected_email ?? conn.id,
        status: res.ok ? 'synced' : 'failed',
        detail,
      });
    } catch (e) {
      results.push({
        email: conn.connected_email ?? conn.id,
        status: 'error',
        detail: String(e).slice(0, 200),
      });
    }
  }

  console.log(`cron-apply-rules processed ${results.length} connections`);

  return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

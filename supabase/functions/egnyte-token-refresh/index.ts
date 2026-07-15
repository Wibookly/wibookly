// egnyte-token-refresh  (service invocation, e.g. from pg_cron)
// Refreshes any Egnyte tokens expiring within 5 days.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/egnyte-crypto.ts";

serve(async () => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const CLIENT_ID = Deno.env.get('EGNYTE_CLIENT_ID')?.trim();
    const CLIENT_SECRET = Deno.env.get('EGNYTE_CLIENT_SECRET')?.trim();
    const ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY');
    if (!CLIENT_ID || !CLIENT_SECRET || !ENC_KEY) return new Response('missing config', { status: 500 });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const cutoff = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await admin.from('tenant_integrations')
      .select('organization_id, subdomain, refresh_token_enc, token_expires_at')
      .eq('integration_slug', 'egnyte').eq('status', 'connected')
      .lt('token_expires_at', cutoff);

    const results: Array<{ org: string; ok: boolean; err?: string }> = [];
    for (const row of rows ?? []) {
      if (!row.refresh_token_enc) continue;
      try {
        const refreshToken = await decryptToken(row.refresh_token_enc, ENC_KEY);
        const resp = await fetch(`https://${row.subdomain}.egnyte.com/puboauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token', refresh_token: refreshToken,
          }),
        });
        if (!resp.ok) {
          const t = await resp.text();
          await admin.from('tenant_integrations').update({
            status: 'expired',
            last_error: `refresh failed: ${resp.status} ${t.slice(0, 200)}`,
            updated_at: new Date().toISOString(),
          }).eq('organization_id', row.organization_id).eq('integration_slug', 'egnyte');
          results.push({ org: row.organization_id, ok: false, err: `${resp.status}` });
          continue;
        }
        const t = await resp.json();
        await admin.from('tenant_integrations').update({
          access_token_enc: await encryptToken(t.access_token, ENC_KEY),
          refresh_token_enc: t.refresh_token ? await encryptToken(t.refresh_token, ENC_KEY) : row.refresh_token_enc,
          token_expires_at: t.expires_in ? new Date(Date.now() + Number(t.expires_in) * 1000).toISOString() : null,
          status: 'connected',
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq('organization_id', row.organization_id).eq('integration_slug', 'egnyte');
        results.push({ org: row.organization_id, ok: true });
      } catch (e) {
        results.push({ org: row.organization_id, ok: false, err: (e as Error).message });
      }
    }
    return new Response(JSON.stringify({ refreshed: results.length, results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

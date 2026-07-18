// unanet-status — read-only status. Never returns the key or any derivative.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  CORS_HEADERS, adminClient, requireSession, enforceGates, handleError, json,
} from '../_shared/unanet.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  try {
    const session = await requireSession(req);
    const admin = adminClient();
    await enforceGates(admin, session);

    const { data: row } = await admin
      .from('unanet_connections')
      .select('status, last_verified_at, database_name, base_url, login_mode, last_error, updated_at')
      .eq('organization_id', session.organizationId)
      .maybeSingle();

    if (!row) return json({ connected: false, status: 'not_configured' });

    // Latest sync run (optional context for the UI).
    const { data: lastSync } = await admin
      .from('unanet_sync_runs')
      .select('id, status, started_at, finished_at, records_upserted, records_capped, error')
      .eq('organization_id', session.organizationId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return json({
      connected: true,
      status: row.status,
      base_url: row.base_url,
      database: row.database_name,
      login_mode: row.login_mode,
      last_verified_at: row.last_verified_at,
      last_error: row.last_error,
      updated_at: row.updated_at,
      last_sync: lastSync ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
});

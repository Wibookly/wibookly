// unanet-disconnect — revoke token if possible, then delete the connection row.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  CORS_HEADERS, adminClient, requireSession, enforceGates, handleError, json,
  getUnanetClientForOrg, evictClient,
} from '../_shared/unanet.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const session = await requireSession(req);
    const admin = adminClient();
    await enforceGates(admin, session);

    // Best-effort revoke — never blocks disconnect.
    try {
      const client = await getUnanetClientForOrg(admin, session.organizationId);
      await client.revoke();
    } catch (e) {
      console.warn('[unanet-disconnect] revoke skipped:', e instanceof Error ? e.message : e);
    }
    evictClient(session.organizationId);

    const { error } = await admin
      .from('unanet_connections')
      .delete()
      .eq('organization_id', session.organizationId);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
});

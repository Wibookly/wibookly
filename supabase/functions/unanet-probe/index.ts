// unanet-probe — validate base URL + database BEFORE asking for the API key.
// Feature-gated (returns 404) and role-gated (returns 403).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  CORS_HEADERS, adminClient, requireSession, enforceGates, handleError, json, probeInstance,
} from '../_shared/unanet.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const session = await requireSession(req);
    const admin = adminClient();
    await enforceGates(admin, session);

    const body = await req.json().catch(() => ({}));
    const baseUrl = String(body?.base_url ?? '').trim();
    const database = String(body?.database ?? '').trim();
    if (!/^https?:\/\//i.test(baseUrl)) return json({ error: 'base_url must start with http(s)://' }, 400);
    if (!database) return json({ error: 'database is required' }, 400);

    const result = await probeInstance(baseUrl, database);
    return json(result, result.ok ? 200 : 400);
  } catch (e) {
    return handleError(e);
  }
});

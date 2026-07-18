// unanet-connect — verify the credential FIRST, then persist encrypted.
// Never stores an unverified credential.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  CORS_HEADERS, adminClient, requireSession, enforceGates, handleError, json,
  verify_credentials, encryptApiKey, evictClient, probeInstance,
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
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
    if (!/^https?:\/\//i.test(baseUrl)) return json({ error: 'base_url must start with http(s)://' }, 400);
    if (!database) return json({ error: 'database is required' }, 400);
    if (!apiKey || apiKey.length < 8) return json({ error: 'api_key is required' }, 400);

    // 1. Probe to capture loginMode.
    const probe = await probeInstance(baseUrl, database);
    if (!probe.ok) return json({ error: probe.error ?? 'Unanet instance not reachable', probe }, 400);

    // 2. Verify the credential BEFORE persisting.
    const auth = await verify_credentials({ baseUrl, database, apiKey });

    // 3. Encrypt and upsert.
    const { ciphertext, key_id } = await encryptApiKey(apiKey);
    const now = new Date().toISOString();

    const { data: existing } = await admin
      .from('unanet_connections')
      .select('id')
      .eq('organization_id', session.organizationId)
      .maybeSingle();

    const payload = {
      organization_id: session.organizationId,
      base_url: baseUrl,
      database_name: database,
      api_key_ciphertext: ciphertext,
      api_key_key_id: key_id,
      login_mode: probe.loginMode ?? auth.loginMode ?? null,
      access_rights_snapshot: (auth.accessRightsSnapshot as any) ?? {},
      status: 'active' as const,
      last_verified_at: now,
      last_error: null as string | null,
      created_by: existing ? undefined : session.userId,
      updated_at: now,
    };

    if (existing?.id) {
      const { error } = await admin.from('unanet_connections').update(payload).eq('id', existing.id);
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin.from('unanet_connections').insert(payload);
      if (error) return json({ error: error.message }, 500);
    }

    // Evict any stale registry entry so the next call rebuilds against fresh creds.
    evictClient(session.organizationId);

    // Return a safe summary — NEVER the key or token.
    return json({
      status: 'active',
      last_verified_at: now,
      base_url: baseUrl,
      database,
      login_mode: probe.loginMode ?? null,
      access_rights_summary: summarizeAccessRights(auth.accessRightsSnapshot),
    });
  } catch (e) {
    return handleError(e);
  }
});

function summarizeAccessRights(snapshot: unknown): { modules?: string[]; note?: string } {
  if (!snapshot || typeof snapshot !== 'object') return { note: 'no access-rights payload' };
  const s = snapshot as Record<string, unknown>;
  if ((s as any).unavailable) return { note: 'access-rights endpoint unavailable' };
  const modules = Object.keys(s).filter((k) => typeof (s as any)[k] !== 'undefined');
  return { modules: modules.slice(0, 40) };
}

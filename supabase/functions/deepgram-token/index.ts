// Mints a short-lived Deepgram credential so the browser can open a streaming
// WebSocket directly to Deepgram without ever seeing the master API key.
//
// Strategy:
//   1) Try POST /v1/auth/grant (returns a JWT). Works when DEEPGRAM_API_KEY has
//      "Member" scope or higher.
//   2) If grant returns 401/403 (key lacks permission to mint JWTs), fall back
//      to creating a TEMPORARY project key via /v1/projects/{id}/keys with a
//      short expiration. This works with admin-scoped keys, which is what most
//      dashboard-generated keys are.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function tryGrant(apiKey: string) {
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: 60 }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

async function getFirstProjectId(apiKey: string): Promise<string | null> {
  const res = await fetch('https://api.deepgram.com/v1/projects', {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) {
    console.error('[deepgram-token] list projects failed', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data?.projects?.[0]?.project_id ?? null;
}

async function createTempKey(apiKey: string, projectId: string) {
  // Deepgram requires expiration_date (ISO) OR time_to_live_in_seconds.
  const res = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comment: `inboxiq-live-${Date.now()}`,
      scopes: ['usage:write'],
      time_to_live_in_seconds: 120,
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, status: res.status, body: text };
  const data = JSON.parse(text);
  return { ok: true as const, key: data.key as string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const DEEPGRAM_API_KEY = Deno.env.get('DEEPGRAM_API_KEY');
    if (!DEEPGRAM_API_KEY) {
      return new Response(JSON.stringify({ error: 'deepgram_not_configured' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1) Try the modern grant endpoint first.
    const grant = await tryGrant(DEEPGRAM_API_KEY);
    if (grant.ok) {
      const data = JSON.parse(grant.body);
      return new Response(JSON.stringify({
        access_token: data.access_token,
        expires_in: data.expires_in ?? 60,
        mode: 'grant',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2) On 401/403, fall back to creating a short-lived project key.
    if (grant.status === 401 || grant.status === 403) {
      console.warn('[deepgram-token] grant unavailable, falling back to temp key', grant.status);
      const projectId = await getFirstProjectId(DEEPGRAM_API_KEY);
      if (!projectId) {
        return new Response(JSON.stringify({
          error: 'deepgram_project_lookup_failed',
          hint: 'DEEPGRAM_API_KEY cannot list projects. Use an Admin-scoped key.',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const tmp = await createTempKey(DEEPGRAM_API_KEY, projectId);
      if (!tmp.ok) {
        console.error('[deepgram-token] temp-key creation failed', tmp.status, tmp.body);
        return new Response(JSON.stringify({
          error: 'deepgram_temp_key_failed',
          status: tmp.status,
          detail: tmp.body.slice(0, 300),
          hint: 'DEEPGRAM_API_KEY needs "keys:write" (Admin scope) to mint temporary keys, or "Member" scope to use /auth/grant.',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        access_token: tmp.key,
        expires_in: 120,
        mode: 'temp_key',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.error('[deepgram-token] grant failed', grant.status, grant.body);
    return new Response(JSON.stringify({
      error: 'grant_failed',
      status: grant.status,
      detail: grant.body.slice(0, 300),
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[deepgram-token] error', e);
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

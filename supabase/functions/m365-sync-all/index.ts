// m365-sync-all: cron entrypoint. Fans out delta-sync jobs to m365-sync-connection
// for every active outlook connection whose token vault is not in requires_reauth.
//
// Triggered by pg_cron (hourly). Auth: service-role bearer.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Require service-role (cron uses this; manual admin invocations should not call this).
  const auth = req.headers.get("Authorization") || "";
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Eligible: active outlook connections with a vault row that is NOT requires_reauth.
  const { data: conns, error } = await admin
    .from("provider_connections")
    .select("id, user_id, provider, is_connected, connected_email")
    .eq("provider", "outlook")
    .eq("is_connected", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  for (const c of conns ?? []) {
    // Vault gate
    const { data: vault } = await admin
      .from("oauth_token_vault")
      .select("requires_reauth")
      .eq("user_id", c.user_id).eq("provider", "outlook").eq("connection_id", c.id)
      .maybeSingle();
    if (!vault || vault.requires_reauth) {
      results.push({ connection_id: c.id, skipped: "requires_reauth_or_no_vault" });
      continue;
    }

    // Fire-and-forget; m365-sync-connection persists job rows.
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/m365-sync-connection`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "x-internal-user-id": c.user_id,
        },
        body: JSON.stringify({
          connection_id: c.id,
          sources: ["mail", "onedrive"],
          sync_type: "delta",
        }),
      });
      results.push({ connection_id: c.id, status: res.status });
    } catch (e) {
      results.push({ connection_id: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, fanned_out: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

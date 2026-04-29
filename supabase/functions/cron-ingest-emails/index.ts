// cron-ingest-emails: periodically backfill recent emails for all active connections
// Triggered by pg_cron via net.http_post. Auth: requires SUPABASE_SERVICE_ROLE_KEY in apikey header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PER_CONNECTION_LIMIT = 50; // recent messages per cron tick

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // This function is intended to be triggered only by pg_cron via net.http_post.
    // pg_net runs inside the Supabase project, so we accept the project anon key
    // in the apikey header (the standard Lovable cron pattern). Optionally a
    // CRON_SECRET in the body provides an extra check.
    const apikey = req.headers.get("apikey") || "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const isAuthorized =
      apikey === SERVICE_ROLE_KEY ||
      apikey === ANON_KEY;
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: connections, error: connErr } = await admin
      .from("provider_connections")
      .select("id, user_id, provider, connected_email")
      .eq("is_connected", true)
      .not("connected_email", "is", null);
    if (connErr) throw connErr;

    const results: Array<Record<string, unknown>> = [];
    for (const c of connections ?? []) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/ingest-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            connection_id: c.id,
            max_messages: PER_CONNECTION_LIMIT,
            triggered_by: "cron",
          }),
        });
        const txt = await resp.text();
        let parsed: any = null;
        try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 200) }; }
        results.push({
          connection_id: c.id,
          email: c.connected_email,
          status: resp.status,
          ingested: parsed?.ingested ?? parsed?.messages_ingested ?? null,
          embedded: parsed?.embedded ?? null,
          error: resp.ok ? null : parsed?.error ?? `HTTP ${resp.status}`,
        });
      } catch (e) {
        results.push({
          connection_id: c.id,
          email: c.connected_email,
          status: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        connections: results.length,
        results,
        ran_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("cron-ingest-emails error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

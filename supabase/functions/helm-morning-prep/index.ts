// helm-morning-prep
// Cron entrypoint that runs sync + planner for every user with an active outlook connection
// and an active Helm subscription. Designed to be called on a schedule before the user
// opens The Helm for the day. Service-role only.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function callFn(fn: string, body: any) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    return { ok: false, status: 0, error: String(e?.message ?? e) };
  }
}

Deno.serve(async (_req) => {
  // 1. Renew subscriptions about to expire
  await callFn("helm-subscribe", { mode: "renew_all" });

  // 2. Find users with active outlook connections
  const { data: conns } = await admin
    .from("provider_connections")
    .select("id, user_id, organization_id")
    .eq("provider", "outlook").eq("is_connected", true);

  const results: any[] = [];
  for (const c of conns ?? []) {
    const mail = await callFn("helm-sync-mail", { user_id: c.user_id, connection_id: c.id });
    const cal = await callFn("helm-sync-calendar", { user_id: c.user_id, connection_id: c.id });
    const plan = await callFn("helm-plan-week", { user_id: c.user_id, mode: "analyze" });
    await admin.from("activity_log").insert({
      user_id: c.user_id,
      organization_id: c.organization_id,
      action_type: "morning_prep",
      detail: `Morning prep ran: mail=${mail.status}, calendar=${cal.status}, plan=${plan.status}`,
      action_key: `morning_prep:${c.user_id}:${new Date().toISOString().slice(0,10)}`,
    });
    results.push({ user_id: c.user_id, mail, cal, plan });
  }

  return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});

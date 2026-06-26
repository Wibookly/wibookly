// helm-big3
// Big 3 CRUD + actions.
//
// POST { action: "set",       items: [{ ordinal, title, meta?, detail_json?, linked_item_id? }] }
// POST { action: "complete",  id: uuid }
// POST { action: "uncomplete",id: uuid }
// POST { action: "delete",    id: uuid }
// POST { action: "block_focus", id: uuid, start_iso: string, end_iso: string, timezone?: string }
//   -> Creates a real /me/events calendar block for that Big 3 item.
//
// All actions log to activity_log.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s: number, d: unknown) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "missing_jwt" });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json(401, { error: "invalid_jwt" });
  const userId = u.user.id;

  const { data: prof } = await admin.from("user_profiles")
    .select("organization_id").eq("user_id", userId).maybeSingle();
  const orgId = prof?.organization_id;
  if (!orgId) return json(400, { error: "no_organization" });

  const body = (await req.json().catch(() => ({}))) as any;
  const action = body?.action;

  if (action === "set") {
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return json(400, { error: "items_required" });
    // Replace whole set of Big 3 for the user (atomic-ish)
    await admin.from("helm_big3").delete().eq("user_id", userId);
    const rows = items.slice(0, 3).map((it: any, i: number) => ({
      user_id: userId,
      organization_id: orgId,
      ordinal: it.ordinal ?? i + 1,
      title: String(it.title ?? "").slice(0, 240) || "(untitled)",
      meta: it.meta ? String(it.meta).slice(0, 400) : null,
      detail_json: it.detail_json ?? { linked_item_id: it.linked_item_id ?? null },
      done: false,
    }));
    const { data: inserted, error } = await admin
      .from("helm_big3").insert(rows).select();
    if (error) return json(500, { error: error.message });
    await admin.from("activity_log").insert({
      user_id: userId, organization_id: orgId, action_type: "big3_set",
      detail: `Set today's Big 3 (${rows.length} item${rows.length === 1 ? "" : "s"})`,
      action_key: `big3_set:${Date.now()}`,
    });
    return json(200, { ok: true, items: inserted });
  }

  if (action === "complete" || action === "uncomplete") {
    const id = body.id;
    if (!id) return json(400, { error: "id_required" });
    const done = action === "complete";
    const { data: row, error } = await admin
      .from("helm_big3").update({ done, updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", userId).select().maybeSingle();
    if (error || !row) return json(404, { error: "not_found" });
    if (done) {
      await admin.from("activity_log").insert({
        user_id: userId, organization_id: orgId, action_type: "item_completed",
        detail: `Completed Big 3: ${row.title}`,
        action_key: `big3_done:${id}:${Date.now()}`,
      });
    }
    return json(200, { ok: true, item: row });
  }

  if (action === "delete") {
    const id = body.id;
    if (!id) return json(400, { error: "id_required" });
    await admin.from("helm_big3").delete().eq("id", id).eq("user_id", userId);
    return json(200, { ok: true });
  }

  if (action === "block_focus") {
    const { id, start_iso, end_iso, timezone } = body;
    if (!id || !start_iso || !end_iso) {
      return json(400, { error: "id_start_end_required" });
    }
    const { data: b3 } = await admin
      .from("helm_big3").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!b3) return json(404, { error: "not_found" });

    const { data: conn } = await admin
      .from("provider_connections").select("id")
      .eq("user_id", userId).eq("provider", "outlook").eq("is_connected", true)
      .order("connected_at", { ascending: false }).limit(1).maybeSingle();
    if (!conn?.id) return json(400, { error: "no_outlook_connection" });

    const tz = timezone || "UTC";
    const event = {
      subject: `🎯 Focus: ${b3.title}`,
      body: { contentType: "HTML", content: `<p><strong>Big 3 focus block</strong></p><p>${(b3.meta ?? "Protected time to make progress.").replace(/</g,"&lt;")}</p>` },
      start: { dateTime: start_iso, timeZone: tz },
      end: { dateTime: end_iso, timeZone: tz },
      showAs: "busy",
      categories: ["Helm Focus"],
      reminderMinutesBeforeStart: 5,
    };
    const r = await callGraph<any>(userId, conn.id, "calendar", "/me/events", {
      method: "POST", body: JSON.stringify(event),
    });
    if (!r.ok) return json(r.status || 502, { error: "create_event_failed", details: r.error });

    await admin.from("helm_big3").update({
      detail_json: { ...(b3.detail_json ?? {}), focus_event_id: r.data?.id, focus_start: start_iso, focus_end: end_iso },
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    await admin.from("activity_log").insert({
      user_id: userId, organization_id: orgId, action_type: "focus_block_created",
      detail: `Booked focus time for Big 3: ${b3.title}`,
      action_key: `focus:${id}:${start_iso}`,
    });
    return json(200, { ok: true, event_id: r.data?.id, web_link: r.data?.webLink });
  }

  return json(400, { error: "unknown_action" });
});

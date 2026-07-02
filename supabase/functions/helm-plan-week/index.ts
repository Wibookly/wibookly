// helm-plan-week
// Phase 5 — Focus rule engine.
// POST modes:
//   { mode: 'analyze', week_start?: ISO, connection_id? }
//   { mode: 'approve_external', proposal: {...}, connection_id? }
//   { mode: 'reschedule_event', event_id, start, end, subject?, connection_id? }
//
// Internal proposals are applied automatically (PATCH /me/events + warm note).
// External proposals are returned to the UI; the user approves them, which
// re-invokes this function with mode='approve_external'.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s: number, d: unknown) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const DAY_MAP: Record<string, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5,
};
const WINDOWS: Record<string, [number, number]> = {
  // Band presets (persisted in DB enum)
  morning: [8, 12],
  afternoon: [12, 17],
  evening: [16, 19],
  // Fine-grained start-hour presets (client-side only; not persisted to enum)
  morning_8: [8, 12], morning_9: [9, 12], morning_10: [10, 12], morning_11: [11, 12],
  afternoon_12: [12, 17], afternoon_1: [13, 17], afternoon_2: [14, 17], afternoon_3: [15, 17],
  late_4: [16, 19], late_5: [17, 19], late_6: [18, 19],
};
const VALID_WINDOWS = new Set(Object.keys(WINDOWS));
const ENUM_WINDOWS = new Set(["morning", "afternoon", "evening"]);
function windowToEnum(w: string): string {
  if (ENUM_WINDOWS.has(w)) return w;
  if (w.startsWith("morning")) return "morning";
  if (w.startsWith("afternoon")) return "afternoon";
  if (w.startsWith("late")) return "evening";
  return "morning";
}
const ALLOWED_BLOCK_MINUTES = new Set([30, 45, 60, 90, 120]);

async function callLLM(userId: string, system: string, user: string): Promise<string> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/llm-gateway`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        "x-internal-user-id": userId,
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 400,
      }),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    return String(
      data?.choices?.[0]?.message?.content ?? data?.content?.[0]?.text ?? "",
    ).trim();
  } catch {
    return "";
  }
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Naive ISO from Graph (in user TZ, no offset). Parse hours & minutes only.
function localHourMin(iso: string): { h: number; m: number } {
  // "2026-06-29T10:30:00.0000000"
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return { h: 0, m: 0 };
  return { h: Number(m[1]), m: Number(m[2]) };
}
function localDateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}
function makeLocalISO(dateKey: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${dateKey}T${hh}:${mm}:00`;
}
function addMinutesToHourMin(h: number, m: number, delta: number) {
  const total = h * 60 + m + delta;
  return { h: Math.floor(total / 60), m: total % 60 };
}

type ShapedEvent = {
  id: string;
  subject: string;
  start: string; // naive local ISO from Graph
  end: string;
  categories: string[];
  organizer: { name: string; email: string };
  attendees: Array<{ name: string; email: string }>;
  is_organizer: boolean;
  is_cancelled: boolean;
  is_external: boolean;
  sensitivity: string;
  type: string; // singleInstance | occurrence | seriesMaster
  etag?: string;
};

type Proposal = {
  id: string; // synthetic
  event_id: string;
  subject: string;
  day_key: string;
  old_start: string;
  old_end: string;
  new_start: string;
  new_end: string;
  is_external: boolean;
  is_organizer: boolean;
  attendees: Array<{ name: string; email: string }>;
  organizer: { name: string; email: string };
  classification: "internal" | "external";
  reason: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json(401, { error: "missing_jwt" });
  const jwt = auth.replace(/^Bearer\s+/i, "");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  let userId: string;
  let userEmail = "";
  if (jwt === SERVICE_ROLE_KEY && body?.user_id) {
    userId = body.user_id;
    const { data: u2 } = await admin.auth.admin.getUserById(userId).catch(() => ({ data: null } as any));
    userEmail = (u2?.user?.email ?? "").toLowerCase();
  } else {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json(401, { error: "invalid_jwt" });
    userId = u.user.id;
    userEmail = (u.user.email ?? "").toLowerCase();
  }

  const mode = (body?.mode as string) ?? "analyze";
  // Connection + org
  let connectionId: string | null = body?.connection_id ?? null;
  if (!connectionId) {
    const { data: conn } = await admin
      .from("provider_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "outlook")
      .eq("is_connected", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn?.id) return json(400, { error: "no_outlook_connection" });
    connectionId = conn.id;
  }
  const { data: connRow } = await admin
    .from("provider_connections")
    .select("organization_id")
    .eq("id", connectionId!)
    .maybeSingle();
  const orgId = connRow?.organization_id;
  if (!orgId) return json(400, { error: "connection_org_not_found" });

  // Tenant domains
  const tenantDomains = new Set<string>();
  const userDomain = userEmail.split("@")[1];
  if (userDomain) tenantDomains.add(userDomain);
  try {
    const { data: rows } = await admin
      .from("allowed_domains")
      .select("domain")
      .eq("organization_id", orgId);
    for (const r of rows ?? []) {
      const d = String((r as any).domain ?? "").toLowerCase().trim().replace(/^@/, "");
      if (d) tenantDomains.add(d);
    }
  } catch { /* */ }

  // Timezone
  let userTz = "UTC";
  try {
    const tz = await callGraph<any>(userId, connectionId!, "mail", "/me/mailboxSettings");
    if (tz.ok && tz.data?.timeZone) userTz = String(tz.data.timeZone);
  } catch { /* */ }

  // ============ Mode: preview_note (returns a draft warm note without sending) ============
  if (mode === "preview_note") {
    const p = body?.proposal as Proposal | undefined;
    if (!p?.event_id) return json(400, { error: "missing_proposal" });
    const note = p.is_organizer
      ? await composeWarmNote(userId, p)
      : await composeProposeNewTime(userId, p);
    return json(200, { ok: true, note });
  }

  // ============ Mode: delete_event (remove a calendar event from Outlook) ============
  if (mode === "delete_event") {
    const eventId = String(body?.event_id ?? "").trim();
    if (!eventId) return json(400, { error: "missing_event_id" });
    const res = await deleteEvent(userId, connectionId!, eventId);
    if (!res.ok) return json(res.status || 502, { error: "delete_failed", details: res.error });
    try {
      await admin.from("activity_log").insert({
        user_id: userId, organization_id: orgId,
        action_type: "calendar_event_deleted",
        detail: `Deleted event ${eventId}`,
        graph_id: eventId, tier: "user",
        action_key: `calendar_delete:${eventId}`,
      });
    } catch { /* non-fatal */ }
    return json(200, { ok: true, event_id: eventId });
  }

  // ============ Mode: delete_focus_blocks (wipe all focus blocks in a week) ============
  if (mode === "delete_focus_blocks") {
    const weekStartArg = body?.week_start ? new Date(body.week_start) : new Date();
    const monday = mondayOf(weekStartArg);
    const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
    const startISO = monday.toISOString().slice(0, 19);
    const endISO = saturday.toISOString().slice(0, 19);
    const res = await callGraph<any>(
      userId, connectionId!, "mail",
      `/me/calendarView?startDateTime=${startISO}&endDateTime=${endISO}&$select=id,subject,categories&$top=200`,
    );
    if (!res.ok) return json(res.status || 502, { error: "list_failed", details: res.error });
    const focusEvents = (res.data?.value ?? []).filter((e: any) => isFocusEventLike(e));
    let deleted = 0;
    for (const ev of focusEvents) {
      const d = await deleteEvent(userId, connectionId!, ev.id);
      if (d.ok) deleted++;
    }
    return json(200, { ok: true, deleted });
  }

  // ============ Mode: create_focus_block (user-approved) ============
  if (mode === "create_focus_block") {
    const dayKey = String(body?.day_key ?? "");
    const start = String(body?.start ?? "");
    const end = String(body?.end ?? "");
    const duplicateResolution = ["keep", "replace", "merge"].includes(String(body?.duplicate_resolution))
      ? String(body?.duplicate_resolution)
      : "keep";
    if (!dayKey || !start || !end) return json(400, { error: "missing_focus_args" });
    // Server-side dedupe: never silently create a second focus block on the same day.
    // If the user explicitly chooses Replace or Merge, resolve the existing block(s)
    // first so the day still ends with one protected focus window.
    try {
      const dayStart = `${dayKey}T00:00:00`;
      const dayEnd = `${dayKey}T23:59:59`;
      const existing = await callGraph<any>(
        userId, connectionId!, "mail",
        `/me/calendarView?startDateTime=${dayStart}&endDateTime=${dayEnd}&$select=id,subject,start,end,categories&$top=50`,
      );
      if (existing.ok && Array.isArray(existing.data?.value)) {
        const focusEvents = existing.data.value.filter((e: any) => isFocusEventLike(e));
        const primary = focusEvents[0];
        if (primary && duplicateResolution === "keep") {
          return json(200, {
            ok: true,
            skipped: "duplicate_focus_block",
            event_id: primary.id,
            existing_start: primary.start?.dateTime ?? null,
            existing_end: primary.end?.dateTime ?? null,
          });
        }
        if (primary && duplicateResolution === "merge") {
          const starts = [start, ...focusEvents.map((e: any) => e.start?.dateTime).filter(Boolean)].sort();
          const ends = [end, ...focusEvents.map((e: any) => e.end?.dateTime).filter(Boolean)].sort();
          const mergedStart = starts[0] ?? start;
          const mergedEnd = ends[ends.length - 1] ?? end;
          const patched = await patchEventTime(userId, connectionId!, primary.id, mergedStart, mergedEnd, userTz);
          if (!patched.ok) return json(502, { error: "merge_failed", details: patched.error });
          for (const extra of focusEvents.slice(1)) {
            const deleted = await deleteEvent(userId, connectionId!, extra.id);
            if (!deleted.ok) return json(502, { error: "merge_cleanup_failed", details: deleted.error });
          }
          await admin.from("activity_log").insert({
            user_id: userId, organization_id: orgId,
            action_type: "focus_block_created",
            detail: `Merged focus block ${mergedStart} → ${mergedEnd}`,
            graph_id: primary.id,
            tier: "user",
            action_key: `focus_block_merged:${dayKey}:${mergedStart}`,
          });
          return json(200, { ok: true, merged: true, event_id: primary.id, start: mergedStart, end: mergedEnd });
        }
        if (primary && duplicateResolution === "replace") {
          for (const ev of focusEvents) {
            const deleted = await deleteEvent(userId, connectionId!, ev.id);
            if (!deleted.ok) return json(502, { error: "replace_cleanup_failed", details: deleted.error });
          }
        }
      }
    } catch { /* non-fatal; fall through to create */ }
    const created = await callGraph<any>(userId, connectionId!, "mail", `/me/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Focus block (AI)",
        body: { contentType: "HTML", content: "Protected focus time — added by InboxIQ." },
        start: { dateTime: start, timeZone: userTz },
        end: { dateTime: end, timeZone: userTz },
        showAs: "busy",
        categories: ["Focus"],
        isReminderOn: false,
      }),
    });
    if (!created.ok) return json(502, { error: "create_failed", details: created.error });
    await admin.from("activity_log").insert({
      user_id: userId, organization_id: orgId,
      action_type: "focus_block_created",
      detail: `Focus block ${start} → ${end}`,
      graph_id: created.data?.id ?? null,
      tier: "user",
      action_key: `focus_block:${dayKey}:${start}`,
    });
    return json(200, { ok: true, event_id: created.data?.id, replaced: duplicateResolution === "replace" });
  }

  // ============ Mode: update_event_notes (sync note to Outlook event body) ============
  if (mode === "update_event_notes") {
    const eventId = String(body?.event_id ?? "").trim();
    const noteText = String(body?.note ?? "");
    if (!eventId) return json(400, { error: "missing_event_id" });
    // Fetch existing body so we don't clobber the meeting description.
    const existing = await callGraph<any>(
      userId, connectionId!, "mail",
      `/me/events/${encodeURIComponent(eventId)}?$select=body,bodyPreview`,
    );
    if (!existing.ok) return json(502, { error: "fetch_failed", details: existing.error });
    const currentHtml: string = existing.data?.body?.content ?? "";
    const START = "<!--INBOXIQ_NOTES_START-->";
    const END = "<!--INBOXIQ_NOTES_END-->";
    const stripped = currentHtml.replace(
      new RegExp(`${START}[\\s\\S]*?${END}`, "g"),
      "",
    ).trim();
    const safeNote = noteText
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
    const block = noteText.trim()
      ? `${START}<div style="border:1px solid #e5e7eb;background:#f8fafc;padding:10px 12px;border-radius:8px;font-family:Arial,sans-serif;font-size:13px;color:#111;margin-bottom:10px"><div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6366f1;margin-bottom:4px">InboxIQ notes</div>${safeNote}</div>${END}`
      : "";
    const nextHtml = `${block}${stripped}`;
    const patched = await callGraph<any>(
      userId, connectionId!, "mail", `/me/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: { contentType: "HTML", content: nextHtml } }),
      },
    );
    if (!patched.ok) return json(502, { error: "patch_failed", details: patched.error });
    return json(200, { ok: true, event_id: eventId });
  }

  // ============ Mode: reschedule_event (user drag/drop) ============
  if (mode === "reschedule_event") {
    const eventId = String(body?.event_id ?? "").trim();
    const start = String(body?.start ?? "").trim();
    const end = String(body?.end ?? "").trim();
    const subject = String(body?.subject ?? "Calendar event").trim() || "Calendar event";
    if (!eventId || !start || !end) return json(400, { error: "missing_reschedule_args" });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(end)) {
      return json(400, { error: "invalid_time_format" });
    }
    const patched = await patchEventTime(userId, connectionId!, eventId, start, end, userTz);
    if (!patched.ok) return json(502, { error: "patch_failed", details: patched.error });
    await admin.from("activity_log").insert({
      user_id: userId,
      organization_id: orgId,
      action_type: "event_moved",
      detail: `Rescheduled "${subject}" → ${start}`,
      graph_id: eventId,
      tier: "user",
      action_key: `manual_event_moved:${eventId}:${start}`,
    });
    return json(200, { ok: true, applied: true, event_id: eventId, start, end });
  }


  // ============ Mode: approve_external ============
  if (mode === "approve_external") {
    const p = body?.proposal as Proposal | undefined;
    if (!p?.event_id) return json(400, { error: "missing_proposal" });
    const customNote = typeof body?.custom_note === "string" && body.custom_note.trim().length > 0
      ? String(body.custom_note)
      : null;

    if (p.is_organizer) {
      const patched = await patchEventTime(
        userId, connectionId!, p.event_id, p.new_start, p.new_end, userTz,
      );
      if (!patched.ok) return json(502, { error: "patch_failed", details: patched.error });
      const note = customNote ?? await composeWarmNote(userId, p);
      await sendNote(userId, connectionId!, p.attendees, p.organizer, p.subject, note);
      await admin.from("activity_log").insert({
        user_id: userId, organization_id: orgId,
        action_type: "event_moved",
        detail: `Rescheduled external meeting "${p.subject}" → ${p.new_start}`,
        graph_id: p.event_id,
        tier: "user",
        action_key: `event_moved:${p.event_id}:${p.new_start}`,
      });
      return json(200, { ok: true, applied: true });
    } else {
      // Not organizer → propose new time via email
      const note = customNote ?? await composeProposeNewTime(userId, p);
      await sendNote(userId, connectionId!, [p.organizer], { name: "", email: userEmail }, `Re: ${p.subject}`, note);
      await admin.from("activity_log").insert({
        user_id: userId, organization_id: orgId,
        action_type: "note_sent",
        detail: `Asked organizer to move "${p.subject}"`,
        graph_id: p.event_id,
        tier: "user",
        action_key: `propose:${p.event_id}:${p.new_start}`,
      });
      return json(200, { ok: true, proposed: true });
    }
  }

  const strategy = (body?.strategy as string) === "reorganize" ? "reorganize" : "focus";
  // ============ Mode: analyze ============

  // 1) Load focus rule (insert default if missing), then apply any fresh UI
  // override before planning so duration changes affect the calendar on the
  // same request and are persisted in the database.
  let { data: rule } = await admin
    .from("helm_focus_rules")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!rule) {
    const { data: created } = await admin
      .from("helm_focus_rules")
      .insert({
        user_id: userId,
        organization_id: orgId,
        focus_days: ["tue", "thu"],
        focus_window: "morning",
          block_minutes: 30,
        autonomy: "auto_internal_ask_external",
        auto_reply_categories: [],
      })
      .select("*")
      .single();
    rule = created!;
  }

  const override = body?.rule_override && typeof body.rule_override === "object" ? body.rule_override : null;
  // Fine-grained window (e.g. "morning_9") is applied for THIS planning run
  // but the DB enum column only stores the band ("morning" | "afternoon" | "evening").
  let effectiveWindow: string = String(rule.focus_window);
  // Per-day window overrides — client-only (not persisted to DB enum column).
  // Shape: { mon: 'afternoon_1', wed: 'morning_10', ... }
  const perDayWindows: Record<string, string> = {};
  if (override) {
    const requestedWindow = VALID_WINDOWS.has(String(override.focus_window))
      ? String(override.focus_window)
      : effectiveWindow;
    effectiveWindow = requestedWindow;
    if (override.per_day_windows && typeof override.per_day_windows === "object") {
      for (const [k, v] of Object.entries(override.per_day_windows)) {
        const key = String(k).toLowerCase();
        const val = String(v);
        if (DAY_MAP[key] && VALID_WINDOWS.has(val)) perDayWindows[key] = val;
      }
    }
    const nextRule = {
      focus_days: Array.isArray(override.focus_days)
        ? override.focus_days.map((d: unknown) => String(d).toLowerCase()).filter((d: string) => DAY_MAP[d])
        : rule.focus_days,
      focus_window: windowToEnum(requestedWindow),
      block_minutes: ALLOWED_BLOCK_MINUTES.has(Number(override.block_minutes))
        ? Number(override.block_minutes)
        : rule.block_minutes,
      autonomy: ["ask_all", "auto_internal_ask_external", "auto_all"].includes(String(override.autonomy))
        ? String(override.autonomy)
        : rule.autonomy,
    };
    const { data: saved, error: saveErr } = await admin
      .from("helm_focus_rules")
      .upsert({
        user_id: userId,
        organization_id: orgId,
        ...nextRule,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select("*")
      .single();
    if (saveErr) return json(500, { error: "focus_rule_save_failed", details: saveErr.message });
    rule = saved!;
  }

  const focusDays: number[] = (rule.focus_days ?? []).map((d: string) => DAY_MAP[d.toLowerCase()]).filter(Boolean);
  const blockMin: number = ALLOWED_BLOCK_MINUTES.has(Number(rule.block_minutes)) ? Number(rule.block_minutes) : 30;
  const [defaultWinStart, defaultWinEnd] = WINDOWS[effectiveWindow] ?? WINDOWS[String(rule.focus_window)] ?? WINDOWS.morning;
  const DAY_ID_BY_NUM: Record<number, string> = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri" };
  const windowForWeekday = (weekdayNum: number): [number, number] => {
    const dayId = DAY_ID_BY_NUM[weekdayNum];
    const w = dayId ? perDayWindows[dayId] : undefined;
    if (w && WINDOWS[w]) return WINDOWS[w];
    return [defaultWinStart, defaultWinEnd];
  };
  const autonomy: string = rule.autonomy ?? "auto_internal_ask_external";


  // 2) Fetch week events (reuse same call shape as helm-sync-calendar)
  const anchor = body?.week_start ? new Date(body.week_start) : new Date();
  const monday = mondayOf(anchor);
  const sat = new Date(monday); sat.setDate(monday.getDate() + 5);

  const select = [
    "id","subject","start","end","organizer","attendees","isOrganizer",
    "type","isCancelled","sensitivity","categories",
  ].join(",");
  const endpoint =
    `/me/calendarView?startDateTime=${encodeURIComponent(monday.toISOString())}` +
    `&endDateTime=${encodeURIComponent(sat.toISOString())}` +
    `&$select=${select}&$orderby=start/dateTime&$top=200`;

  const res = await callGraph<any>(userId, connectionId!, "mail", endpoint, {
    method: "GET",
    headers: { Prefer: `outlook.timezone="${userTz}"` },
  });
  if (!res.ok) return json(502, { error: "graph_failed", details: res.error });

  const events: ShapedEvent[] = (res.data?.value ?? []).map((e: any) => {
    const attendees = (e.attendees ?? []).map((a: any) => ({
      name: a.emailAddress?.name ?? "",
      email: (a.emailAddress?.address ?? "").toLowerCase(),
    }));
    const isExternal = attendees.some((a: any) => {
      const d = a.email.split("@")[1];
      return !!d && !tenantDomains.has(d);
    });
    return {
      id: e.id,
      subject: e.subject ?? "(no subject)",
      start: e.start?.dateTime ?? "",
      end: e.end?.dateTime ?? "",
      categories: Array.isArray(e.categories) ? e.categories.map((c: unknown) => String(c)) : [],
      organizer: {
        name: e.organizer?.emailAddress?.name ?? "",
        email: (e.organizer?.emailAddress?.address ?? "").toLowerCase(),
      },
      attendees,
      is_organizer: !!e.isOrganizer,
      is_cancelled: !!e.isCancelled,
      is_external: isExternal,
      sensitivity: e.sensitivity ?? "normal",
      type: e.type ?? "singleInstance",
    };
  });

  // 3) For each focus day compute target block + conflicts
  const focusBlocks: Array<{
    day_key: string;
    weekday: string;
    start: string;
    end: string;
    state: "free" | "needs_move" | "blocked" | "exists";
    conflicts: string[];
    existing_event_id?: string | null;
    existing_start?: string | null;
    existing_end?: string | null;
    existing_count?: number;
  }> = [];
  const proposals: Proposal[] = [];

  // Helper: find first free gap of `durationMin` between [searchStartH, searchEndH] given busy ranges.
  function findGap(
    busy: Array<[number, number]>,
    searchStartH: number,
    searchEndH: number,
    durationMin: number,
  ): { startMin: number; endMin: number } | null {
    const startBound = searchStartH * 60;
    const endBound = searchEndH * 60;
    // Step in 15-min increments, snap to existing meeting boundaries first by sorting busy.
    const sorted = [...busy].sort((a, b) => a[0] - b[0]);
    // Build free intervals
    const free: Array<[number, number]> = [];
    let cursor = startBound;
    for (const [a, b] of sorted) {
      if (b <= startBound) continue;
      if (a >= endBound) break;
      const segA = Math.max(a, startBound);
      const segB = Math.min(b, endBound);
      if (segA > cursor) free.push([cursor, segA]);
      cursor = Math.max(cursor, segB);
    }
    if (cursor < endBound) free.push([cursor, endBound]);
    for (const [a, b] of free) {
      // Snap candidate to 15-min grid within [a,b]
      const candStart = Math.ceil(a / 15) * 15;
      if (candStart + durationMin <= b) {
        return { startMin: candStart, endMin: candStart + durationMin };
      }
    }
    return null;
  }

  // Track days already carrying focus time so we don't double-place when bumping.
  // This catches InboxIQ-created blocks plus user-created Outlook blocks named
  // "Focus time", "Deep work", etc.
  const existingFocusByDay = new Map<string, ShapedEvent[]>();
  for (const ev of events) {
    if (ev.is_cancelled || !ev.start) continue;
    if (!isFocusEventLike(ev)) continue;
    const dk = localDateKey(ev.start);
    existingFocusByDay.set(dk, [...(existingFocusByDay.get(dk) ?? []), ev]);
  }
  const usedDayKeys = new Set<string>(existingFocusByDay.keys());
  // Helper: find gap on a specific dt (Date) — returns null if none.
  const gapForDate = (dt: Date, options?: { ignoreFocusEvents?: boolean; window?: [number, number] }) => {
    const dk = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const dayEvs = events.filter((e) => !e.is_cancelled && localDateKey(e.start) === dk);
    const busySource = options?.ignoreFocusEvents ? dayEvs.filter((e) => !isFocusEventLike(e)) : dayEvs;
    const busy: Array<[number, number]> = busySource.map((e) => {
      const s = localHourMin(e.start); const en = localHourMin(e.end);
      return [s.h * 60 + s.m, en.h * 60 + en.m] as [number, number];
    });
    const [ws, we] = options?.window ?? windowForWeekday(dt.getDay());
    let g = findGap(busy, ws, we, blockMin);
    if (!g) g = findGap(busy, 9, 17, blockMin);
    return { dk, dayEvs, busy, gap: g };
  };

  for (let i = 0; i < 5; i++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    const weekdayNum = dt.getDay();
    if (!focusDays.includes(weekdayNum)) continue;
    const dayKey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const weekdayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][weekdayNum];
    const existingFocuses = existingFocusByDay.get(dayKey) ?? [];
    const existingFocus = existingFocuses[0];
    if (existingFocus) {
      const { gap } = gapForDate(dt, { ignoreFocusEvents: true });
      const proposed = gap ?? { startMin: windowForWeekday(weekdayNum)[0] * 60, endMin: windowForWeekday(weekdayNum)[0] * 60 + blockMin };
      const sH = Math.floor(proposed.startMin / 60), sM = proposed.startMin % 60;
      const eH = Math.floor(proposed.endMin / 60), eM = proposed.endMin % 60;
      focusBlocks.push({
        day_key: dayKey,
        weekday: weekdayName,
        start: makeLocalISO(dayKey, sH, sM),
        end: makeLocalISO(dayKey, eH, eM),
        state: "exists",
        conflicts: [
          `Existing focus time already on your calendar (${fmt(existingFocus.start)}–${fmt(existingFocus.end)}). AI did not add another without your approval.`,
        ],
        existing_event_id: existingFocus.id,
        existing_start: existingFocus.start,
        existing_end: existingFocus.end,
        existing_count: existingFocuses.length,
      });
      continue;
    }
    if (usedDayKeys.has(dayKey)) continue;

    const { dayEvs: dayEvents, gap } = gapForDate(dt);

    if (gap) {
      const sH = Math.floor(gap.startMin / 60), sM = gap.startMin % 60;
      const eH = Math.floor(gap.endMin / 60), eM = gap.endMin % 60;
      usedDayKeys.add(dayKey);
      focusBlocks.push({
        day_key: dayKey, weekday: weekdayName,
        start: makeLocalISO(dayKey, sH, sM),
        end: makeLocalISO(dayKey, eH, eM),
        state: "free", conflicts: [],
      });
      continue;
    }

    // No gap on preferred day — try bumping forward to any subsequent weekday this week.
    if (strategy !== "reorganize") {
      let bumped = false;
      for (let j = i + 1; j < 5; j++) {
        const dt2 = new Date(monday); dt2.setDate(monday.getDate() + j);
        const dk2 = `${dt2.getFullYear()}-${String(dt2.getMonth()+1).padStart(2,"0")}-${String(dt2.getDate()).padStart(2,"0")}`;
        if (usedDayKeys.has(dk2)) continue;
        const { gap: g2 } = gapForDate(dt2);
        if (!g2) continue;
        const sH = Math.floor(g2.startMin / 60), sM = g2.startMin % 60;
        const eH = Math.floor(g2.endMin / 60), eM = g2.endMin % 60;
        usedDayKeys.add(dk2);
        focusBlocks.push({
          day_key: dk2,
          weekday: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt2.getDay()],
          start: makeLocalISO(dk2, sH, sM),
          end: makeLocalISO(dk2, eH, eM),
          state: "free", conflicts: [`Bumped from ${weekdayName} — no open ${blockMin}-min gap.`],
        });
        bumped = true;
        break;
      }
      if (bumped) continue;
    }

    // 3) No natural gap. For "focus" strategy → just mark blocked (no moves).
    //    For "reorganize" strategy → propose moving the most moveable conflict.
    const blockStartH = windowForWeekday(weekdayNum)[0], blockStartM = 0;
    const blockEnd = addMinutesToHourMin(blockStartH, blockStartM, blockMin);
    const targetStart = makeLocalISO(dayKey, blockStartH, blockStartM);
    const targetEnd = makeLocalISO(dayKey, blockEnd.h, blockEnd.m);
    const tS = blockStartH * 60 + blockStartM, tE = tS + blockMin;
    const overlaps = dayEvents.filter((e) => {
      const s = localHourMin(e.start); const en = localHourMin(e.end);
      const sMin = s.h * 60 + s.m, eMin = en.h * 60 + en.m;
      return sMin < tE && eMin > tS;
    });
    const conflictTitles = overlaps.map((e) => e.subject);

    if (strategy !== "reorganize") {
      focusBlocks.push({
        day_key: dayKey, weekday: weekdayName,
        start: targetStart, end: targetEnd,
        state: "blocked", conflicts: conflictTitles,
      });
      continue;
    }

    // Reorganize: try to move one conflicting event into another free slot.
    const ranked = [...overlaps].sort((a, b) => moveScore(a, userEmail) - moveScore(b, userEmail));
    const proposed: Proposal[] = [];
    for (const ev of ranked) {
      if (ev.sensitivity === "private" || ev.sensitivity === "confidential") continue;
      const dur =
        (localHourMin(ev.end).h * 60 + localHourMin(ev.end).m) -
        (localHourMin(ev.start).h * 60 + localHourMin(ev.start).m);
      // Search the rest of the day excluding this event
      const otherBusy: Array<[number, number]> = dayEvents
        .filter((e) => e.id !== ev.id)
        .map((e) => {
          const s = localHourMin(e.start); const en = localHourMin(e.end);
          return [s.h * 60 + s.m, en.h * 60 + en.m] as [number, number];
        });
      const slot = findGap(otherBusy, 9, 17, dur);
      if (!slot) continue;
      const sH = Math.floor(slot.startMin / 60), sM = slot.startMin % 60;
      const eH = Math.floor(slot.endMin / 60), eM = slot.endMin % 60;
      const classification: "internal" | "external" = ev.is_external ? "external" : "internal";
      proposed.push({
        id: `${ev.id}:${makeLocalISO(dayKey, sH, sM)}`,
        event_id: ev.id, subject: ev.subject, day_key: dayKey,
        old_start: ev.start, old_end: ev.end,
        new_start: makeLocalISO(dayKey, sH, sM),
        new_end: makeLocalISO(dayKey, eH, eM),
        is_external: ev.is_external, is_organizer: ev.is_organizer,
        attendees: ev.attendees, organizer: ev.organizer,
        classification,
        reason: ev.is_external
          ? "Has external attendees — needs your OK."
          : "Internal meeting — moved automatically to open your focus block.",
      });
      break;
    }

    focusBlocks.push({
      day_key: dayKey, weekday: weekdayName,
      start: targetStart, end: targetEnd,
      state: proposed.length ? "needs_move" : "blocked",
      conflicts: conflictTitles,
    });
    proposals.push(...proposed);
  }

  // 4) Apply internal proposals (if autonomy permits)
  const applied: Array<Proposal & { note: string }> = [];
  const pending: Proposal[] = [];

  for (const p of proposals) {
    const canAuto =
      (autonomy === "auto_all") ||
      (autonomy === "auto_internal_ask_external" && p.classification === "internal");
    if (!canAuto || !p.is_organizer) {
      pending.push(p);
      continue;
    }
    // Dedup guard via action_key
    const actionKey = `event_moved:${p.event_id}:${p.new_start}`;
    const { data: existing } = await admin
      .from("activity_log")
      .select("id")
      .eq("user_id", userId)
      .eq("action_key", actionKey)
      .maybeSingle();
    if (existing) {
      applied.push({ ...p, note: "(previously moved)" });
      continue;
    }
    const patched = await patchEventTime(
      userId, connectionId!, p.event_id, p.new_start, p.new_end, userTz,
    );
    if (!patched.ok) {
      pending.push({ ...p, reason: `Auto-move failed: ${String(patched.error).slice(0,120)}` });
      continue;
    }
    const note = await composeWarmNote(userId, p);
    await sendNote(userId, connectionId!, p.attendees, p.organizer, p.subject, note);
    await admin.from("activity_log").insert({
      user_id: userId, organization_id: orgId,
      action_type: "event_moved",
      detail: `Rescheduled "${p.subject}" → ${p.new_start}`,
      graph_id: p.event_id,
      tier: "auto",
      action_key: actionKey,
    });
    applied.push({ ...p, note });
  }

  return json(200, {
    ok: true,
    timezone: userTz,
    rule,
    focus_blocks: focusBlocks,
    applied,
    pending_external: pending,
  });
});

// ---------- helpers ----------

function moveScore(e: ShapedEvent, userEmail: string): number {
  let s = 0;
  if (e.is_external) s += 100;
  if (e.attendees.length >= 5) s += 20;
  if (e.attendees.length <= 2) s -= 10;
  if (!e.is_organizer) s += 40; // less moveable if not host
  if (e.organizer.email === userEmail) s -= 10;
  if (/standup|status|sync/i.test(e.subject)) s -= 20;
  if (/board|client|customer|interview/i.test(e.subject)) s += 50;
  return s;
}

function isFocusEventLike(e: { subject?: unknown; categories?: unknown }): boolean {
  const subject = String(e?.subject ?? "").toLowerCase();
  const categories = Array.isArray(e?.categories)
    ? e.categories.map((c) => String(c).toLowerCase())
    : [];
  return (
    /\b(focus|focus time|focus block|deep work|heads[-\s]?down|protected work|quiet work)\b/i.test(subject) ||
    categories.some((c) => /\bfocus\b/i.test(c))
  );
}

function findFreeSlot(
  dayEvents: ShapedEvent[],
  excludeId: string,
  searchStartHour: number,
  searchEndHour: number,
  durationMin: number,
  dayKey: string,
): { start: string; end: string } | null {
  const busy = dayEvents
    .filter((e) => e.id !== excludeId && !e.is_cancelled)
    .map((e) => {
      const s = localHourMin(e.start), en = localHourMin(e.end);
      return [s.h * 60 + s.m, en.h * 60 + en.m] as [number, number];
    });
  const dayEndMin = searchEndHour * 60;
  for (let m = searchStartHour * 60; m + durationMin <= dayEndMin; m += 15) {
    const conflict = busy.some(([a, b]) => m < b && m + durationMin > a);
    if (!conflict) {
      return {
        start: makeLocalISO(dayKey, Math.floor(m / 60), m % 60),
        end: makeLocalISO(dayKey, Math.floor((m + durationMin) / 60), (m + durationMin) % 60),
      };
    }
  }
  return null;
}

async function patchEventTime(
  userId: string, connectionId: string, eventId: string,
  newStart: string, newEnd: string, tz: string,
) {
  return callGraph<any>(userId, connectionId, "mail", `/me/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start: { dateTime: newStart, timeZone: tz },
      end: { dateTime: newEnd, timeZone: tz },
    }),
  });
}

async function deleteEvent(userId: string, connectionId: string, eventId: string) {
  return callGraph<any>(userId, connectionId, "mail", `/me/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}

async function composeWarmNote(userId: string, p: Proposal): Promise<string> {
  const name = p.attendees[0]?.name?.split(" ")[0] || "there";
  const seed =
    `Hi ${name} — I'm reorganizing my week to protect some focused work time, ` +
    `and I'd like to shift our "${p.subject}" from ${fmt(p.old_start)} to ${fmt(p.new_start)}. ` +
    `I hope that still works on your end — if it's a problem, just say the word and ` +
    `we'll find another slot that suits you. Thanks for being flexible.`;
  const polished = await callLLM(
    userId,
    "Rewrite the user's note in their voice. Warm, concise, professional. Keep it 3–4 sentences. Preserve all meeting names and times exactly.",
    seed,
  );
  return polished || seed;
}

async function composeProposeNewTime(userId: string, p: Proposal): Promise<string> {
  const seed =
    `Hi ${p.organizer.name?.split(" ")[0] || "there"} — ` +
    `Would it be possible to move "${p.subject}" from ${fmt(p.old_start)} to ${fmt(p.new_start)}? ` +
    `I'm trying to protect a block of focused time on my end. Happy to find another slot if that's tough — just let me know what works.`;
  const polished = await callLLM(
    userId,
    "Rewrite in the user's voice. Warm, professional, 3 sentences. Keep meeting names and times exactly.",
    seed,
  );
  return polished || seed;
}

function fmt(iso: string): string {
  // "2026-06-30T10:00:00" -> "Tue Jun 30, 10:00 AM"
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

async function sendNote(
  userId: string, connectionId: string,
  to: Array<{ name?: string; email: string }>,
  from: { name?: string; email: string },
  subject: string,
  body: string,
) {
  const recipients = to
    .filter((r) => r.email && r.email !== from.email)
    .map((r) => ({ emailAddress: { address: r.email, name: r.name || "" } }));
  if (recipients.length === 0) return { ok: true } as any;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">` +
    body.replace(/\n/g, "<br/>") +
    `</div>`;
  return callGraph<any>(userId, connectionId, "mail", `/me/sendMail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: `Quick shift: ${subject}`,
        body: { contentType: "HTML", content: html },
        toRecipients: recipients,
      },
      saveToSentItems: true,
    }),
  });
}

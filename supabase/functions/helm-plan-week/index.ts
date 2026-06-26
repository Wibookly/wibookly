// helm-plan-week
// Phase 5 — Focus rule engine.
// POST modes:
//   { mode: 'analyze', week_start?: ISO, connection_id? }
//   { mode: 'approve_external', proposal: {...}, connection_id? }
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
  morning: [9, 12],
  afternoon: [13, 17],
};

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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u?.user) return json(401, { error: "invalid_jwt" });
  const userId = u.user.id;
  const userEmail = (u.user.email ?? "").toLowerCase();

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
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

  // ============ Mode: approve_external ============
  if (mode === "approve_external") {
    const p = body?.proposal as Proposal | undefined;
    if (!p?.event_id) return json(400, { error: "missing_proposal" });

    if (p.is_organizer) {
      const patched = await patchEventTime(
        userId, connectionId!, p.event_id, p.new_start, p.new_end, userTz,
      );
      if (!patched.ok) return json(502, { error: "patch_failed", details: patched.error });
      const note = await composeWarmNote(userId, p);
      await sendNote(userId, connectionId!, p.attendees, p.organizer, p.subject, note);
      await admin.from("activity_log").insert({
        user_id: userId, organization_id: orgId,
        action_type: "event_moved",
        detail: `Rescheduled external meeting "${p.subject}" → ${p.new_start}`,
        graph_id: p.event_id,
        tier: "auto",
        action_key: `event_moved:${p.event_id}:${p.new_start}`,
      });
      return json(200, { ok: true, applied: true });
    } else {
      // Not organizer → propose new time via email
      const note = await composeProposeNewTime(userId, p);
      await sendNote(userId, connectionId!, [p.organizer], { name: "", email: userEmail }, `Re: ${p.subject}`, note);
      await admin.from("activity_log").insert({
        user_id: userId, organization_id: orgId,
        action_type: "note_sent",
        detail: `Asked organizer to move "${p.subject}"`,
        graph_id: p.event_id,
        tier: "auto",
        action_key: `propose:${p.event_id}:${p.new_start}`,
      });
      return json(200, { ok: true, proposed: true });
    }
  }

  // ============ Mode: analyze ============

  // 1) Load focus rule (insert default if missing)
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
        block_minutes: 90,
        autonomy: "auto_internal_ask_external",
        auto_reply_categories: [],
      })
      .select("*")
      .single();
    rule = created!;
  }

  const focusDays: number[] = (rule.focus_days ?? []).map((d: string) => DAY_MAP[d.toLowerCase()]).filter(Boolean);
  const blockMin: number = rule.block_minutes ?? 90;
  const [winStart, winEnd] = WINDOWS[rule.focus_window] ?? WINDOWS.morning;
  const autonomy: string = rule.autonomy ?? "auto_internal_ask_external";

  // 2) Fetch week events (reuse same call shape as helm-sync-calendar)
  const anchor = body?.week_start ? new Date(body.week_start) : new Date();
  const monday = mondayOf(anchor);
  const sat = new Date(monday); sat.setDate(monday.getDate() + 5);

  const select = [
    "id","subject","start","end","organizer","attendees","isOrganizer",
    "type","isCancelled","sensitivity",
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
    state: "free" | "needs_move" | "blocked";
    conflicts: string[];
  }> = [];
  const proposals: Proposal[] = [];

  for (let i = 0; i < 5; i++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    const weekdayNum = dt.getDay();
    if (!focusDays.includes(weekdayNum)) continue;
    const dayKey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const weekdayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][weekdayNum];

    // Target block at start of window
    const blockStartH = winStart, blockStartM = 0;
    const blockEnd = addMinutesToHourMin(blockStartH, blockStartM, blockMin);
    const targetStart = makeLocalISO(dayKey, blockStartH, blockStartM);
    const targetEnd = makeLocalISO(dayKey, blockEnd.h, blockEnd.m);

    // Conflicts: events overlapping target block
    const dayEvents = events.filter(
      (e) => !e.is_cancelled && localDateKey(e.start) === dayKey,
    );
    const overlaps = dayEvents.filter((e) => {
      const s = localHourMin(e.start); const en = localHourMin(e.end);
      const sMin = s.h * 60 + s.m, eMin = en.h * 60 + en.m;
      const tS = blockStartH * 60 + blockStartM, tE = tS + blockMin;
      return sMin < tE && eMin > tS;
    });

    if (overlaps.length === 0) {
      focusBlocks.push({
        day_key: dayKey, weekday: weekdayName,
        start: targetStart, end: targetEnd, state: "free", conflicts: [],
      });
      continue;
    }

    // Rank overlaps by "moveability" (lowest first)
    const ranked = [...overlaps].sort((a, b) => moveScore(a, userEmail) - moveScore(b, userEmail));

    const conflictTitles: string[] = [];
    const proposed: Proposal[] = [];

    for (const ev of ranked) {
      conflictTitles.push(ev.subject);
      if (ev.sensitivity === "private" || ev.sensitivity === "confidential") continue;
      // Find a new slot AFTER the window same day
      const dur =
        (localHourMin(ev.end).h * 60 + localHourMin(ev.end).m) -
        (localHourMin(ev.start).h * 60 + localHourMin(ev.start).m);
      const newSlot = findFreeSlot(dayEvents, ev.id, winEnd, 17, dur, dayKey);
      if (!newSlot) continue;

      const classification: "internal" | "external" = ev.is_external ? "external" : "internal";
      proposed.push({
        id: `${ev.id}:${newSlot.start}`,
        event_id: ev.id,
        subject: ev.subject,
        day_key: dayKey,
        old_start: ev.start, old_end: ev.end,
        new_start: newSlot.start, new_end: newSlot.end,
        is_external: ev.is_external,
        is_organizer: ev.is_organizer,
        attendees: ev.attendees,
        organizer: ev.organizer,
        classification,
        reason: ev.is_external
          ? "Has attendees outside your organization — needs your OK."
          : "Internal meeting — moved automatically to open your focus block.",
      });

      // Once we've freed enough room (one move usually does it for v1) stop
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

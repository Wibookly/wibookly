// helm-sync-calendar
// Fetches the user's Mon–Fri calendar week from Microsoft Graph and returns
// events with attendees, organizer info, and an is_external flag (any
// attendee outside the user's verified tenant domain(s)).
//
// POST body (optional): { connection_id?: string, week_start?: string (ISO date) }
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type GraphEvent = {
  id: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: Array<{
    emailAddress?: { name?: string; address?: string };
    type?: string;
    status?: { response?: string };
  }>;
  isOrganizer?: boolean;
  type?: string;
  seriesMasterId?: string;
  isCancelled?: boolean;
  webLink?: string;
  sensitivity?: string;
  location?: { displayName?: string };
  bodyPreview?: string;
  onlineMeeting?: { joinUrl?: string };
};

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "missing_jwt" });
  const jwt = authHeader.replace(/^Bearer\s+/i, "");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  let userId: string;
  let userEmail = "";
  if (jwt === SERVICE_ROLE_KEY && body?.user_id) {
    userId = body.user_id;
    const { data: u } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: null } as any));
    userEmail = (u?.user?.email ?? "").toLowerCase();
  } else {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: "invalid_jwt" });
    userId = userData.user.id;
    userEmail = (userData.user.email ?? "").toLowerCase();
  }

  // Connection
  let connectionId: string | null = body?.connection_id ?? null;
  if (!connectionId) {
    const { data: conn } = await supabase
      .from("provider_connections")
      .select("id, organization_id")
      .eq("user_id", userId)
      .eq("provider", "outlook")
      .eq("is_connected", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn?.id) return json(400, { error: "no_outlook_connection" });
    connectionId = conn.id;
  }

  const { data: connRow } = await supabase
    .from("provider_connections")
    .select("organization_id")
    .eq("id", connectionId!)
    .maybeSingle();
  const orgId = connRow?.organization_id;
  if (!orgId) return json(400, { error: "connection_org_not_found" });

  // Verified tenant domains (for is_external)
  const tenantDomains = new Set<string>();
  const userDomain = userEmail.split("@")[1];
  if (userDomain) tenantDomains.add(userDomain.toLowerCase());
  try {
    const { data: domRows } = await supabase
      .from("allowed_domains")
      .select("domain")
      .eq("organization_id", orgId);
    for (const r of domRows ?? []) {
      const d = String((r as any).domain ?? "").toLowerCase().trim();
      if (d) tenantDomains.add(d.replace(/^@/, ""));
    }
  } catch { /* table may differ — fall back to user domain */ }

  // User timezone from mailboxSettings
  let userTz = "UTC";
  try {
    const tzRes = await callGraph<any>(
      userId,
      connectionId!,
      "mail",
      "/me/mailboxSettings",
    );
    if (tzRes.ok && tzRes.data?.timeZone) userTz = String(tzRes.data.timeZone);
  } catch { /* default UTC */ }

  // Week window (Mon 00:00 → Sat 00:00) in user's local clock, but Graph
  // calendarView accepts ISO; we pass instants. Use UTC ISO around the requested week.
  const anchor = body?.week_start ? new Date(body.week_start) : new Date();
  const monday = mondayOf(anchor);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);

  const startISO = monday.toISOString();
  const endISO = saturday.toISOString();

  const selectFields = [
    "id", "subject", "start", "end", "organizer", "attendees",
    "isOrganizer", "type", "seriesMasterId", "isCancelled",
    "webLink", "sensitivity", "location", "bodyPreview", "onlineMeeting",
  ].join(",");

  const endpoint =
    `/me/calendarView?startDateTime=${encodeURIComponent(startISO)}` +
    `&endDateTime=${encodeURIComponent(endISO)}` +
    `&$select=${selectFields}&$orderby=start/dateTime&$top=200`;

  const events: GraphEvent[] = [];
  let next: string | null = endpoint;
  let pages = 0;
  while (next && pages < 5) {
    pages++;
    const res = await callGraph<any>(
      userId,
      connectionId!,
      "mail", // calendar uses the same Graph token; resource label
      next,
      {
        method: "GET",
        headers: {
          Prefer: `outlook.timezone="${userTz}"`,
        },
      },
    );
    if (!res.ok) {
      return json(res.status || 502, { error: "graph_failed", details: res.error });
    }
    events.push(...(res.data?.value ?? []));
    const nl = res.data?.["@odata.nextLink"] as string | undefined;
    next = nl ? nl.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "") : null;
  }

  const shaped = events.map((e) => {
    const attendees = (e.attendees ?? []).map((a) => ({
      name: a.emailAddress?.name ?? "",
      email: (a.emailAddress?.address ?? "").toLowerCase(),
      type: a.type ?? "required",
      response: a.status?.response ?? "none",
    }));
    const isExternal = attendees.some((a) => {
      const d = a.email.split("@")[1];
      return !!d && !tenantDomains.has(d);
    });
    return {
      id: e.id,
      subject: e.subject ?? "(no subject)",
      start: e.start?.dateTime ?? null,
      end: e.end?.dateTime ?? null,
      time_zone: e.start?.timeZone ?? userTz,
      organizer: {
        name: e.organizer?.emailAddress?.name ?? "",
        email: (e.organizer?.emailAddress?.address ?? "").toLowerCase(),
      },
      attendees,
      is_organizer: !!e.isOrganizer,
      type: e.type ?? "singleInstance",
      series_master_id: e.seriesMasterId ?? null,
      is_cancelled: !!e.isCancelled,
      web_link: e.webLink ?? null,
      sensitivity: e.sensitivity ?? "normal",
      location: e.location?.displayName ?? "",
      body_preview: e.bodyPreview ?? "",
      join_url: e.onlineMeeting?.joinUrl ?? null,
      is_external: isExternal,
    };
  });

  return json(200, {
    ok: true,
    timezone: userTz,
    week_start: monday.toISOString(),
    week_end: saturday.toISOString(),
    count: shaped.length,
    events: shaped,
  });
});

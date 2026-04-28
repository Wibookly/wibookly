// Sends scheduled Daily Briefs from the org's agent shared mailbox.
// Triggered every minute by pg_cron. Finds rows in `daily_brief_schedules`
// whose local time matches NOW(timezone) and is_enabled=true, generates a
// brief using the existing `ai-daily-brief` function, then emails it via
// Microsoft Graph using app-only auth (client credentials).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MS_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") || "";
const MS_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET") || "";
const MS_TENANT_FALLBACK = Deno.env.get("MICROSOFT_TENANT_ID") || "";

interface ScheduleRow {
  id: string;
  user_id: string;
  organization_id: string;
  connection_id: string | null;
  day_of_week: number;
  brief_type: "morning" | "evening";
  send_time: string;
  is_enabled: boolean;
  timezone: string;
  sender_email: string;
  recipient_email: string | null;
  last_sent_at: string | null;
}

async function getAppToken(tenantId: string): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

function nowParts(tz: string): { dow: number; hhmm: string; date: string } {
  // Returns weekday (0=Sun..6=Sat) and HH:MM in the given IANA timezone.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    dow: map[parts.weekday as string] ?? -1,
    hhmm: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function esc(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function urgencyColor(u?: string): { bg: string; fg: string; border: string } {
  if (u === "high") return { bg: "#fef2f2", fg: "#b91c1c", border: "#ef4444" };
  if (u === "medium") return { bg: "#fffbeb", fg: "#b45309", border: "#f59e0b" };
  return { bg: "#f0fdf4", fg: "#047857", border: "#10b981" };
}

function renderBriefHtml(
  brief: any,
  brief_type: string,
  recipient: string,
  pendingFollowUps: any[] = [],
  dateLabel: string = ""
): string {
  const heading = brief_type === "morning" ? "☀️ Your Morning Brief" : "🌙 Your End-of-Day Recap";
  const greeting = esc(brief?.greeting || "");
  const summary = esc(brief?.summary || "Here is your daily brief.");

  // AI Analysis – What to do first
  const ai = brief?.aiAnalysis || {};
  const whatToDoItems = Array.isArray(ai.whatToDoFirst) ? ai.whatToDoFirst : [];
  const aiBlock = `
    <div style="margin:24px 0;padding:18px 20px;border-radius:10px;background:linear-gradient(135deg,#eff6ff 0%,#f5f3ff 100%);border:1px solid #c7d2fe">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#4338ca;text-transform:uppercase;margin-bottom:6px">🤖 AI Analysis — What to do first</div>
      ${ai.headline ? `<p style="margin:0 0 14px;font-size:15px;color:#0f172a;font-weight:600">${esc(ai.headline)}</p>` : ""}
      ${
        whatToDoItems.length
          ? `<ol style="margin:0;padding-left:0;list-style:none;counter-reset:step">
              ${whatToDoItems.map((it: any, i: number) => `
                <li style="display:flex;gap:12px;padding:10px 12px;margin:6px 0;background:#ffffff;border-radius:8px;border:1px solid #e0e7ff">
                  <div style="flex-shrink:0;width:26px;height:26px;border-radius:50%;background:#4338ca;color:#fff;font-weight:700;font-size:13px;display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:26px">${esc(it.step ?? i + 1)}</div>
                  <div style="flex:1">
                    <div style="font-weight:600;color:#0f172a;font-size:14px">${esc(it.action || "")}</div>
                    ${it.why ? `<div style="color:#64748b;font-size:12px;margin-top:2px">${esc(it.why)}</div>` : ""}
                    ${it.estimatedMinutes ? `<div style="color:#4338ca;font-size:11px;font-weight:600;margin-top:4px">⏱ ~${esc(it.estimatedMinutes)} min</div>` : ""}
                  </div>
                </li>`).join("")}
            </ol>`
          : `<p style="color:#64748b;margin:0;font-size:13px">No specific actions queued — review priorities below.</p>`
      }
      ${Array.isArray(ai.risks) && ai.risks.length ? `<div style="margin-top:14px;padding:10px 12px;background:#fef2f2;border-left:3px solid #ef4444;border-radius:4px"><div style="font-size:11px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">⚠️ At Risk</div><ul style="margin:0;padding-left:18px;color:#7f1d1d;font-size:13px">${ai.risks.map((r: string) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      ${Array.isArray(ai.wins) && ai.wins.length ? `<div style="margin-top:10px;padding:10px 12px;background:#f0fdf4;border-left:3px solid #10b981;border-radius:4px"><div style="font-size:11px;font-weight:700;color:#047857;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">✨ Quick Wins</div><ul style="margin:0;padding-left:18px;color:#065f46;font-size:13px">${ai.wins.map((w: string) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    </div>`;

  // Priorities — Today Highlighted
  const priorities = Array.isArray(brief?.priorities) ? brief.priorities : [];
  const prioritiesBlock = priorities.length
    ? `<h2 style="font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:24px 0 12px">🎯 Today's Priorities</h2>
       ${priorities.map((p: any) => {
          const c = urgencyColor(p.urgency);
          return `<div style="padding:12px 14px;margin:8px 0;background:${c.bg};border-left:4px solid ${c.border};border-radius:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <strong style="color:#0f172a;font-size:14px">${esc(p.title)}</strong>
              <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${c.fg};background:#fff;padding:3px 8px;border-radius:10px;border:1px solid ${c.border}">${esc(p.urgency || "medium")}</span>
            </div>
            ${p.description ? `<p style="margin:6px 0 0;color:#475569;font-size:13px">${esc(p.description)}</p>` : ""}
          </div>`;
        }).join("")}`
    : "";

  // Schedule
  const schedule = Array.isArray(brief?.schedule) ? brief.schedule : [];
  const scheduleBlock = schedule.length
    ? `<h2 style="font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:24px 0 12px">📅 Today's Schedule</h2>
       <div>${schedule.map((s: any) => `
          <div style="display:flex;padding:10px 0;border-bottom:1px solid #f1f5f9">
            <span style="width:110px;font-family:monospace;color:#0ea5e9;font-weight:600;font-size:13px">${esc(s.time)}</span>
            <div style="flex:1">
              <strong style="color:#0f172a;font-size:14px">${esc(s.title)}</strong>
              ${s.description ? `<p style="margin:3px 0 0;color:#64748b;font-size:13px">${esc(s.description)}</p>` : ""}
            </div>
          </div>`).join("")}</div>`
    : "";

  // Email Highlights
  const emails = Array.isArray(brief?.emailHighlights) ? brief.emailHighlights.slice(0, 10) : [];
  const emailsBlock = emails.length
    ? `<h2 style="font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:24px 0 12px">📧 Email Highlights</h2>
       ${emails.map((e: any) => `
          <div style="padding:10px 12px;margin:6px 0;background:#f8fafc;border-left:3px solid #0ea5e9;border-radius:4px">
            <div style="font-weight:600;color:#0f172a;font-size:14px">${esc(e.subject)}</div>
            <div style="color:#64748b;font-size:12px;margin-top:3px">From <strong>${esc(e.from)}</strong> · Action: <span style="color:#0ea5e9;font-weight:600">${esc(e.action)}</span></div>
          </div>`).join("")}`
    : "";

  // Pending Follow-Ups (no reply received)
  const followUpsBlock = pendingFollowUps.length
    ? `<h2 style="font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:24px 0 12px">⏰ Follow-Ups Awaiting Reply</h2>
       ${pendingFollowUps.slice(0, 10).map((f: any) => {
          const overdue = f.due_at && new Date(f.due_at) < new Date();
          const recipients = Array.isArray(f.to_recipients)
            ? f.to_recipients.join(", ")
            : (f.to_recipients || "");
          return `<div style="padding:10px 12px;margin:6px 0;background:${overdue ? "#fef2f2" : "#fffbeb"};border-left:3px solid ${overdue ? "#ef4444" : "#f59e0b"};border-radius:4px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <strong style="color:#0f172a;font-size:14px">${esc(f.subject || "(no subject)")}</strong>
              <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${overdue ? "#b91c1c" : "#b45309"};background:#fff;padding:3px 8px;border-radius:10px">${overdue ? "Overdue" : "Due"}</span>
            </div>
            <div style="color:#64748b;font-size:12px;margin-top:3px">To: ${esc(recipients)} · Sent ${esc(f.sent_at ? new Date(f.sent_at).toLocaleDateString() : "")} · ${esc(f.reminder_count || 0)} reminder(s)</div>
          </div>`;
        }).join("")}`
    : "";

  // To-Do List (combined priorities + email actions)
  const todoItems: string[] = [];
  priorities.forEach((p: any) => todoItems.push(`${esc(p.title)}${p.description ? ` — <span style="color:#64748b">${esc(p.description)}</span>` : ""}`));
  emails.slice(0, 5).forEach((e: any) => todoItems.push(`<strong>${esc(e.action)}:</strong> ${esc(e.subject)} <span style="color:#64748b">(${esc(e.from)})</span>`));
  const todoBlock = todoItems.length
    ? `<h2 style="font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:24px 0 12px">✅ To-Do List</h2>
       <ul style="list-style:none;padding:0;margin:0">
         ${todoItems.map(t => `<li style="padding:8px 12px;margin:4px 0;background:#f8fafc;border-radius:4px;font-size:13px;color:#0f172a">☐ ${t}</li>`).join("")}
       </ul>`
    : "";

  // Suggestions
  const suggestions = Array.isArray(brief?.suggestions) ? brief.suggestions : [];
  const suggestionsBlock = suggestions.length
    ? `<h2 style="font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:24px 0 12px">💡 Suggestions</h2>
       <ul style="color:#475569;font-size:13px;padding-left:20px">${suggestions.map((s: string) => `<li style="margin:4px 0">${esc(s)}</li>`).join("")}</ul>`
    : "";

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
    <h1 style="font-size:24px;margin:0 0 4px;color:#0f172a">${heading}</h1>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 20px">${esc(dateLabel)}</p>
    ${greeting ? `<p style="color:#475569;font-size:15px;margin:0 0 8px">${greeting}</p>` : ""}
    <p style="color:#0f172a;font-size:15px;margin:0 0 8px">${summary}</p>
    ${aiBlock}
    ${prioritiesBlock}
    ${scheduleBlock}
    ${emailsBlock}
    ${followUpsBlock}
    ${todoBlock}
    ${suggestionsBlock}
    <hr style="margin-top:28px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="color:#94a3b8;font-size:12px;margin-top:14px">Sent by InboxIQ Agent · delivered to ${esc(recipient)} · You can print or forward this brief.</p>
  </div>
</body></html>`;
}

async function sendGraphEmail(
  token: string,
  fromUserId: string,
  to: string,
  subject: string,
  html: string
) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${fromUserId}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail failed: ${res.status} ${text}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const reqBody: any = await (async () => { try { return await req.json(); } catch { return {}; } })();

  try {
    // Pull enabled schedules. On a forced/test run, scope to the requesting user
    // so we don't accidentally email everyone.
    let query = supabase
      .from("daily_brief_schedules")
      .select("*")
      .eq("is_enabled", true);
    if (reqBody?.force === true && reqBody?.userId) {
      query = query.eq("user_id", reqBody.userId);
    }
    const { data: schedules, error } = await query as { data: ScheduleRow[] | null; error: unknown };

    if (error) throw error;
    if (!schedules || !schedules.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache per-tz "now" lookups.
    const tzCache = new Map<string, ReturnType<typeof nowParts>>();
    const tokenCache = new Map<string, string>();
    let processed = 0;
    let sent = 0;

    for (const s of schedules) {
      // On forced/test runs, only send the first eligible schedule (one test email).
      if (reqBody?.force === true && sent > 0) break;

      const tz = s.timezone || "America/New_York";
      let nw = tzCache.get(tz);
      if (!nw) {
        nw = nowParts(tz);
        tzCache.set(tz, nw);
      }
      // `force: true` (with optional scheduleId) bypasses time matching for "Send Test Now".
      const forceSend = reqBody?.force === true && (!reqBody?.scheduleId || reqBody.scheduleId === s.id);
      const requestedBriefType = reqBody?.briefType === 'morning' || reqBody?.briefType === 'evening'
        ? reqBody.briefType
        : null;

      if (!forceSend) {
        if (nw.dow !== s.day_of_week) continue;
        const target = (s.send_time || "00:00").slice(0, 5);
        // 5-minute tolerance window: send if NOW is within [target, target+5min].
        // Handles cron jitter / brief saves that just missed the exact minute.
        const [th, tm] = target.split(":").map((n) => parseInt(n, 10));
        const [nh, nm] = nw.hhmm.split(":").map((n) => parseInt(n, 10));
        const targetMins = th * 60 + tm;
        const nowMins = nh * 60 + nm;
        const diff = nowMins - targetMins;
        if (diff < 0 || diff > 5) continue;
      }

      // De-dupe within today (safety net in case cron fires twice). Skipped on forced sends.
      if (!forceSend && s.last_sent_at) {
        const lastDate = new Date(s.last_sent_at);
        const lastLocal = nowParts(tz);
        const lastFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        });
        const lastDateStr = Object.fromEntries(
          lastFmt.formatToParts(lastDate).map((p) => [p.type, p.value])
        );
        const lastDayKey = `${lastDateStr.year}-${lastDateStr.month}-${lastDateStr.day}`;
        if (lastDayKey === lastLocal.date) continue;
      }

      processed++;

      // Resolve recipient + agent mailbox for this org.
      // Fall back to the global default agent_settings row if the org
      // doesn't have its own (central agent@energyforward.com mailbox).
      let { data: agent } = await supabase
        .from("agent_settings")
        .select("shared_mailbox_user_id, shared_mailbox_address, teams_tenant_id, email_agent_enabled")
        .eq("organization_id", s.organization_id)
        .maybeSingle();

      if (!agent || !agent.shared_mailbox_user_id) {
        const { data: fallback } = await supabase
          .from("agent_settings")
          .select("shared_mailbox_user_id, shared_mailbox_address, teams_tenant_id, email_agent_enabled")
          .not("shared_mailbox_user_id", "is", null)
          .eq("email_agent_enabled", true)
          .order("organization_id", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (fallback) agent = fallback;
      }

      const recipient =
        s.recipient_email ||
        (await supabase.from("user_profiles").select("email").eq("user_id", s.user_id).maybeSingle())
          .data?.email;

      if (!recipient) {
        console.warn("No recipient for schedule", s.id);
        continue;
      }

      const tenantId = agent?.teams_tenant_id || MS_TENANT_FALLBACK;
      const fromUserId = agent?.shared_mailbox_user_id || agent?.shared_mailbox_address;
      if (!tenantId || !fromUserId) {
        console.warn(
          "Agent shared mailbox not configured for org",
          s.organization_id
        );
        continue;
      }

      // Generate the brief by calling ai-daily-brief (service-to-service).
      let brief: any = {};
      try {
        const briefRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-daily-brief`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
            "x-internal-user-id": s.user_id,
            "x-internal-connection-id": s.connection_id || "",
          },
          body: JSON.stringify({
            connectionId: s.connection_id,
            internal: true,
            userId: s.user_id,
            briefType: requestedBriefType || s.brief_type,
          }),
        });
        if (briefRes.ok) {
          brief = await briefRes.json();
        } else {
          console.warn("ai-daily-brief returned", briefRes.status);
        }
      } catch (e) {
        console.error("ai-daily-brief call failed", e);
      }

      // Token (cached per tenant).
      let token = tokenCache.get(tenantId);
      if (!token) {
        try {
          token = await getAppToken(tenantId);
          tokenCache.set(tenantId, token);
        } catch (e) {
          console.error("Token fetch failed for tenant", tenantId, e);
          continue;
        }
      }

      const subject =
        (requestedBriefType || s.brief_type) === "morning"
          ? `☀️ Your Morning Brief — ${nw.date}`
          : `🌙 Your End-of-Day Recap — ${nw.date}`;
      const html = renderBriefHtml(brief, requestedBriefType || s.brief_type, recipient);

      try {
        await sendGraphEmail(token, fromUserId, recipient, subject, html);
        sent++;
        await supabase
          .from("daily_brief_schedules")
          .update({ last_sent_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (e) {
        console.error("sendGraphEmail failed", e);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed, sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

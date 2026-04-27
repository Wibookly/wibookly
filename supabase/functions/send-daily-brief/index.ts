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

function renderBriefHtml(brief: any, brief_type: string, recipient: string): string {
  const heading = brief_type === "morning" ? "Your Morning Brief" : "Your End-of-Day Recap";
  const priorities = (brief?.priorities || [])
    .map(
      (p: any) =>
        `<li><strong>${p.title}</strong> <span style="color:#64748b">— ${p.description}</span></li>`
    )
    .join("");
  const schedule = (brief?.schedule || [])
    .map(
      (s: any) =>
        `<li><code>${s.time}</code> &nbsp; <strong>${s.title}</strong>${
          s.description ? ` — <span style="color:#64748b">${s.description}</span>` : ""
        }</li>`
    )
    .join("");
  const emails = (brief?.emailHighlights || [])
    .slice(0, 8)
    .map(
      (e: any) =>
        `<li><strong>${e.subject}</strong> <span style="color:#64748b">— ${e.from} · ${e.action}</span></li>`
    )
    .join("");
  const suggestions = (brief?.suggestions || [])
    .map((s: string) => `<li>${s}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;max-width:680px;margin:0 auto;padding:24px">
  <h1 style="font-size:22px;border-bottom:3px solid #0ea5e9;padding-bottom:10px">${heading}</h1>
  <p style="color:#475569">${brief?.greeting || ""}</p>
  <p>${brief?.summary || ""}</p>
  ${priorities ? `<h2 style="font-size:16px">Priorities</h2><ol>${priorities}</ol>` : ""}
  ${schedule ? `<h2 style="font-size:16px">Schedule</h2><ul style="list-style:none;padding:0">${schedule}</ul>` : ""}
  ${emails ? `<h2 style="font-size:16px">Email Highlights</h2><ul>${emails}</ul>` : ""}
  ${suggestions ? `<h2 style="font-size:16px">Suggestions</h2><ul>${suggestions}</ul>` : ""}
  <hr style="margin-top:24px;border:none;border-top:1px solid #e2e8f0"/>
  <p style="color:#94a3b8;font-size:12px">Sent by InboxIQ Agent · delivered to ${recipient}</p>
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

  try {
    // Pull all enabled schedules (small table; OK to scan).
    const { data: schedules, error } = await supabase
      .from("daily_brief_schedules")
      .select("*")
      .eq("is_enabled", true) as { data: ScheduleRow[] | null; error: unknown };

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
      const tz = s.timezone || "America/New_York";
      let nw = tzCache.get(tz);
      if (!nw) {
        nw = nowParts(tz);
        tzCache.set(tz, nw);
      }
      if (nw.dow !== s.day_of_week) continue;
      const target = (s.send_time || "00:00").slice(0, 5);
      // Match the minute exactly (cron runs every minute).
      if (nw.hhmm !== target) continue;

      // De-dupe within today (safety net in case cron fires twice).
      if (s.last_sent_at) {
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
      const { data: agent } = await supabase
        .from("agent_settings")
        .select("shared_mailbox_user_id, shared_mailbox_address, teams_tenant_id, email_agent_enabled")
        .eq("organization_id", s.organization_id)
        .maybeSingle();

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
            briefType: s.brief_type,
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
        s.brief_type === "morning"
          ? `☀️ Your Morning Brief — ${nw.date}`
          : `🌙 Your End-of-Day Recap — ${nw.date}`;
      const html = renderBriefHtml(brief, s.brief_type, recipient);

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

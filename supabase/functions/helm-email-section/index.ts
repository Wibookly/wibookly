// helm-email-section
// Renders a Helm section (brief, inbox, calendar, big3) to HTML and emails it to
// the user's own connected mailbox via Graph /me/sendMail.
//
// POST { section: "brief" | "inbox" | "calendar" | "big3" | "activity" | "custom",
//        html?: string,   // for "custom" — pre-rendered HTML body
//        text?: string,   // optional plain-text companion
//        title?: string }
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

function fmtDue(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return ""; }
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shell(title: string, inner: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fb;margin:0;padding:24px;color:#0f172a;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#2563eb;font-weight:700;margin-bottom:8px;">The Helm</div>
    <h1 style="font-size:22px;margin:0 0 16px;color:#0f172a;">${esc(title)}</h1>
    ${inner}
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0 16px;"/>
    <p style="font-size:12px;color:#64748b;margin:0;">Sent from The Helm · InboxIQ</p>
  </div>
</body></html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function renderBrief(admin: any, userId: string): Promise<{ title: string; html: string }> {
  const { data: items } = await admin
    .from("helm_items")
    .select("title,context,sender_name,sender_email,due_at,tier,score")
    .eq("user_id", userId).eq("status", "open")
    .order("score", { ascending: false }).limit(60);
  const rows = items ?? [];
  const decisions = rows.filter((r: any) => r.tier === "decision");
  const drafts = rows.filter((r: any) => r.tier === "draft");
  const overdue = rows.filter((r: any) => r.tier === "overdue");
  const big3 = decisions.slice(0, 3);

  const section = (heading: string, items: any[], color: string) => {
    if (!items.length) return "";
    return `<h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:${color};margin:24px 0 10px;">${esc(heading)} · ${items.length}</h2>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
        ${items.map((r) => `<tr><td style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fafbfc;">
          <div style="font-weight:600;color:#0f172a;font-size:14px;">${esc(r.title)}</div>
          ${r.context ? `<div style="font-size:13px;color:#475569;margin-top:4px;">${esc(r.context)}</div>` : ""}
          <div style="font-size:11px;color:#94a3b8;margin-top:6px;">${esc(r.sender_name ?? r.sender_email ?? "")}${r.due_at ? " · due " + esc(fmtDue(r.due_at)) : ""}</div>
        </td></tr><tr><td style="height:8px;"></td></tr>`).join("")}
      </table>`;
  };

  const stats = `<div style="display:flex;gap:24px;background:linear-gradient(135deg,#eff6ff,#fff);border-radius:10px;padding:18px;margin-bottom:12px;">
    <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Inbound</div><div style="font-size:28px;font-weight:700;">${rows.length}</div></div>
    <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Needs you</div><div style="font-size:28px;font-weight:700;color:#2563eb;">${big3.length + decisions.length + overdue.length}</div></div>
    <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Drafted</div><div style="font-size:28px;font-weight:700;">${drafts.length}</div></div>
  </div>`;

  return {
    title: "Your Helm brief",
    html: stats + section("Today's Big 3", big3, "#2563eb") +
      section("Decisions", decisions.slice(big3.length), "#0f172a") +
      section("Overdue", overdue, "#dc2626") +
      section("Drafted for you", drafts, "#0891b2"),
  };
}

async function renderInbox(admin: any, userId: string) {
  const { data } = await admin
    .from("helm_items").select("title,context,sender_name,sender_email,ai_draft")
    .eq("user_id", userId).eq("tier", "draft").eq("status", "open").limit(50);
  const items = data ?? [];
  const inner = items.length === 0
    ? `<p style="color:#64748b;">No drafts waiting.</p>`
    : items.map((r: any) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="font-weight:600;">${esc(r.title)}</div>
        <div style="font-size:12px;color:#64748b;margin:4px 0 8px;">${esc(r.sender_name ?? r.sender_email ?? "")}</div>
        ${r.ai_draft ? `<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:#334155;background:#f8fafc;padding:10px;border-radius:6px;margin:0;">${esc(r.ai_draft)}</pre>` : `<div style="color:#94a3b8;font-size:12px;">Draft not yet generated.</div>`}
      </div>`).join("");
  return { title: "Focused inbox — drafts ready", html: inner };
}

async function renderActivity(admin: any, userId: string) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await admin
    .from("activity_log").select("action_type,detail,created_at")
    .eq("user_id", userId).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(80);
  const items = data ?? [];
  const inner = items.length === 0
    ? `<p style="color:#64748b;">Nothing automatic in the last 24h.</p>`
    : `<table width="100%" style="border-collapse:collapse;">${items.map((r: any) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;">${esc(r.detail ?? r.action_type)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:11px;color:#94a3b8;text-align:right;white-space:nowrap;">${esc(new Date(r.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}))}</td>
      </tr>`).join("")}</table>`;
  return { title: "Done automatically — last 24h", html: inner };
}

async function renderBig3(admin: any, userId: string) {
  const { data } = await admin
    .from("helm_big3").select("ordinal,title,meta,detail_json,done")
    .eq("user_id", userId).order("ordinal");
  const items = data ?? [];
  const inner = items.length === 0
    ? `<p style="color:#64748b;">No Big 3 set for today. Open The Helm to set them.</p>`
    : items.map((r: any) => `<div style="border-left:4px solid #2563eb;background:#f8fafc;padding:12px 14px;margin-bottom:10px;border-radius:6px;">
        <div style="font-weight:700;color:#0f172a;">${esc(r.ordinal)}. ${esc(r.title)}${r.done ? " ✓" : ""}</div>
        ${r.meta ? `<div style="font-size:13px;color:#475569;margin-top:4px;">${esc(r.meta)}</div>` : ""}
      </div>`).join("");
  return { title: "Today's Big 3", html: inner };
}

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

  const payload = (await req.json().catch(() => ({}))) as {
    section?: string; html?: string; text?: string; title?: string;
  };
  const section = payload.section ?? "brief";

  // Find the connected outlook mailbox (recipient = self)
  const { data: conn } = await admin
    .from("provider_connections")
    .select("id, connected_email")
    .eq("user_id", userId).eq("provider", "outlook").eq("is_connected", true)
    .order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.id) return json(400, { error: "no_outlook_connection" });
  const { data: prof } = await admin.from("user_profiles")
    .select("organization_id,email").eq("user_id", userId).maybeSingle();
  const recipient = conn.connected_email || prof?.email;
  if (!recipient) return json(400, { error: "no_recipient_address" });

  let title = payload.title || "Your Helm";
  let body = "";
  if (section === "custom") {
    body = payload.html ?? "";
    title = payload.title || "From The Helm";
  } else if (section === "brief") {
    const r = await renderBrief(admin, userId); title = r.title; body = r.html;
  } else if (section === "inbox") {
    const r = await renderInbox(admin, userId); title = r.title; body = r.html;
  } else if (section === "activity") {
    const r = await renderActivity(admin, userId); title = r.title; body = r.html;
  } else if (section === "big3") {
    const r = await renderBig3(admin, userId); title = r.title; body = r.html;
  } else {
    return json(400, { error: "unknown_section" });
  }

  if (!body || !body.trim()) body = "<p>(empty)</p>";
  const html = shell(title, body);
  const text = payload.text || htmlToText(html);

  const subject = `[Helm] ${title}`;
  const sendBody = {
    message: {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: recipient } }],
    },
    saveToSentItems: false,
  };

  const r = await callGraph(userId, conn.id, "mail", "/me/sendMail", {
    method: "POST",
    body: JSON.stringify(sendBody),
  });
  if (!r.ok) return json(r.status || 502, { error: "send_failed", details: r.error });

  await admin.from("activity_log").insert({
    user_id: userId,
    organization_id: prof?.organization_id,
    action_type: "section_emailed",
    detail: `Emailed "${title}" to ${recipient}`,
    action_key: `email_section:${section}:${Date.now()}`,
  });

  // Tell caller plaintext length so callers can confirm non-empty body
  return json(200, { ok: true, section, recipient, text_length: text.length });
});

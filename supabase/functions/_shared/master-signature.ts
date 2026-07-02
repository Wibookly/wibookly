// Master signature builder — single source of truth for AI-sent emails.
// Reads from `email_profiles` (the table the /settings Signature Preview
// writes to). When `signature_enabled === false` returns a bare
// "Best regards,\n{name}" — no phone / email / logo.
//
// Exposes both a rich HTML block (for send-time) and a plain-text block
// (for in-editor drafts).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface MasterSignature {
  html: string;
  text: string;
  enabled: boolean;
  displayName: string;
}

function esc(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtml(p: any, userEmail: string): string {
  const name = p.full_name || "";
  const title = p.title || "";
  const phone = p.phone || "";
  const mobile = p.mobile || "";
  const website = p.website || "";
  const logo = p.signature_logo_url || "";
  const photo = p.show_profile_photo ? (p.profile_photo_url || "") : "";
  const showLogo = p.show_company_logo !== false ? logo : "";
  const media = photo || showLogo;
  const font = p.signature_font || "Arial, sans-serif";
  const color = p.signature_color || "#333333";
  const rows: string[] = [];
  if (phone) rows.push(`<tr><td style="padding:2px 0;font-size:13px;">📞</td><td style="padding:2px 0 2px 8px;font-size:13px;">Main: ${esc(phone)}</td></tr>`);
  if (mobile) rows.push(`<tr><td style="padding:2px 0;font-size:13px;">📱</td><td style="padding:2px 0 2px 8px;font-size:13px;">Mobile: ${esc(mobile)}</td></tr>`);
  if (website) {
    const clean = website.replace(/^https?:\/\//, "");
    rows.push(`<tr><td style="padding:2px 0;font-size:13px;">🌐</td><td style="padding:2px 0 2px 8px;font-size:13px;"><a href="${esc(website)}" style="color:${color};text-decoration:none;">${esc(clean)}</a></td></tr>`);
  }
  if (userEmail) {
    rows.push(`<tr><td style="padding:2px 0;font-size:13px;">✉️</td><td style="padding:2px 0 2px 8px;font-size:13px;"><a href="mailto:${esc(userEmail)}" style="color:${color};text-decoration:none;">${esc(userEmail)}</a></td></tr>`);
  }
  return `<div style="font-family:${font};font-size:14px;color:${color};">
  <p style="margin:0 0 12px 0;">Best regards,</p>
  <table cellpadding="0" cellspacing="0" border="0" style="font-family:${font};font-size:14px;color:${color};">
    <tr>
      ${media ? `<td style="vertical-align:top;padding-right:16px;border-right:2px solid #e5e5e5;"><img src="${esc(media)}" alt="" style="max-height:80px;max-width:120px;"/></td>` : ""}
      <td style="vertical-align:top;${media ? "padding-left:16px;" : ""}">
        ${name ? `<div style="font-size:16px;font-weight:bold;color:${color};margin-bottom:2px;">${esc(name)}</div>` : ""}
        ${title ? `<div style="font-size:14px;color:#2563eb;margin-bottom:8px;">${esc(title)}</div>` : ""}
        <table cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>
      </td>
    </tr>
  </table>
</div>`;
}

function htmlToPlain(html: string): string {
  return String(html)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPlain(p: any, userEmail: string, displayName: string): string {
  const lines: string[] = ["Best regards,", p.full_name || displayName];
  if (p.title) lines.push(String(p.title));
  const phones: string[] = [];
  if (p.phone) phones.push(`Main: ${p.phone}`);
  if (p.mobile) phones.push(`Mobile: ${p.mobile}`);
  if (phones.length) lines.push(phones.join(" · "));
  if (userEmail) lines.push(userEmail);
  if (p.website) lines.push(String(p.website));
  return lines.filter(Boolean).join("\n");
}

/**
 * Load the master signature for a user. If `connectionId` is provided we
 * scope to that connection's email_profile; otherwise we pick the most
 * recent connected outlook profile.
 *
 * Rule set (matches Settings UI):
 *   - signature_enabled === false → "Best regards,\n{name}" only
 *   - email_signature (custom HTML) set → use it verbatim
 *   - else build from structured fields (name/title/phone/mobile/email/website/logo)
 */
export async function loadMasterSignature(
  userId: string,
  opts?: { connectionId?: string | null; fallbackName?: string; fallbackEmail?: string },
): Promise<MasterSignature> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const fallbackName = opts?.fallbackName || "";
  const fallbackEmail = opts?.fallbackEmail || "";

  // Resolve connection + email
  let connectionId = opts?.connectionId || null;
  let userEmail = fallbackEmail;
  if (!connectionId) {
    const { data: c } = await admin
      .from("provider_connections")
      .select("id, connected_email")
      .eq("user_id", userId)
      .eq("is_connected", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    connectionId = c?.id ?? null;
    if (c?.connected_email) userEmail = c.connected_email;
  } else {
    const { data: c } = await admin
      .from("provider_connections")
      .select("connected_email")
      .eq("id", connectionId)
      .maybeSingle();
    if (c?.connected_email) userEmail = c.connected_email;
  }

  let profile: any = null;
  if (connectionId) {
    const { data } = await admin
      .from("email_profiles")
      .select("*")
      .eq("connection_id", connectionId)
      .maybeSingle();
    profile = data;
  }
  const displayName = profile?.full_name || fallbackName || (userEmail ? userEmail.split("@")[0] : "");
  const enabled = profile?.signature_enabled !== false; // default ON

  if (!enabled) {
    const text = `Best regards,\n${displayName}`.trim();
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;"><p style="margin:0 0 4px 0;">Best regards,</p><p style="margin:0;">${esc(displayName)}</p></div>`;
    return { html, text, enabled: false, displayName };
  }

  // Custom HTML wins
  const custom = String(profile?.email_signature ?? "").trim();
  if (custom) {
    const looksHtml = /<[a-z][\s\S]*>/i.test(custom);
    const html = looksHtml ? custom : buildHtml(profile, userEmail);
    const text = htmlToPlain(html);
    return { html, text, enabled: true, displayName };
  }

  if (!profile) {
    const text = `Best regards,\n${displayName}`.trim();
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;"><p style="margin:0 0 4px 0;">Best regards,</p><p style="margin:0;">${esc(displayName)}</p></div>`;
    return { html, text, enabled: true, displayName };
  }

  const html = buildHtml(profile, userEmail);
  const text = buildPlain(profile, userEmail, displayName);
  return { html, text, enabled: true, displayName };
}

/**
 * Strip a trailing plain-text signature (starting at "Best regards," /
 * "Best,") from a body so we can replace it with the master signature
 * without duplication.
 */
export function stripTrailingSignature(body: string): string {
  if (!body) return "";
  const marker = body.search(/\n\s*(Best regards,|Best,|Thanks,|Thank you,|Regards,|Sincerely,|Kind regards,|Warm regards,)/i);
  if (marker === -1) return body.trimEnd();
  return body.slice(0, marker).trimEnd();
}

// Push a user-reviewed draft (subject/body/to/cc) into Gmail or Outlook drafts.
// Never auto-sends — always creates a draft for the user to review and send manually.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getValidAccessToken } from "../_shared/oauth-tokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface Body {
  connection_id: string;
  subject: string;
  body: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  is_html?: boolean;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtml(text: string) {
  return `<div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

async function createGmailDraft(
  token: string,
  args: { to: string[]; cc: string[]; bcc: string[]; subject: string; html: string },
): Promise<{ id: string; messageId: string | null }> {
  const headers = [
    args.to.length ? `To: ${args.to.join(", ")}` : null,
    args.cc.length ? `Cc: ${args.cc.join(", ")}` : null,
    args.bcc.length ? `Bcc: ${args.bcc.join(", ")}` : null,
    `Subject: ${args.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    args.html,
  ].filter(Boolean).join("\r\n");

  const raw = btoa(unescape(encodeURIComponent(headers)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw } }),
    },
  );
  if (!res.ok) throw new Error(`Gmail draft failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { id: j.id, messageId: j.message?.id ?? null };
}

async function createOutlookDraft(
  token: string,
  args: { to: string[]; cc: string[]; bcc: string[]; subject: string; html: string },
): Promise<{ id: string; webLink: string | null }> {
  const recipients = (list: string[]) =>
    list.map((address) => ({ emailAddress: { address } }));
  const res = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject: args.subject,
      body: { contentType: "HTML", content: args.html },
      toRecipients: recipients(args.to),
      ccRecipients: recipients(args.cc),
      bccRecipients: recipients(args.bcc),
      isDraft: true,
    }),
  });
  if (!res.ok) throw new Error(`Outlook draft failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { id: j.id, webLink: j.webLink ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = (await req.json()) as Body;
    if (!body?.connection_id || !body?.subject || !body?.body) {
      return new Response(
        JSON.stringify({ error: "connection_id, subject, body required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: connection, error: connErr } = await admin
      .from("provider_connections")
      .select("id, user_id, provider")
      .eq("id", body.connection_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "Connection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getValidAccessToken(admin, user.id, connection.provider);
    if (!token) {
      return new Response(
        JSON.stringify({ error: "reauth_required", provider: connection.provider }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const html = body.is_html ? body.body : textToHtml(body.body);
    const args = {
      to: body.to ?? [],
      cc: body.cc ?? [],
      bcc: body.bcc ?? [],
      subject: body.subject,
      html,
    };

    let result: Record<string, unknown>;
    if (connection.provider === "google") {
      result = await createGmailDraft(token, args);
    } else if (connection.provider === "microsoft") {
      result = await createOutlookDraft(token, args);
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${connection.provider}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, provider: connection.provider, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("push-draft-to-provider error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

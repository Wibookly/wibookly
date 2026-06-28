// helm-draft-reply
// Generates (or reshapes) the AI reply for a draft-tier helm_items row.
// POST { item_id, instruction?, base_draft? }
//  - No instruction & no base_draft: initial draft from thread context.
//  - With instruction: reshape (chip or free-text) the provided base_draft.
// Always persists the new text to helm_items.ai_draft.
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

async function callLLM(
  userId: string,
  system: string,
  user: string,
): Promise<string> {
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
      max_tokens: 700,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`llm_failed:${resp.status}:${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text =
    data?.choices?.[0]?.message?.content ??
    data?.content?.[0]?.text ??
    data?.text ??
    "";
  return String(text).trim();
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
  const userEmail = (u.user.email ?? "").toLowerCase();
  const userName =
    (u.user.user_metadata?.full_name as string | undefined) ??
    userEmail.split("@")[0] ??
    "";

  const body = (await req.json().catch(() => ({}))) as {
    item_id?: string;
    instruction?: string;
    base_draft?: string;
  };
  if (!body.item_id) return json(400, { error: "item_id_required" });

  const { data: item } = await admin
    .from("helm_items")
    .select(
      "id, user_id, graph_id, subject:title, sender_name, sender_email, context, ai_draft, payload, status",
    )
    .eq("id", body.item_id)
    .maybeSingle();
  if (!item || item.user_id !== userId) return json(404, { error: "item_not_found" });
  if (item.status === "sent") {
    return json(200, { ok: true, draft: item.ai_draft ?? "", already_sent: true });
  }

  // Pull writing-style preference + signature fields (best-effort)
  const { data: prof } = await admin
    .from("user_ai_profiles")
    .select(
      "communication_style, custom_context, role, full_name, title, email_signature, phone, mobile, website, company",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const tone = prof?.communication_style ?? "professional, concise, warm";
  const styleNotes = prof?.custom_context ?? "";
  const roleNote = prof?.role ? ` Role: ${prof.role}.` : "";

  // Build a plain-text signature block.
  // Prefer the user's saved email_signature; otherwise compose Best,\n<name>\n<title>\n<company>\n<phone>.
  const displayName =
    (prof?.full_name as string | undefined) ??
    (u.user.user_metadata?.full_name as string | undefined) ??
    userName;
  let signatureBlock: string;
  if (prof?.email_signature && String(prof.email_signature).trim()) {
    // Strip HTML to plain text for the textarea draft.
    signatureBlock = String(prof.email_signature)
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    const lines: string[] = ["Best,", displayName];
    if (prof?.title) lines.push(String(prof.title));
    if (prof?.company) lines.push(String(prof.company));
    if (prof?.phone) lines.push(String(prof.phone));
    else if (prof?.mobile) lines.push(String(prof.mobile));
    if (prof?.website) lines.push(String(prof.website));
    signatureBlock = lines.join("\n");
  }

  // Fetch the original body for context (only when we don't have it cached)
  let originalText = (item.payload?.bodyPreview as string | undefined) ?? "";
  if (originalText.length < 200 && item.graph_id) {
    const { data: conn } = await admin
      .from("provider_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "outlook")
      .eq("is_connected", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conn?.id) {
      const g = await callGraph<any>(
        userId,
        conn.id,
        "mail",
        `/me/messages/${encodeURIComponent(item.graph_id)}?$select=body,bodyPreview`,
      );
      if (g.ok) {
        const bb = g.data?.body?.content ?? g.data?.bodyPreview ?? "";
        originalText = String(bb).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
  }

  const senderFirst = (item.sender_name ?? item.sender_email ?? "there").split(
    /[\s,@]/,
  )[0];
  const greeting = `Hi ${senderFirst},`;

  // Strip greeting + signature out of base_draft so the LLM only reshapes the middle.
  function stripFrame(text: string): string {
    let t = text;
    if (signatureBlock) {
      const idx = t.lastIndexOf(signatureBlock);
      if (idx >= 0) t = t.slice(0, idx).trimEnd();
    }
    // Drop leading "Hi <name>," greeting if present
    t = t.replace(/^\s*(hi|hello|hey|dear)\s+[^\n,]{1,40},?\s*\n+/i, "");
    return t.trim();
  }

  let draftMiddle = "";
  try {
    if (body.instruction && body.base_draft) {
      const sys =
        `You revise email replies. Apply the user's instruction to the CURRENT DRAFT. ` +
        `Preserve meaning and any names. Output ONLY the new reply body — no greeting line, no subject line, no preamble, no quotes, no signature.`;
      const usr =
        `INSTRUCTION:\n${body.instruction}\n\nCURRENT DRAFT:\n${stripFrame(body.base_draft)}`;
      draftMiddle = await callLLM(userId, sys, usr);
    } else {
      const sys =
        `You write executive email replies for ${displayName} <${userEmail}>. ` +
        `Tone: ${tone}.${roleNote} ${styleNotes ? "Style: " + styleNotes + "." : ""} ` +
        `Reply directly to the sender's ask. Keep it tight (3-7 short sentences unless the ask demands detail). ` +
        `Do not include a subject line, greeting line, or sign-off — those are added separately. ` +
        `Output ONLY the reply body paragraphs.`;
      const usr =
        `From: ${item.sender_name ?? ""} <${item.sender_email ?? ""}>\n` +
        `Subject: ${item.subject ?? ""}\n` +
        `Triage note: ${item.context ?? ""}\n\n` +
        `Original message:\n${originalText.slice(0, 4000)}\n\n` +
        `Write a reply addressed to ${senderFirst}.`;
      draftMiddle = await callLLM(userId, sys, usr);
    }
  } catch (e: any) {
    return json(502, { error: "llm_failed", message: String(e?.message ?? e) });
  }

  draftMiddle = draftMiddle.replace(/^["']|["']$/g, "").trim();

  const fullBody = `${greeting}\n\n${draftMiddle}\n\n${signatureBlock}`;

  await admin
    .from("helm_items")
    .update({ ai_draft: fullBody, updated_at: new Date().toISOString() })
    .eq("id", item.id);

  return json(200, { ok: true, draft: fullBody });
});

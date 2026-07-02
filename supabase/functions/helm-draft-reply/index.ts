// helm-draft-reply
// Generates (or reshapes) the AI reply for a draft-tier helm_items row.
// POST { item_id, instruction?, base_draft? }
//  - No instruction & no base_draft: initial draft from thread context.
//  - With instruction: reshape (chip or free-text) the provided base_draft.
// Always persists the new text to helm_items.ai_draft.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";
import { loadMasterSignature } from "../_shared/master-signature.ts";

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

  // Pull writing-style preference + signature fields (best-effort).
  // `signature_enabled` is the user's master switch in /settings.
  const { data: prof } = await admin
    .from("user_ai_profiles")
    .select(
      "communication_style, custom_context, role, full_name, title, email_signature, phone, mobile, website, company, signature_enabled",
    )
    .eq("user_id", userId)
    .maybeSingle();
  // Fallback name sources when user_ai_profiles.full_name is empty.
  const prof2: any = await admin
    .from("profiles")
    .select("full_name, first_name, last_name")
    .eq("id", userId)
    .maybeSingle()
    .then((r) => r.data, () => null);
  const prof3: any = await admin
    .from("user_profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle()
    .then((r) => r.data, () => null);
  const tone = prof?.communication_style ?? "professional, concise, warm";
  const styleNotes = prof?.custom_context ?? "";
  const roleNote = prof?.role ? ` Role: ${prof.role}.` : "";

  const composedFromParts = prof2?.first_name
    ? `${prof2.first_name}${prof2.last_name ? " " + prof2.last_name : ""}`
    : "";
  const displayName =
    (prof?.full_name as string | undefined) ||
    (prof2?.full_name as string | undefined) ||
    (prof3?.full_name as string | undefined) ||
    composedFromParts ||
    (u.user.user_metadata?.full_name as string | undefined) ||
    userName;

  // Build a plain-text signature block.
  // 1) signature_enabled === false  -> no signature
  // 2) signature_enabled !== false AND email_signature set -> use the saved one (stripped to text)
  // 3) otherwise compose a rich block from profile fields (name / title / company / phone / mobile / website / email)
  const sigOn = prof?.signature_enabled !== false; // default ON unless explicitly disabled
  let signatureBlock = "";
  if (sigOn) {
    if (prof?.email_signature && String(prof.email_signature).trim()) {
      signatureBlock = String(prof.email_signature)
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/(p|div|li|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } else {
      const lines: string[] = ["Best regards,", displayName];
      if (prof?.title) lines.push(String(prof.title));
      if (prof?.company) lines.push(String(prof.company));
      const phones: string[] = [];
      if (prof?.phone) phones.push(`Main: ${prof.phone}`);
      if (prof?.mobile) phones.push(`Mobile: ${prof.mobile}`);
      if (phones.length) lines.push(phones.join(" · "));
      if (userEmail) lines.push(userEmail);
      if (prof?.website) lines.push(String(prof.website));
      signatureBlock = lines.join("\n");
    }
  }

  // ----- Pull full Outlook thread so the LLM has real context -----
  // We fetch (a) the active message body, then (b) up to 5 most-recent
  // messages on the same conversationId — newest first — and stitch them
  // into a single transcript. If anything fails we still fall back to the
  // cached bodyPreview so a draft always renders.
  let originalText = (item.payload?.bodyPreview as string | undefined) ?? "";
  let threadTranscript = "";
  if (item.graph_id) {
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
      // (a) full body of the active message
      const g = await callGraph<any>(
        userId,
        conn.id,
        "mail",
        `/me/messages/${encodeURIComponent(item.graph_id)}?$select=body,bodyPreview,conversationId,from,subject,receivedDateTime`,
      );
      let conversationId: string | undefined;
      if (g.ok) {
        const bb = g.data?.body?.content ?? g.data?.bodyPreview ?? "";
        const plain = String(bb).replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (plain.length > originalText.length) originalText = plain;
        conversationId = g.data?.conversationId;
      }
      // (b) sibling messages in the same conversation, newest first
      if (conversationId) {
        const filter = encodeURIComponent(`conversationId eq '${conversationId}'`);
        const sel = encodeURIComponent("from,subject,receivedDateTime,bodyPreview,body");
        const t = await callGraph<any>(
          userId, conn.id, "mail",
          `/me/messages?$filter=${filter}&$top=5&$orderby=receivedDateTime desc&$select=${sel}`,
        );
        if (t.ok && Array.isArray(t.data?.value)) {
          const msgs = (t.data.value as any[]).slice(0, 5).reverse();
          threadTranscript = msgs.map((m) => {
            const who = m?.from?.emailAddress?.address ?? "unknown";
            const when = m?.receivedDateTime ?? "";
            const bb = m?.body?.content ?? m?.bodyPreview ?? "";
            const plain = String(bb).replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            return `[${when}] ${who}:\n${plain.slice(0, 1500)}`;
          }).join("\n\n---\n\n");
        }
      }
    }
  }
  if (!threadTranscript) threadTranscript = originalText;

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

  // Per-chip directives so tone reshapes produce a visibly different draft.
  function toneDirective(instr: string): string {
    const k = instr.trim().toLowerCase();
    if (k === "shorter") return "Cut the draft to AT MOST 2 short sentences. Remove every non-essential clause, hedging word, and adjective. The new draft MUST be visibly shorter than the current draft.";
    if (k === "more formal") return "Rewrite in a formal, executive register. Use complete sentences, no contractions, no exclamation marks, no casual phrases ('thanks!', 'happy to', 'cool'). Open with a direct statement of intent. The new draft MUST sound noticeably more formal than the current draft.";
    if (k === "warmer") return "Rewrite with a warmer, more personable tone. Add a brief human acknowledgement (one sentence), keep professionalism, prefer 'happy to', 'glad to', 'appreciate'. The new draft MUST feel noticeably warmer than the current draft.";
    if (k === "more firm") return "Rewrite with a firm, decisive executive tone. State the position or decision in the first sentence with no hedging. Remove 'maybe', 'I think', 'perhaps', 'just', 'sort of'. Use direct verbs.";
    if (k === "bullet points") return "Restructure the reply as 3–5 concise bullet points using '-' markers, preceded by ONE short lead-in sentence. Each bullet ≤ 12 words. Do NOT return a paragraph.";
    return `Apply this instruction precisely: ${instr}`;
  }

  async function tryDraft(): Promise<string> {
    if (body.instruction) {
      const directive = toneDirective(body.instruction);
      const sys =
        `You revise email replies. You MUST produce a draft that is materially different from the current one when an instruction is given — never echo it back. ` +
        `Preserve meaning, facts, names, dates and numbers from the current draft. ` +
        `Output ONLY the new reply body — no greeting line, no subject line, no preamble, no quotes, no signature, no commentary.`;
      const usr =
        `INSTRUCTION (must be applied): ${directive}\n\n` +
        `CURRENT DRAFT (rewrite this):\n${stripFrame(body.base_draft ?? "")}\n\n` +
        (threadTranscript ? `THREAD CONTEXT (for reference only, do not quote):\n${threadTranscript.slice(0, 5000)}` : "");
      return await callLLM(userId, sys, usr);
    }
    const sys =
      `You are writing an email reply on behalf of ${displayName} <${userEmail}>. ` +
      `Tone: ${tone}.${roleNote} ${styleNotes ? "Style: " + styleNotes + "." : ""} ` +
      `READ THE FULL THREAD BELOW and respond directly to the sender's most-recent ask. ` +
      `Reference concrete details from the thread (dates, names, numbers, decisions) — do not write a generic acknowledgement. ` +
      `Keep it tight (3-7 short sentences unless the ask demands detail). ` +
      `Do NOT include a subject line, greeting line, or sign-off — those are added separately. ` +
      `Output ONLY the reply body paragraphs.`;
    const usr =
      `Subject: ${item.subject ?? ""}\n` +
      `Reply addressed to: ${item.sender_name ?? ""} <${item.sender_email ?? ""}>\n` +
      (item.context ? `Triage note: ${item.context}\n` : "") +
      `\nTHREAD (oldest → newest):\n${(threadTranscript || originalText).slice(0, 6000)}\n\n` +
      `Write ${senderFirst}'s reply now.`;
    return await callLLM(userId, sys, usr);
  }

  let draftMiddle = "";
  try {
    draftMiddle = await tryDraft();
    if (!draftMiddle || draftMiddle.length < 20) {
      // Retry once with a stronger nudge — happens when the model returns empty
      console.log("helm-draft-reply: empty draft, retrying");
      draftMiddle = await callLLM(
        userId,
        `Write a 3-5 sentence email reply in ${displayName}'s voice. No greeting, no sign-off. Reference details from the thread.`,
        `Reply to ${senderFirst} about "${item.subject ?? ""}".\n\nThread:\n${(threadTranscript || originalText).slice(0, 5000)}`,
      );
    }
  } catch (e: any) {
    return json(502, { error: "llm_failed", message: String(e?.message ?? e) });
  }

  draftMiddle = (draftMiddle || "").replace(/^["']|["']$/g, "").trim();
  if (!draftMiddle) {
    draftMiddle = "Thanks for the note — I'll review the thread and follow up shortly.";
  }

  const fullBody = signatureBlock
    ? `${greeting}\n\n${draftMiddle}\n\n${signatureBlock}`
    : `${greeting}\n\n${draftMiddle}`;



  await admin
    .from("helm_items")
    .update({ ai_draft: fullBody, updated_at: new Date().toISOString() })
    .eq("id", item.id);

  return json(200, { ok: true, draft: fullBody });
});

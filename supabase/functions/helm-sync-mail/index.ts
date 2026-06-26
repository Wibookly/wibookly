// helm-sync-mail
// Pulls the user's Outlook inbox via Microsoft Graph, scores each message,
// classifies it into a tier, writes to helm_items, and logs auto-filed
// messages to activity_log. Supports incremental sync via /messages/delta.
//
// Auth: requires a verified user JWT. Uses our existing per-user/per-connection
// access token via callGraph (handles refresh + health logging).
//
// POST body (optional): { connection_id?: string, force_full?: boolean, max_pages?: number }
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

/* ----------------------- helpers ----------------------- */

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  flag?: { flagStatus?: string; dueDateTime?: { dateTime?: string } };
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  "@removed"?: unknown;
};

const NEWSLETTER_SENDER_RX =
  /(no-?reply|do-?not-?reply|notifications?@|newsletter|mailer|updates@|info@|noreply@|marketing@|news@)/i;

const ASK_RX =
  /\?|\b(can you|could you|please|kindly|approve|need your|by (mon|tue|wed|thu|fri|sat|sun|tomorrow|today|eod|cob)|let me know|sign[- ]?off|review and|action required)\b/i;

const URGENCY_RX =
  /\b(urgent|asap|today|tomorrow|eod|cob|by end of (day|week)|deadline|due|by \d{1,2}(:\d{2})?\s?(am|pm)?|by (mon|tue|wed|thu|fri))\b/i;

function getHeader(msg: GraphMessage, name: string): string | null {
  const h = msg.internetMessageHeaders?.find(
    (x) => x.name?.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? null;
}

function isAutomated(msg: GraphMessage, senderAddr: string): boolean {
  if (getHeader(msg, "List-Unsubscribe")) return true;
  if (getHeader(msg, "Auto-Submitted")) return true;
  if (senderAddr && NEWSLETTER_SENDER_RX.test(senderAddr)) return true;
  return false;
}

function scoreMessage(
  msg: GraphMessage,
  ctx: {
    userEmail: string;
    vipSet: Set<string>;
    awaitingReplyConvs: Set<string>;
  },
): { score: number; isDirect: boolean; isCcOnly: boolean; automated: boolean } {
  const me = ctx.userEmail.toLowerCase();
  const to = (msg.toRecipients ?? []).map((r) =>
    (r.emailAddress?.address ?? "").toLowerCase(),
  );
  const cc = (msg.ccRecipients ?? []).map((r) =>
    (r.emailAddress?.address ?? "").toLowerCase(),
  );
  const fromAddr = (msg.from?.emailAddress?.address ?? "").toLowerCase();
  const body = `${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`;

  const isDirect = to.includes(me);
  const isCcOnly = !isDirect && cc.includes(me);
  const onlyRequired = isDirect && to.length === 1;
  const automated = isAutomated(msg, fromAddr);

  let score = 0;
  if (isDirect) score += 30;
  if (onlyRequired) score += 20;
  if (fromAddr && ctx.vipSet.has(fromAddr)) score += 20;
  if (ASK_RX.test(body)) score += 15;
  if (URGENCY_RX.test(body) || msg.importance === "high") score += 15;
  if (msg.conversationId && ctx.awaitingReplyConvs.has(msg.conversationId)) {
    score += 10;
  }
  if (automated || (isCcOnly && !ASK_RX.test(body))) score -= 40;

  return { score, isDirect, isCcOnly, automated };
}

function tierFor(
  score: number,
  awaitingOwnReply: boolean,
): "decision" | "draft" | "overdue" | "auto" {
  if (awaitingOwnReply) return "overdue";
  if (score >= 60) return "decision";
  if (score >= 35) return "draft";
  return "auto";
}

async function generateContext(
  authHeader: string,
  userId: string,
  msg: GraphMessage,
  tier: string,
): Promise<string> {
  // Skip LLM for auto-filed items — they never surface.
  if (tier === "auto") return "";
  try {
    const body = {
      model: "openai/gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You write one-sentence triage notes for an executive's inbox. Output ONLY the sentence — no preamble, no quotes, max 20 words. Explain why this email matters to them right now.",
        },
        {
          role: "user",
          content: `From: ${msg.from?.emailAddress?.name ?? ""} <${msg.from?.emailAddress?.address ?? ""}>
Subject: ${msg.subject ?? ""}
Preview: ${(msg.bodyPreview ?? "").slice(0, 600)}
Tier: ${tier}`,
        },
      ],
      max_tokens: 80,
    };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "x-internal-user-id": userId,
    };
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/llm-gateway`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    const text =
      data?.choices?.[0]?.message?.content ??
      data?.content?.[0]?.text ??
      data?.text ??
      "";
    return String(text).trim().replace(/^["']|["']$/g, "").slice(0, 240);
  } catch {
    return "";
  }
}

/* ----------------------- handler ----------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "missing_jwt" });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "invalid_jwt" });
  const userId = userData.user.id;
  const userEmail = (userData.user.email ?? "").toLowerCase();

  let body: any = {};
  try {
    body = await req.json();
  } catch { /* allow empty */ }
  const forceFull = body?.force_full === true;
  const maxPages = Math.min(Math.max(Number(body?.max_pages ?? 5), 1), 20);

  // Resolve connection
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

  // Load VIP set
  const { data: vipsRows } = await supabase
    .from("helm_vips")
    .select("email")
    .eq("user_id", userId);
  const vipSet = new Set<string>(
    (vipsRows ?? []).map((r: any) => String(r.email).toLowerCase()),
  );

  // Load delta link
  const { data: syncState } = await supabase
    .from("helm_mail_sync_state")
    .select("delta_link")
    .eq("connection_id", connectionId!)
    .maybeSingle();

  const selectFields =
    "id,conversationId,from,toRecipients,ccRecipients,subject,bodyPreview,receivedDateTime,flag,isRead,importance,internetMessageHeaders";

  let nextEndpoint: string | null;
  const useDelta = !forceFull && syncState?.delta_link;
  if (useDelta) {
    // Stored deltaLink already contains full URL incl. token. callGraph expects path-only,
    // but delta links return absolute URL — strip prefix.
    nextEndpoint = String(syncState!.delta_link).replace(
      /^https:\/\/graph\.microsoft\.com\/v1\.0/,
      "",
    );
  } else {
    nextEndpoint = `/me/mailFolders/inbox/messages/delta?$select=${selectFields}&$top=50`;
  }

  // Fetch all pages
  const collected: GraphMessage[] = [];
  let nextDeltaLink: string | null = null;
  let pages = 0;
  while (nextEndpoint && pages < maxPages) {
    pages++;
    const res = await callGraph<any>(userId, connectionId!, "mail", nextEndpoint);
    if (!res.ok) {
      return json(res.status || 502, {
        error: "graph_failed",
        details: res.error,
      });
    }
    const value: GraphMessage[] = res.data?.value ?? [];
    collected.push(...value);
    const nl = res.data?.["@odata.nextLink"] as string | undefined;
    const dl = res.data?.["@odata.deltaLink"] as string | undefined;
    if (dl) {
      nextDeltaLink = dl;
      nextEndpoint = null;
    } else if (nl) {
      nextEndpoint = nl.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "");
    } else {
      nextEndpoint = null;
    }
  }

  // Build "awaiting own reply" hint: conversations where the most recent existing helm_item
  // is inbound and older than 24h with no resolution.
  const { data: priorItems } = await supabase
    .from("helm_items")
    .select("conversation_id, created_at, status")
    .eq("user_id", userId)
    .eq("source", "email")
    .in("status", ["open"]);
  const awaitingReplyConvs = new Set<string>(
    (priorItems ?? [])
      .filter(
        (r: any) =>
          r.conversation_id &&
          new Date(r.created_at).getTime() < Date.now() - 24 * 3600 * 1000,
      )
      .map((r: any) => r.conversation_id),
  );

  let surfaced = 0;
  let autoFiled = 0;
  let removed = 0;

  for (const msg of collected) {
    if ((msg as any)["@removed"]) {
      // Tombstone — drop matching helm_item
      if (msg.id) {
        await supabase
          .from("helm_items")
          .delete()
          .eq("user_id", userId)
          .eq("source", "email")
          .eq("graph_id", msg.id);
        removed++;
      }
      continue;
    }
    if (!msg.id) continue;

    const fromAddr = (msg.from?.emailAddress?.address ?? "").toLowerCase();
    const fromName = msg.from?.emailAddress?.name ?? fromAddr;
    const { score, isDirect, isCcOnly, automated } = scoreMessage(msg, {
      userEmail,
      vipSet,
      awaitingReplyConvs,
    });
    const awaitingOwnReply =
      !!msg.conversationId && awaitingReplyConvs.has(msg.conversationId);
    const tier = tierFor(score, awaitingOwnReply);
    const dueAt = msg.flag?.dueDateTime?.dateTime ?? null;
    const actionKey = `email:${msg.id}`;

    if (tier === "auto") {
      autoFiled++;
      await supabase.from("activity_log").insert({
        user_id: userId,
        organization_id: orgId,
        action_type: "item_filed",
        detail:
          (automated ? "[auto] " : isCcOnly ? "[cc] " : "") +
          `Filed "${(msg.subject ?? "(no subject)").slice(0, 120)}" from ${fromName}`,
        graph_id: msg.id,
        tier,
        action_key: actionKey,
      });
      // Make sure nothing stale is still in front of the user
      await supabase
        .from("helm_items")
        .delete()
        .eq("user_id", userId)
        .eq("source", "email")
        .eq("graph_id", msg.id);
      continue;
    }

    const context = await generateContext(authHeader, userId, msg, tier);

    const row = {
      user_id: userId,
      organization_id: orgId,
      source: "email" as const,
      graph_id: msg.id,
      conversation_id: msg.conversationId ?? null,
      tier,
      score,
      title: msg.subject ?? "(no subject)",
      context,
      sender_name: fromName,
      sender_email: fromAddr,
      due_at: dueAt,
      is_external: fromAddr && !fromAddr.endsWith(
        userEmail.split("@")[1] ? `@${userEmail.split("@")[1]}` : "@",
      ),
      status: "open" as const,
      action_key: actionKey,
      payload: {
        receivedDateTime: msg.receivedDateTime,
        bodyPreview: msg.bodyPreview,
        importance: msg.importance,
        isDirect,
        isCcOnly,
        automated,
        toCount: msg.toRecipients?.length ?? 0,
        ccCount: msg.ccRecipients?.length ?? 0,
        flagStatus: msg.flag?.flagStatus ?? null,
      },
    };

    const { error: upErr } = await supabase
      .from("helm_items")
      .upsert(row, { onConflict: "action_key" });
    if (!upErr) surfaced++;
  }

  // Persist delta link
  if (nextDeltaLink) {
    await supabase
      .from("helm_mail_sync_state")
      .upsert(
        {
          user_id: userId,
          organization_id: orgId,
          connection_id: connectionId!,
          delta_link: nextDeltaLink,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "connection_id" },
      );
  }

  return json(200, {
    ok: true,
    fetched: collected.length,
    surfaced,
    autoFiled,
    removed,
    pages,
    usedDelta: !!useDelta,
    nextDeltaSaved: !!nextDeltaLink,
  });
});

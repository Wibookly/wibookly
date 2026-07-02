// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function stripFences(s: string) {
  return s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
}

async function gatherContext(admin: any, userId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 1);
  const sinceISO = since.toISOString();

  const [emails, followups] = await Promise.all([
    admin.from("tracked_emails")
      .select("subject, sender_name, sender_email, priority_score, status, received_at, category_id")
      .eq("user_id", userId)
      .gte("received_at", sinceISO)
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(50),
    admin.from("follow_up_trackers")
      .select("subject, counterparty_name, counterparty_email, direction, status, due_at, last_activity_at")
      .eq("user_id", userId)
      .neq("status", "completed")
      .limit(20),
  ]);

  const emailRows = emails.data || [];
  const handledCount = emailRows.filter((e: any) => ["auto_replied", "sent", "handled"].includes(e.status)).length;
  const needReply = emailRows.filter((e: any) => ["pending", "flagged", "needs_reply", "awaiting_reply"].includes(e.status));

  return {
    counts: {
      urgent: needReply.filter((e: any) => (e.priority_score ?? 0) >= 80).length,
      replies: needReply.length,
      meetings: 0,
      handled: handledCount,
    },
    needReply: needReply.slice(0, 10),
    commitments: (followups.data || []).slice(0, 10),
  };
}

async function callLLM(system: string, user: string): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "{}";
}

const SYSTEM_PROMPT = `You are a warm, precise chief-of-staff writing a morning brief.
Respond ONLY with strict JSON matching this schema:
{
  "urgency_level": "calm" | "attention" | "urgent",
  "headline": string (max 8 words, sentence case),
  "subline": string (max 12 words, sentence case),
  "narrative": string (2-3 sentences, warm),
  "top_priority": string[] (0-3 short items),
  "meetings": string[],
  "commitments": string[],
  "client_signals": string[],
  "counts": { "urgent": number, "replies": number, "meetings": number, "handled": number },
  "full_brief_md": string (short markdown brief with ## sections)
}
urgency_level rules: use 'urgent' only for client escalations, missed same-day commitments, or calendar conflicts;
'attention' for notable-but-not-critical items; otherwise 'calm'.`;

async function generateForUser(admin: any, userId: string, orgId: string, dateISO: string) {
  const ctx = await gatherContext(admin, userId);
  let payload: any = null;

  try {
    const raw = await callLLM(
      SYSTEM_PROMPT,
      `Structured inputs (JSON):\n${JSON.stringify(ctx, null, 2)}\n\nWrite today's brief.`
    );
    payload = JSON.parse(stripFences(raw));
  } catch (e) {
    console.error("digest LLM failed", e);
  }

  if (!payload || typeof payload !== "object") {
    payload = {
      urgency_level: "calm",
      headline: `${ctx.counts.replies} replies waiting · ${ctx.counts.meetings} meetings`,
      subline: null,
      narrative: "",
      top_priority: [],
      meetings: [],
      commitments: [],
      client_signals: [],
      counts: ctx.counts,
      full_brief_md: "",
    };
  }
  payload.counts = { ...ctx.counts, ...(payload.counts || {}) };

  const { error } = await admin
    .from("daily_digests")
    .upsert(
      {
        user_id: userId,
        org_id: orgId,
        digest_date: dateISO,
        urgency_level: payload.urgency_level || "calm",
        headline: payload.headline || "Your day at a glance",
        subline: payload.subline || null,
        narrative: payload.narrative || "",
        top_priority: payload.top_priority ?? null,
        meetings: payload.meetings ?? null,
        commitments: payload.commitments ?? null,
        client_signals: payload.client_signals ?? null,
        counts: payload.counts,
        full_brief_md: payload.full_brief_md || null,
        dismissed_at: null,
      },
      { onConflict: "user_id,digest_date" }
    );
  if (error) throw error;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dateISO: string = body.digest_date || todayISO();

    let userIds: string[] = [];
    let userOrg = new Map<string, string>();

    if (body.user_id) {
      userIds = [body.user_id];
      const { data: p } = await admin
        .from("user_profiles")
        .select("user_id, organization_id")
        .eq("user_id", body.user_id)
        .maybeSingle();
      if (p?.organization_id) userOrg.set(body.user_id, p.organization_id);
    } else {
      const { data: profs } = await admin
        .from("user_profiles")
        .select("user_id, organization_id")
        .not("organization_id", "is", null);
      (profs || []).forEach((p: any) => {
        userIds.push(p.user_id);
        userOrg.set(p.user_id, p.organization_id);
      });
    }

    let ok = 0, failed = 0;
    for (const uid of userIds) {
      const org = userOrg.get(uid);
      if (!org) continue;
      try { await generateForUser(admin, uid, org, dateISO); ok++; }
      catch (e) { console.error("digest fail", uid, e); failed++; }
    }

    return new Response(JSON.stringify({ ok, failed, date: dateISO }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

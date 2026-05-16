// Receives transcript lines from the InboxIQ Chrome extension and persists them.
// Body: { sessionId: string, lines: Array<{ speaker?: string; text: string; spoken_at?: string }>, requestSuggestion?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...cors, "content-type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { sessionId, lines, requestSuggestion } = body ?? {};
    if (!sessionId || !Array.isArray(lines) || lines.length === 0) {
      return new Response(JSON.stringify({ error: "sessionId and lines[] required" }), {
        status: 400, headers: { ...cors, "content-type": "application/json" },
      });
    }

    // Verify session belongs to user
    const { data: session, error: sErr } = await supabase
      .from("meeting_sessions")
      .select("id, user_id, meeting_title")
      .eq("id", sessionId)
      .maybeSingle();
    if (sErr || !session || session.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "session not found" }), {
        status: 404, headers: { ...cors, "content-type": "application/json" },
      });
    }

    const rows = lines
      .filter((l: any) => l && typeof l.text === "string" && l.text.trim().length > 0)
      .map((l: any) => ({
        session_id: sessionId,
        user_id: user.id,
        speaker: (l.speaker || "Speaker").toString().slice(0, 64),
        text: l.text.toString().slice(0, 4000),
        spoken_at: l.spoken_at ? new Date(l.spoken_at).toISOString() : new Date().toISOString(),
      }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("meeting_transcripts").insert(rows);
      if (insErr) {
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 500, headers: { ...cors, "content-type": "application/json" },
        });
      }
    }

    let suggestion: any = null;
    if (requestSuggestion) {
      // Pull last 12 lines for context
      const { data: recent } = await supabase
        .from("meeting_transcripts")
        .select("speaker, text")
        .eq("session_id", sessionId)
        .order("spoken_at", { ascending: false })
        .limit(12);
      const ctx = (recent ?? []).reverse().map((r) => `${r.speaker}: ${r.text}`).join("\n");
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/meeting-copilot-suggestion`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: req.headers.get("Authorization") ?? "",
          },
          body: JSON.stringify({ sessionId, recentTranscript: ctx }),
        });
        suggestion = await r.json().catch(() => null);
      } catch (_) { /* non-fatal */ }
    }

    return new Response(JSON.stringify({ ok: true, inserted: rows.length, suggestion }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "internal_error" }), {
      status: 500, headers: { ...cors, "content-type": "application/json" },
    });
  }
});

// Edge function: generate or improve a help article using Lovable AI.
// Returns structured JSON: { title, summary, content (markdown), keywords[] }.
// Auth: super admin only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return json({ error: "Missing auth" }, 401);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: userData } = await supabase.auth.getUser(
      auth.replace("Bearer ", "")
    );
    const email = userData.user?.email?.toLowerCase();
    if (!userData.user || email !== SUPER_ADMIN_EMAIL) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const prompt: string = String(body?.prompt ?? "").slice(0, 4000);
    const mode: "generate" | "improve" = body?.mode === "improve" ? "improve" : "generate";
    const existing = body?.existing ?? null;
    const category: string = String(body?.category ?? "getting-started");

    if (!prompt) return json({ error: "Prompt is required" }, 400);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const systemPrompt = `You write user-facing help articles for InboxIQ, an AI-powered email management SaaS by EnergyForward. Tone: clear, friendly, professional, concise. Output valid markdown for the "content" field with short paragraphs, numbered steps when relevant, and bullet lists. NEVER include HTML. NEVER include the article title inside content (it's stored separately). Keep summary under 160 characters.`;

    const userPrompt =
      mode === "improve" && existing
        ? `Improve and expand this existing help article. Keep it accurate, fix typos, restructure for clarity, add useful tips. Category: ${category}.\n\nExisting:\nTitle: ${existing.title}\nSummary: ${existing.summary}\nContent:\n${existing.content}\n\nUser instruction: ${prompt}`
        : `Write a new help article. Category: ${category}.\nTopic / instruction from admin: ${prompt}`;

    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "emit_article",
                description: "Return the structured help article.",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    summary: { type: "string" },
                    content: { type: "string", description: "Markdown body" },
                    keywords: {
                      type: "array",
                      items: { type: "string" },
                      description: "5-10 search keywords",
                    },
                  },
                  required: ["title", "summary", "content", "keywords"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "emit_article" } },
        }),
      }
    );

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("AI error", aiRes.status, text);
      if (aiRes.status === 429)
        return json({ error: "Rate limit reached, try again shortly." }, 429);
      if (aiRes.status === 402)
        return json(
          { error: "AI credits exhausted. Top up Lovable AI usage." },
          402
        );
      return json({ error: "AI request failed" }, 500);
    }

    const data = await aiRes.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments;
    if (!args) return json({ error: "AI did not return content" }, 500);

    let parsed;
    try {
      parsed = JSON.parse(args);
    } catch {
      return json({ error: "AI returned invalid JSON" }, 500);
    }

    return json({ article: parsed });
  } catch (e) {
    console.error("help-content-ai error", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500
    );
  }

  function json(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

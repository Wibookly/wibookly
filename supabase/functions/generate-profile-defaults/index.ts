// Generate default Responsibilities + Communication Style for a user's
// profile using Lovable AI, based on company, industry, title, department.
// Auth: requires the caller's Supabase session JWT (uses verify_jwt default).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY is not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const company = String(body?.company ?? "").slice(0, 200);
    const industry = String(body?.industry ?? "").slice(0, 200);
    const title = String(body?.title ?? "").slice(0, 200);
    const department = String(body?.department ?? "").slice(0, 200);
    const fullName = String(body?.fullName ?? "").slice(0, 200);

    const systemPrompt = `You are an executive assistant who writes concise, realistic profile blurbs that an AI email assistant will use to draft replies on behalf of the user. Tone: practical, professional, first-person implied (no "I" pronouns). Output via the provided tool only.`;

    const userPrompt = `Generate a "Responsibilities" line and a "Communication style" line for this professional. Infer the industry from the company name if industry is not provided.

Company: ${company || "(unknown)"}
Industry: ${industry || "(infer from company)"}
Name: ${fullName || "(n/a)"}
Title: ${title || "(n/a)"}
Department: ${department || "(n/a)"}

Rules:
- Responsibilities: 1–2 sentences, ~25 words. List the 3–5 most likely day-to-day duties for this role at this kind of company.
- Communication style: 1–2 sentences, ~25 words. Describe tone, length, signoff preference, and what to avoid. Make it sound like a real person, not a template.
- No emojis. No markdown. No headings.`;

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
                name: "emit_profile_defaults",
                description: "Return the generated profile fields.",
                parameters: {
                  type: "object",
                  properties: {
                    responsibilities: { type: "string" },
                    communication_style: { type: "string" },
                    inferred_industry: { type: "string" },
                  },
                  required: ["responsibilities", "communication_style"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "emit_profile_defaults" },
          },
        }),
      }
    );

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("AI error", aiRes.status, text);
      if (aiRes.status === 429)
        return json({ error: "Rate limit reached, try again shortly." }, 429);
      if (aiRes.status === 402)
        return json({ error: "AI credits exhausted." }, 402);
      return json({ error: "AI request failed" }, 500);
    }

    const data = await aiRes.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return json({ error: "AI did not return content" }, 500);

    let parsed;
    try {
      parsed = JSON.parse(args);
    } catch {
      return json({ error: "AI returned invalid JSON" }, 500);
    }

    return json({ result: parsed });
  } catch (e) {
    console.error("generate-profile-defaults error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500
    );
  }
});

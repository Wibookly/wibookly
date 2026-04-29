// Embed text via OpenAI text-embedding-3-small (1536 dim)
// Batched up to 100 inputs per call. Public endpoint - service role only via JWT check.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MODEL = "text-embedding-3-small";
const DIM = 1536;
const BATCH_SIZE = 100;

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI embeddings error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    // Authenticate caller (any logged-in user can request embeddings for their own text)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } =
      await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const inputs: string[] = Array.isArray(body?.inputs) ? body.inputs : [];
    if (inputs.length === 0) {
      return new Response(
        JSON.stringify({ error: "inputs must be a non-empty array of strings" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (inputs.some((s) => typeof s !== "string")) {
      return new Response(
        JSON.stringify({ error: "all inputs must be strings" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Trim & guard against empty strings (OpenAI rejects them)
    const cleaned = inputs.map((s) => (s || "").trim().slice(0, 8000));
    const safeInputs = cleaned.map((s) => (s.length === 0 ? " " : s));

    const embeddings: number[][] = [];
    for (let i = 0; i < safeInputs.length; i += BATCH_SIZE) {
      const batch = safeInputs.slice(i, i + BATCH_SIZE);
      const result = await embedBatch(batch);
      embeddings.push(...result);
    }

    return new Response(
      JSON.stringify({ model: MODEL, dim: DIM, embeddings }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("embed-text error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

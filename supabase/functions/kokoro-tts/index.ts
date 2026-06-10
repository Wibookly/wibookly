// Text-to-Speech edge function.
// Prefers Kokoro (if KOKORO_BASE_URL + KOKORO_API_KEY are set), otherwise
// falls back to OpenAI's /audio/speech (which has the same request shape).
// Returns binary audio bytes as base64 inside JSON to avoid any transport
// corruption from intermediate JSON parsing.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KOKORO_BASE_URL = Deno.env.get("KOKORO_BASE_URL");
const KOKORO_API_KEY = Deno.env.get("KOKORO_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// Map Kokoro-style voice IDs (e.g. af_heart, am_adam, bf_emma, bm_george)
// onto OpenAI voices when we have to fall back.
function mapToOpenAIVoice(voice: string): string {
  const v = (voice || "").toLowerCase();
  if (v.startsWith("af_")) return "nova";    // American female
  if (v.startsWith("am_")) return "onyx";    // American male
  if (v.startsWith("bf_")) return "shimmer"; // British-ish female
  if (v.startsWith("bm_")) return "echo";    // British-ish male
  // Other languages -> sensible defaults
  if (v.startsWith("jf_") || v.startsWith("zf_") || v.startsWith("ef_") || v.startsWith("ff_") || v.startsWith("hf_") || v.startsWith("if_") || v.startsWith("pf_")) return "nova";
  if (v.startsWith("jm_") || v.startsWith("zm_") || v.startsWith("em_") || v.startsWith("fm_") || v.startsWith("hm_") || v.startsWith("im_") || v.startsWith("pm_")) return "onyx";
  return "alloy";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const text: string = (body?.text ?? "").toString();
    const voice: string = (body?.voice ?? "af_heart").toString();
    const format: string = (body?.format ?? "mp3").toString();

    if (!text.trim()) {
      return new Response(JSON.stringify({ error: "Missing 'text'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[tts] incoming text length: ${text.length}, voice=${voice}, format=${format}`);

    let upstream: Response;
    let provider: string;

    if (KOKORO_BASE_URL) {
      provider = "kokoro";
      const url = `${KOKORO_BASE_URL.replace(/\/+$/, "")}/audio/speech`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (KOKORO_API_KEY) headers["Authorization"] = `Bearer ${KOKORO_API_KEY}`;
      upstream = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "kokoro", voice, input: text, response_format: format }),
      });
    } else if (OPENAI_API_KEY) {
      provider = "openai";
      upstream = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: mapToOpenAIVoice(voice),
          input: text.slice(0, 4000),
          response_format: format,
        }),
      });
    } else {
      return new Response(JSON.stringify({
        error: "No TTS provider configured. Set KOKORO_BASE_URL (+ KOKORO_API_KEY) or OPENAI_API_KEY.",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[tts] ${provider} response status: ${upstream.status}`);

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error(`[tts] ${provider} error: ${errText}`);
      return new Response(JSON.stringify({
        error: `${provider} TTS failed`,
        status: upstream.status,
        details: errText,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const buf = await upstream.arrayBuffer();
    const bytes = new Uint8Array(buf);
    console.log(`[tts] returned audio byte size: ${bytes.length}`);

    const base64 = bytesToBase64(bytes);
    const mimeType = format === "wav" ? "audio/wav" : format === "ogg" ? "audio/ogg" : "audio/mpeg";

    return new Response(JSON.stringify({ audio: base64, mimeType, provider, bytes: bytes.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[tts] unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal error", details: String((err as Error)?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Transcribes a base64-encoded audio chunk.
// Prefers Deepgram (fast, accurate, streaming-friendly). Falls back to OpenAI
// Whisper if DEEPGRAM_API_KEY is not configured.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function base64ToBytes(base64: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const size = 32768;
  while (pos < base64.length) {
    const slice = base64.slice(pos, pos + size);
    const bin = atob(slice);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    chunks.push(bytes);
    pos += size;
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function transcribeWithDeepgram(audio: Uint8Array, key: string, mime: string) {
  const url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&detect_language=true";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": mime || "audio/webm",
    },
    body: audio,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Deepgram ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return text;
}

async function transcribeWithOpenAI(audio: Uint8Array, key: string) {
  const form = new FormData();
  form.append("file", new Blob([audio.buffer as ArrayBuffer], { type: "audio/webm" }), "audio.webm");
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.text || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { audio, mime_type } = body as { audio?: string; mime_type?: string };
    if (!audio) throw new Error("No audio data provided");

    const bytes = base64ToBytes(audio);
    const dgKey = Deno.env.get("DEEPGRAM_API_KEY");
    const oaKey = Deno.env.get("OPENAI_API_KEY");

    let text = "";
    let provider = "";
    if (dgKey) {
      try {
        text = await transcribeWithDeepgram(bytes, dgKey, mime_type || "audio/webm");
        provider = "deepgram";
      } catch (e) {
        console.warn("Deepgram failed, falling back:", e);
        if (!oaKey) throw e;
      }
    }
    if (!provider) {
      if (!oaKey) throw new Error("No transcription provider configured (DEEPGRAM_API_KEY or OPENAI_API_KEY)");
      text = await transcribeWithOpenAI(bytes, oaKey);
      provider = "openai";
    }

    return new Response(JSON.stringify({ text, provider }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("voice-to-text error:", msg);
    return new Response(JSON.stringify({ error: msg, text: "" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

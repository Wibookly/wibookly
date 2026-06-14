// Server-side proxy to a hosted Kokoro TTS server.
// Accepts { text, voice } and returns audio bytes.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_INPUT_LENGTH = 180;
const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_FALLBACK_VOICE = 'af_heart';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanMarkdownForSpeech(input: string) {
  const original = String(input || '');
  let text = original.replace(/\r\n/g, '\n');

  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  text = text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return ' ';
      if (/^[\s|:-]+$/.test(trimmed) && /[:-]/.test(trimmed)) return ' ';
      return line.replace(/\|/g, ' ').replace(/[#__*`>]/g, ' ');
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= MAX_INPUT_LENGTH) return text;

  const candidate = text.slice(0, MAX_INPUT_LENGTH);
  let sentenceCut = -1;
  const matches = candidate.matchAll(/[.!?]+(?=\s|$)/g);
  for (const match of matches) {
    sentenceCut = match.index ?? sentenceCut;
  }
  if (sentenceCut >= Math.floor(MAX_INPUT_LENGTH * 0.5)) {
    return candidate.slice(0, sentenceCut + 1).trim();
  }

  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace > 0) return candidate.slice(0, lastSpace).trim();
  return candidate.trim();
}

function toBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchKokoroAudio(baseUrl: string, apiKey: string, text: string, voice: string) {
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/speech`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'kokoro',
        voice,
        input: text,
        response_format: 'mp3',
      }),
      signal: controller.signal,
    });

    console.log('[tts] upstream status:', upstream.status, 'url:', url, 'voice:', voice);

    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => '')) || upstream.statusText || 'Unknown upstream error';
      return { ok: false as const, status: upstream.status, detail };
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    return { ok: true as const, bytes };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const detail = isTimeout
      ? 'timeout'
      : String(((err as Error)?.message ?? err) || 'Unknown upstream error');
    return { ok: false as const, status: isTimeout ? 504 : 502, detail };
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetryUpstream(status: number, detail: string) {
  return status === 502 || status === 503 || status === 504 || detail === 'timeout';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const baseUrl = Deno.env.get('KOKORO_BASE_URL');
    const apiKey = Deno.env.get('KOKORO_API_KEY');
    if (!baseUrl || !apiKey) {
      return new Response(
        JSON.stringify({ error: 'Kokoro server is not configured.', status: 500, detail: 'Missing KOKORO_BASE_URL or KOKORO_API_KEY.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const originalText = typeof body?.text === 'string' ? body.text : '';
    const voice = typeof body?.voice === 'string' && body.voice ? body.voice : 'af_heart';
    const cleanedText = cleanMarkdownForSpeech(originalText);

    console.log('[tts] original length:', originalText.length, 'cleaned length:', cleanedText.length, 'voice:', voice);

    if (!cleanedText) {
      return new Response(
        JSON.stringify({ error: 'Missing "text".', status: 400, detail: 'Provide non-empty text after markdown cleanup.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let primary = await fetchKokoroAudio(baseUrl, apiKey, cleanedText, voice);
    if (!primary.ok && shouldRetryUpstream(primary.status, primary.detail)) {
      console.warn('[tts] upstream retrying after transient failure', primary.status, primary.detail, 'voice:', voice);
      await sleep(250);
      primary = await fetchKokoroAudio(baseUrl, apiKey, cleanedText, voice);
    }
    if (!primary.ok) {
      return new Response(
        JSON.stringify({ error: 'Kokoro upstream error', status: primary.status, detail: primary.detail }),
        { status: primary.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let bytes = primary.bytes;
    let voiceUsed = voice;
    let fallbackUsed = false;

    if (bytes.byteLength === 0 && voice !== DEFAULT_FALLBACK_VOICE) {
      console.warn('[tts] empty audio from upstream, retrying with fallback voice', voice, '->', DEFAULT_FALLBACK_VOICE);
      const fallback = await fetchKokoroAudio(baseUrl, apiKey, cleanedText, DEFAULT_FALLBACK_VOICE);
      if (!fallback.ok) {
        return new Response(
          JSON.stringify({ error: 'Kokoro upstream error', status: fallback.status, detail: fallback.detail }),
          { status: fallback.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      bytes = fallback.bytes;
      voiceUsed = DEFAULT_FALLBACK_VOICE;
      fallbackUsed = true;
    }

    if (bytes.byteLength === 0) {
      return new Response(
        JSON.stringify({ error: 'Kokoro upstream error', status: 502, detail: `Empty audio response for voice ${voiceUsed}.` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('[tts] audio bytes:', bytes.byteLength, 'voice requested:', voice, 'voice used:', voiceUsed, 'fallback:', fallbackUsed);

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=86400, immutable',
        'X-Tts-Voice-Used': voiceUsed,
        'X-Tts-Fallback': fallbackUsed ? '1' : '0',
      },
    });
  } catch (err) {
    const detail = String(((err as Error)?.message ?? err) || 'Unknown error');
    console.error('[tts] unexpected error', detail);
    return new Response(
      JSON.stringify({ error: 'Unexpected TTS error', status: 500, detail }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

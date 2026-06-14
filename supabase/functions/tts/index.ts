// Server-side proxy to a hosted Kokoro TTS server.
// Accepts { text, voice } and returns { audio, mimeType } JSON.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_INPUT_LENGTH = 1000;
const FETCH_TIMEOUT_MS = 90_000;

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
          input: cleanedText,
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });

      console.log('[tts] upstream status:', upstream.status, 'url:', url);

      if (!upstream.ok) {
        const detail = (await upstream.text().catch(() => '')) || upstream.statusText || 'Unknown upstream error';
        return new Response(
          JSON.stringify({ error: 'Kokoro upstream error', status: upstream.status, detail }),
          { status: upstream.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const bytes = new Uint8Array(await upstream.arrayBuffer());
      const audio = toBase64(bytes);

      return new Response(
        JSON.stringify({ audio, mimeType: 'audio/mpeg' }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        },
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const detail = isTimeout
        ? 'timeout'
        : String((err as Error)?.message ?? err || 'Unknown upstream error');
      return new Response(
        JSON.stringify({ error: 'Kokoro upstream error', status: isTimeout ? 504 : 502, detail }),
        { status: isTimeout ? 504 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    const detail = String((err as Error)?.message ?? err || 'Unknown error');
    console.error('[tts] unexpected error', detail);
    return new Response(
      JSON.stringify({ error: 'Unexpected TTS error', status: 500, detail }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

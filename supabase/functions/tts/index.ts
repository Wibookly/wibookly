// Server-side proxy to a hosted Kokoro TTS server.
// Accepts { text, voice } and returns binary MP3 audio.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const baseUrl = Deno.env.get('KOKORO_BASE_URL');
    const apiKey = Deno.env.get('KOKORO_API_KEY');
    if (!baseUrl || !apiKey) {
      return new Response(
        JSON.stringify({ error: 'Kokoro server is not configured.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const voice = typeof body?.voice === 'string' && body.voice ? body.voice : 'af_heart';
    if (!text) {
      return new Response(
        JSON.stringify({ error: 'Missing "text".' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const trimmedText = text.slice(0, 4000);
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const host = (() => {
      try { return new URL(normalizedBase).host; } catch { return normalizedBase; }
    })();
    console.log('[tts] incoming text length:', trimmedText.length, 'voice:', voice, 'host:', host);

    const candidateUrls = [
      `${normalizedBase}/v1/audio/speech`,
      `${normalizedBase}/audio/speech`,
    ];

    let lastStatus = 500;
    let lastDetail = '';

    for (const url of candidateUrls) {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'kokoro',
          voice,
          input: trimmedText,
          response_format: 'mp3',
        }),
      });

      console.log('[tts] upstream status:', upstream.status, 'url:', url);

      if (!upstream.ok) {
        lastStatus = upstream.status;
        lastDetail = await upstream.text().catch(() => '');
        console.error('[tts] upstream error', upstream.status, url, lastDetail.slice(0, 500));
        continue;
      }

      const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': contentType.includes('audio/') ? contentType : 'audio/mpeg',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response(
      JSON.stringify({
        error: 'Kokoro upstream error',
        status: lastStatus,
        detail: lastDetail.slice(0, 1000),
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[tts] unexpected error', err);
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

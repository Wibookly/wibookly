// Server-side proxy to a hosted Kokoro TTS server.
// Accepts { text, voice } and returns { audio: base64, mimeType: "audio/mpeg" }.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
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
    console.log('[tts] incoming text length:', trimmedText.length, 'voice:', voice);

    const url = baseUrl.replace(/\/+$/, '') + '/audio/speech';
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

    console.log('[tts] upstream status:', upstream.status);

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('[tts] upstream error', upstream.status, detail.slice(0, 500));
      return new Response(
        JSON.stringify({
          error: 'Kokoro upstream error',
          status: upstream.status,
          detail: detail.slice(0, 1000),
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const arrayBuf = await upstream.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    console.log('[tts] returned byte size:', bytes.byteLength);

    const audio = bytesToBase64(bytes);
    return new Response(
      JSON.stringify({ audio, mimeType: 'audio/mpeg' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[tts] unexpected error', err);
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

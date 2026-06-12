// Server-side TTS proxy. Calls a Kokoro OpenAI-compatible /v1/audio/speech
// endpoint and returns the MP3 bytes as base64 so the browser can decode
// and play them through Web Audio. Tiny payload, works on iOS Safari.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { text, voice } = await req.json().catch(() => ({}));
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing "text"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = (Deno.env.get('KOKORO_BASE_URL') || '').replace(/\/+$/, '');
    if (!baseUrl) {
      return new Response(JSON.stringify({ error: 'KOKORO_BASE_URL not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const apiKey = Deno.env.get('KOKORO_API_KEY');

    const inputText = String(text).slice(0, 4000);
    const voiceId = typeof voice === 'string' && voice ? voice : 'af_heart';

    console.log('[tts] incoming text length:', inputText.length, 'voice:', voiceId);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const upstream = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'kokoro',
        voice: voiceId,
        input: inputText,
        response_format: 'mp3',
      }),
    });

    console.log('[tts] upstream status:', upstream.status);

    if (!upstream.ok) {
      let detail = '';
      try { detail = await upstream.text(); } catch { /* ignore */ }
      return new Response(JSON.stringify({
        error: 'Upstream TTS error',
        status: upstream.status,
        detail: detail.slice(0, 500),
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buf = new Uint8Array(await upstream.arrayBuffer());
    console.log('[tts] returned bytes:', buf.length);

    // base64-encode in chunks to avoid call-stack issues on big buffers.
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    const base64 = btoa(bin);

    return new Response(JSON.stringify({ audio: base64, mimeType: 'audio/mpeg' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[tts] error', err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

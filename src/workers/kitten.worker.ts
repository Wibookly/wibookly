/// <reference lib="webworker" />
// Tier 2 — KittenTTS (~25MB INT8 ONNX). Used on mobile/tablet by default,
// also used as a fallback on desktop if Kokoro fails to load.
//
// Public message protocol (matches kokoro.worker):
//   in  : { type: 'preload', voice? } | { type: 'speak', id, text, voice } | { type: 'stop' }
//   out : { type: 'status', state: 'loading'|'ready'|'error', progress?, message? }
//         { type: 'audio-chunk', id, blob, final }
// Output is a 24kHz mono WAV blob (decoded by Web Audio via playPcmBlob).

import { KittenTTS } from 'kitten-tts-js';

const MODEL_ID = 'KittenML/kitten-tts-nano-0.8';
const DEFAULT_VOICE = 'Bella';

let tts: any = null;
let ready = false;
let loadingPromise: Promise<any> | null = null;
let currentSpeakId: string | null = null;

function postStatus(state: string, extras: Record<string, unknown> = {}) {
  (self as any).postMessage({ type: 'status', state, ...extras });
}

function f32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numFrames = samples.length;
  const buf = new ArrayBuffer(44 + numFrames * 2);
  const view = new DataView(buf);
  const wr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  wr(0, 'RIFF');
  view.setUint32(4, 36 + numFrames * 2, true);
  wr(8, 'WAVE');
  wr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wr(36, 'data');
  view.setUint32(40, numFrames * 2, true);
  let off = 44;
  for (let i = 0; i < numFrames; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function load() {
  if (tts) return tts;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    postStatus('loading', { progress: 5 });
    try {
      tts = await KittenTTS.from_pretrained(MODEL_ID);
      postStatus('loading', { progress: 90 });
      return tts;
    } catch (e) {
      loadingPromise = null;
      throw e;
    }
  })();
  return loadingPromise;
}

async function warmUp(voice: string) {
  // Silent warm-up generation. A tier is only "ready" once this succeeds.
  const out = await tts.generate('ok', { voice });
  if (!out || !out.data) throw new Error('Kitten warm-up returned no audio');
}

self.onmessage = async (event: MessageEvent) => {
  const { type, id, text, voice } = event.data || {};
  const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;

  if (type === 'stop') { currentSpeakId = null; return; }

  if (type === 'preload') {
    try {
      await load();
      await warmUp(v);
      ready = true;
      postStatus('ready', { progress: 100 });
    } catch (e: any) {
      console.error('[kitten.worker] preload error:', e);
      postStatus('error', { message: String(e?.message ?? e) });
    }
    return;
  }

  if (type === 'speak') {
    currentSpeakId = id;
    try {
      if (!ready) postStatus('loading');
      await load();
      if (!ready) {
        await warmUp(v);
        ready = true;
        postStatus('ready', { progress: 100 });
      }
      if (currentSpeakId !== id) return;
      const out = await tts.generate(String(text || ''), { voice: v });
      if (currentSpeakId !== id) return;
      const samples = out?.data instanceof Float32Array ? out.data : new Float32Array(out?.data || []);
      const sr = Number(out?.sampling_rate) || 24000;
      const blob = f32ToWavBlob(samples, sr);
      (self as any).postMessage({ type: 'audio-chunk', id, blob, final: true });
    } catch (e: any) {
      console.error('[kitten.worker] speak error:', e);
      postStatus('error', { id, message: String(e?.message ?? e) });
    }
  }
};

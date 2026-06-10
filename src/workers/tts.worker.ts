/// <reference lib="webworker" />
// Browser-side Kokoro TTS worker.
// Loads the model once (WebGPU → WASM fallback), warms it up per voice, then
// serves `speak` requests. Streams status events back to the main thread.

import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';

let tts: any = null;
let ready = false;
let loadingPromise: Promise<any> | null = null;
const warmedVoices = new Set<string>();

async function load() {
  if (tts) return tts;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'webgpu' as any });
      console.log('[tts.worker] loaded on WebGPU');
    } catch (e) {
      console.warn('[tts.worker] WebGPU unavailable, falling back to WASM:', e);
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm' as any });
      console.log('[tts.worker] loaded on WASM');
    }
    return tts;
  })();
  return loadingPromise;
}

async function warmVoice(model: any, voice: string) {
  if (warmedVoices.has(voice)) return;
  try {
    // A short English sentence forces the voice tensor + phonemizer cache to
    // load so the first real `speak` doesn't pay the latency hit.
    await model.generate('Hello, this is a test of the voice.', { voice });
    warmedVoices.add(voice);
    console.log('[tts.worker] warmed voice:', voice);
  } catch (e) {
    console.warn('[tts.worker] warm voice failed:', voice, e);
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { type, id, text, voice } = event.data || {};

  if (type === 'preload') {
    try {
      (self as any).postMessage({ type: 'status', state: 'loading' });
      const model = await load();
      const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;
      await warmVoice(model, v);
      ready = true;
      (self as any).postMessage({ type: 'status', state: 'ready' });
    } catch (e: any) {
      console.error('[tts.worker] preload error:', e);
      (self as any).postMessage({ type: 'status', state: 'error', message: String(e?.message ?? e) });
    }
    return;
  }

  if (type === 'warm') {
    try {
      const model = await load();
      const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;
      await warmVoice(model, v);
    } catch (e) {
      console.warn('[tts.worker] warm error:', e);
    }
    return;
  }

  if (type === 'speak') {
    try {
      if (!ready) (self as any).postMessage({ type: 'status', state: 'loading' });
      const model = await load();
      const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;
      console.log('[tts.worker] speak voice=%s len=%d', v, String(text || '').length);
      if (!ready) {
        ready = true;
        (self as any).postMessage({ type: 'status', state: 'ready' });
      }
      const audio = await model.generate(String(text || ''), { voice: v });
      warmedVoices.add(v);
      const blob: Blob = audio.toBlob();
      (self as any).postMessage({ type: 'audio', id, blob });
    } catch (e: any) {
      console.error('[tts.worker] speak error:', e);
      (self as any).postMessage({ type: 'status', state: 'error', id, message: String(e?.message ?? e) });
    }
    return;
  }
};

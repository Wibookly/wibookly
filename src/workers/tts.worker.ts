/// <reference lib="webworker" />
// Browser-side Kokoro TTS worker.
// Loads the model once (WebGPU → WASM fallback), warms it up, then serves
// `speak` requests. Streams status events back to the main thread.

import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let tts: any = null;
let ready = false;
let loadingPromise: Promise<any> | null = null;

async function load() {
  if (tts) return tts;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'webgpu' as any });
    } catch (e) {
      console.warn('[tts.worker] WebGPU unavailable, falling back to WASM:', e);
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm' as any });
    }
    return tts;
  })();
  return loadingPromise;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, id, text, voice } = event.data || {};

  if (type === 'preload') {
    if (ready) {
      (self as any).postMessage({ type: 'status', state: 'ready' });
      return;
    }
    try {
      (self as any).postMessage({ type: 'status', state: 'loading' });
      const model = await load();
      // CRITICAL warm-up so shaders / inference session compile before
      // we tell the UI we're ready.
      await model.generate('ok', { voice: 'af_heart' });
      ready = true;
      (self as any).postMessage({ type: 'status', state: 'ready' });
    } catch (e: any) {
      console.error('[tts.worker] preload error:', e);
      (self as any).postMessage({ type: 'status', state: 'error', message: String(e?.message ?? e) });
    }
    return;
  }

  if (type === 'speak') {
    try {
      if (!ready) (self as any).postMessage({ type: 'status', state: 'loading' });
      const model = await load();
      if (!ready) {
        // First speak before preload finished: warm up implicitly.
        ready = true;
        (self as any).postMessage({ type: 'status', state: 'ready' });
      }
      const audio = await model.generate(String(text || ''), { voice: voice || 'af_heart' });
      const blob: Blob = audio.toBlob();
      (self as any).postMessage({ type: 'audio', id, blob });
    } catch (e: any) {
      console.error('[tts.worker] speak error:', e);
      (self as any).postMessage({ type: 'status', state: 'error', id, message: String(e?.message ?? e) });
    }
    return;
  }
};

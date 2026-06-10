/// <reference lib="webworker" />
// Browser-side Kokoro TTS worker.
// Loads the model once with real download-progress reporting, warms it up
// per voice, then serves `speak` requests.

import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';

let tts: any = null;
let ready = false;
let loadingPromise: Promise<any> | null = null;
const warmedVoices = new Set<string>();

// Track download progress across files
const fileProgress = new Map<string, number>();

function reportProgress() {
  if (fileProgress.size === 0) return;
  let sum = 0;
  for (const v of fileProgress.values()) sum += v;
  const pct = Math.min(99, Math.round(sum / fileProgress.size));
  (self as any).postMessage({ type: 'status', state: 'loading', progress: pct });
}

function progressCallback(data: any) {
  try {
    if (!data || !data.file) return;
    if (data.status === 'progress' && typeof data.progress === 'number') {
      fileProgress.set(data.file, data.progress);
      reportProgress();
    } else if (data.status === 'done') {
      fileProgress.set(data.file, 100);
      reportProgress();
    } else if (data.status === 'initiate' || data.status === 'download') {
      if (!fileProgress.has(data.file)) fileProgress.set(data.file, 0);
      reportProgress();
    }
  } catch { /* ignore */ }
}

async function tryLoad(device: 'webgpu' | 'wasm') {
  console.log('[tts.worker] attempting load on', device);
  return await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    device: device as any,
    progress_callback: progressCallback,
  } as any);
}

async function load() {
  if (tts) return tts;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const hasWebGPU = typeof (navigator as any).gpu !== 'undefined';
    if (hasWebGPU) {
      try {
        tts = await tryLoad('webgpu');
        console.log('[tts.worker] loaded on WebGPU');
        return tts;
      } catch (e) {
        console.warn('[tts.worker] WebGPU load failed, falling back to WASM:', e);
      }
    } else {
      console.log('[tts.worker] navigator.gpu missing — using WASM');
    }
    tts = await tryLoad('wasm');
    console.log('[tts.worker] loaded on WASM');
    return tts;
  })();
  return loadingPromise;
}

async function warmVoice(model: any, voice: string) {
  if (warmedVoices.has(voice)) return;
  try {
    await model.generate('Hello.', { voice });
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
      (self as any).postMessage({ type: 'status', state: 'loading', progress: 0 });
      const model = await load();
      const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;
      await warmVoice(model, v);
      ready = true;
      (self as any).postMessage({ type: 'status', state: 'ready', progress: 100 });
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
        (self as any).postMessage({ type: 'status', state: 'ready', progress: 100 });
      }
      const audio = await model.generate(String(text || ''), { voice: v });
      warmedVoices.add(v);
      const blob: Blob = audio.toBlob();
      console.log('[tts.worker] generated audio bytes:', blob.size);
      (self as any).postMessage({ type: 'audio', id, blob });
    } catch (e: any) {
      console.error('[tts.worker] speak error:', e);
      (self as any).postMessage({ type: 'status', state: 'error', id, message: String(e?.message ?? e) });
    }
    return;
  }
};

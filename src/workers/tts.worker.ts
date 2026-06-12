/// <reference lib="webworker" />
// Desktop-only Kokoro TTS worker. Mobile/tablet never instantiates this
// worker — see ttsService for device routing.

import { KokoroTTS, env } from 'kokoro-js';

try {
  (env as any).useBrowserCache = true;
  (env as any).allowLocalModels = false;
  (env as any).allowRemoteModels = true;
  if ((env as any).backends?.onnx?.wasm) {
    (env as any).backends.onnx.wasm.numThreads = 1;
  }
} catch { /* ignore */ }

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';

let tts: any = null;
let ready = false;
let loadingPromise: Promise<any> | null = null;
const warmedVoices = new Set<string>();
const fileBytes = new Map<string, { loaded: number; total: number }>();

function reportProgress() {
  if (fileBytes.size === 0) return;
  let loaded = 0, total = 0;
  for (const v of fileBytes.values()) { loaded += v.loaded; total += v.total; }
  if (total <= 0) return;
  const pct = Math.min(99, Math.round((loaded / total) * 100));
  (self as any).postMessage({ type: 'status', state: 'loading', progress: pct });
}

function progressCallback(data: any) {
  try {
    if (!data || !data.file) return;
    if (data.status === 'progress' && typeof data.loaded === 'number' && typeof data.total === 'number') {
      fileBytes.set(data.file, { loaded: data.loaded, total: data.total });
      reportProgress();
    } else if (data.status === 'done') {
      const cur = fileBytes.get(data.file);
      if (cur) fileBytes.set(data.file, { loaded: cur.total || cur.loaded, total: cur.total || cur.loaded });
      reportProgress();
    } else if (data.status === 'initiate' || data.status === 'download') {
      if (!fileBytes.has(data.file)) fileBytes.set(data.file, { loaded: 0, total: 0 });
    }
  } catch { /* ignore */ }
}

async function tryLoad(device: 'webgpu' | 'wasm') {
  const dtype = device === 'webgpu' ? 'fp32' : 'q8';
  return await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
    device: device as any,
    progress_callback: progressCallback,
  } as any);
}

async function hasUsableWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch { return false; }
}

async function load() {
  if (tts) return tts;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    if ('gpu' in (navigator as any) && await hasUsableWebGPU()) {
      try {
        tts = await Promise.race([
          tryLoad('webgpu'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('WebGPU init timed out')), 45000)),
        ]);
        return tts;
      } catch (e) {
        console.warn('[tts.worker] WebGPU failed, falling back to WASM:', e);
      }
    }
    tts = await tryLoad('wasm');
    return tts;
  })().catch((e) => { loadingPromise = null; throw e; });
  return loadingPromise;
}

async function warmVoice(model: any, voice: string) {
  if (warmedVoices.has(voice)) return;
  try {
    await model.generate('ok', { voice });
    warmedVoices.add(voice);
  } catch (e) {
    console.warn('[tts.worker] warm voice failed:', voice, e);
  }
}

function splitIntoChunks(text: string, maxLen = 280): string[] {
  const sentences = String(text || '').match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [String(text || '')];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (cur && (cur.length + piece.length + 1) > maxLen) { chunks.push(cur); cur = piece; }
    else { cur = cur ? `${cur} ${piece}` : piece; }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [String(text || '')];
}

let currentSpeakId: string | null = null;

self.onmessage = async (event: MessageEvent) => {
  const { type, id, text, voice } = event.data || {};

  if (type === 'preload') {
    try {
      (self as any).postMessage({ type: 'status', state: 'loading', progress: 0 });
      const model = await load();
      (self as any).postMessage({ type: 'status', state: 'loading', progress: 100 });
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
    } catch (e) { console.warn('[tts.worker] warm error:', e); }
    return;
  }

  if (type === 'stop') { currentSpeakId = null; return; }

  if (type === 'speak') {
    currentSpeakId = id;
    try {
      if (!ready) (self as any).postMessage({ type: 'status', state: 'loading' });
      const model = await load();
      const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;
      if (!ready) {
        ready = true;
        (self as any).postMessage({ type: 'status', state: 'ready', progress: 100 });
      }
      const chunks = splitIntoChunks(String(text || ''));
      for (let i = 0; i < chunks.length; i++) {
        if (currentSpeakId !== id) return;
        const audio = await model.generate(chunks[i], { voice: v });
        warmedVoices.add(v);
        if (currentSpeakId !== id) return;
        const blob: Blob = audio.toBlob();
        (self as any).postMessage({
          type: 'audio-chunk', id, blob, index: i, final: i === chunks.length - 1,
        });
      }
    } catch (e: any) {
      console.error('[tts.worker] speak error:', e);
      (self as any).postMessage({ type: 'status', state: 'error', id, message: String(e?.message ?? e) });
    }
    return;
  }
};

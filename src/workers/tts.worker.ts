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

function isMobileUA(): boolean {
  try {
    const ua = (self as any).navigator?.userAgent || '';
    return /iPad|iPhone|iPod|Android/i.test(ua);
  } catch { return false; }
}

async function tryLoad(device: 'webgpu' | 'wasm') {
  console.log('[tts.worker] attempting load on', device);
  // Mobile WASM: use q4 (~40MB) instead of q8 (~80MB) — roughly half the
  // download and noticeably faster first play on phones.
  const dtype =
    device === 'webgpu' ? 'fp32' : (isMobileUA() ? 'q4' : 'q8');
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
  } catch {
    return false;
  }
}

async function load() {
  if (tts) return tts;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    if (await hasUsableWebGPU()) {
      try {
        tts = await tryLoad('webgpu');
        console.log('[tts.worker] loaded on WebGPU');
        return tts;
      } catch (e) {
        console.warn('[tts.worker] WebGPU load failed, falling back to WASM:', e);
      }
    } else {
      console.log('[tts.worker] no usable WebGPU adapter — using WASM');
    }
    tts = await tryLoad('wasm');
    console.log('[tts.worker] loaded on WASM');
    return tts;
  })().catch((e) => {
    // Reset so a later attempt can retry instead of awaiting a dead promise.
    loadingPromise = null;
    throw e;
  });
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

// Split text into sentence-grouped chunks (~280 chars) so the first audio
// arrives within seconds instead of generating one huge clip.
function splitIntoChunks(text: string, maxLen = 280): string[] {
  const sentences = String(text || '').match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [String(text || '')];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (cur && (cur.length + piece.length + 1) > maxLen) {
      chunks.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [String(text || '')];
}

// Track which speak request is current so superseded ones stop generating.
let currentSpeakId: string | null = null;

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

/// <reference lib="webworker" />
// Browser-side Kokoro TTS worker.
// Loads the model once with real download-progress reporting, warms it up
// per voice, then serves `speak` requests.

import { KokoroTTS, env } from 'kokoro-js';

// Make sure downloaded model files are cached by the browser (Cache API) so
// refreshes do NOT re-download. Explicit because some embeds default it off.
try {
  (env as any).useBrowserCache = true;
  (env as any).allowLocalModels = false;
  (env as any).allowRemoteModels = true;
  // iOS Safari / non-cross-origin-isolated contexts HANG when onnxruntime
  // tries to spawn WASM threads. Single-threaded is the safe default.
  if ((env as any).backends?.onnx?.wasm) {
    (env as any).backends.onnx.wasm.numThreads = 1;
  }
  console.log('[tts.worker] browser cache available:', typeof caches !== 'undefined');
} catch { /* ignore */ }

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';

// Set via 'config' message from the main thread (detects iPad/touch devices
// that lie about being desktops). Small model = fits Safari's cache quota.
let preferSmallModel = false;

let tts: any = null;
let ready = false;
let loadingPromise: Promise<any> | null = null;
const warmedVoices = new Set<string>();

// Track download progress across files, weighted by file size in bytes so
// the percentage reflects real downloaded bytes (the model file dominates).
const fileBytes = new Map<string, { loaded: number; total: number }>();

function reportProgress() {
  if (fileBytes.size === 0) return;
  let loaded = 0;
  let total = 0;
  for (const v of fileBytes.values()) { loaded += v.loaded; total += v.total; }
  if (total <= 0) return;
  const pct = Math.min(99, Math.round((loaded / total) * 100));
  (self as any).postMessage({ type: 'status', state: 'loading', progress: pct });
}

// Stall detector: any progress event bumps this; if nothing happens for 45s
// during load/warm-up we error out instead of hanging at 99% forever.
let lastProgressTs = Date.now();

function withStallTimeout<T>(p: Promise<T>, stallMs = 45000): Promise<T> {
  lastProgressTs = Date.now();
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setInterval(() => {
      if (done) return;
      if (Date.now() - lastProgressTs > stallMs) {
        done = true;
        clearInterval(timer);
        reject(new Error('Voice engine timed out initializing on this device.'));
      }
    }, 5000);
    p.then(
      (v) => { done = true; clearInterval(timer); resolve(v); },
      (e) => { done = true; clearInterval(timer); reject(e); },
    );
  });
}

function progressCallback(data: any) {
  try {
    lastProgressTs = Date.now();
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

function isMobileUA(): boolean {
  try {
    const ua = (self as any).navigator?.userAgent || '';
    return /iPad|iPhone|iPod|Android/i.test(ua);
  } catch { return false; }
}

async function tryLoad(device: 'webgpu' | 'wasm') {
  console.log('[tts.worker] attempting load on', device);
  // Mobile/tablet WASM: use q4 (~40MB) instead of q8 (~80MB) — half the
  // download AND small enough to survive Safari's Cache Storage quota, so it
  // doesn't get evicted and re-downloaded on every refresh.
  const small = isMobileUA() || preferSmallModel;
  const dtype =
    device === 'webgpu' ? 'fp32' : (small ? 'q4' : 'q8');
  console.log('[tts.worker] dtype:', dtype);
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
        // Some browsers' WebGPU session creation can hang indefinitely after
        // the files are downloaded (UI stuck at 99%). Cap it at 45s, then
        // fall back to WASM which always completes.
        tts = await Promise.race([
          tryLoad('webgpu'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('WebGPU init timed out')), 45000)),
        ]);
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

  if (type === 'config') {
    preferSmallModel = !!event.data.compact;
    return;
  }

  if (type === 'preload') {
    try {
      (self as any).postMessage({ type: 'status', state: 'loading', progress: 0 });
      const model = await load();
      // Download finished — tell the UI we're in the (short) warm-up phase
      // instead of leaving it stuck on a 99% download figure.
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
    } catch (e) {
      console.warn('[tts.worker] warm error:', e);
    }
    return;
  }

  if (type === 'stop') {
    currentSpeakId = null;
    return;
  }

  if (type === 'speak') {
    currentSpeakId = id;
    try {
      if (!ready) (self as any).postMessage({ type: 'status', state: 'loading' });
      const model = await load();
      const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;
      console.log('[tts.worker] speak voice=%s len=%d', v, String(text || '').length);
      if (!ready) {
        ready = true;
        (self as any).postMessage({ type: 'status', state: 'ready', progress: 100 });
      }
      const chunks = splitIntoChunks(String(text || ''));
      console.log('[tts.worker] speaking in %d chunk(s)', chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        if (currentSpeakId !== id) {
          console.log('[tts.worker] speak superseded, aborting:', id);
          return;
        }
        const audio = await model.generate(chunks[i], { voice: v });
        warmedVoices.add(v);
        if (currentSpeakId !== id) return;
        const blob: Blob = audio.toBlob();
        console.log('[tts.worker] chunk %d/%d bytes=%d', i + 1, chunks.length, blob.size);
        (self as any).postMessage({
          type: 'audio-chunk',
          id,
          blob,
          index: i,
          final: i === chunks.length - 1,
        });
      }
    } catch (e: any) {
      console.error('[tts.worker] speak error:', e);
      (self as any).postMessage({ type: 'status', state: 'error', id, message: String(e?.message ?? e) });
    }
    return;
  }
};

/// <reference lib="webworker" />
// Tier 1 — Kokoro (kokoro-js) high-quality voice. Desktop/laptop default.
// Used inside a web worker so the UI never freezes.
//
// Hardening:
//  - WebGPU only if available, else WASM (single-threaded).
//  - 45s timeout on load + warm-up. The orchestrator cascades on error.
//  - "Ready" is gated on a silent warm-up gen succeeding (downloaded != ready).
//  - TTS_CACHE_VERSION lets us invalidate stale browser caches.

import { KokoroTTS, env } from 'kokoro-js';

const TTS_CACHE_VERSION = 'v1';
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';
const LOAD_TIMEOUT_MS = 45_000;

try {
  (env as any).useBrowserCache = true;
  (env as any).allowLocalModels = false;
  (env as any).allowRemoteModels = true;
  (env as any).cacheDir = `kokoro-${TTS_CACHE_VERSION}`;
  if ((env as any).backends?.onnx?.wasm) {
    (env as any).backends.onnx.wasm.numThreads = 1;
  }
} catch { /* ignore */ }

let tts: any = null;
let ready = false;
let loadingPromise: Promise<any> | null = null;
const warmedVoices = new Set<string>();
const fileBytes = new Map<string, { loaded: number; total: number }>();
let currentSpeakId: string | null = null;

function postStatus(state: string, extras: Record<string, unknown> = {}) {
  (self as any).postMessage({ type: 'status', state, ...extras });
}

function reportProgress() {
  if (fileBytes.size === 0) return;
  let loaded = 0, total = 0;
  for (const v of fileBytes.values()) { loaded += v.loaded; total += v.total; }
  if (total <= 0) return;
  // Download portion = 0..90. Reserve 90..99 for warm-up so users see
  // continued movement instead of a "stuck at 95%" stall during warm.
  const pct = Math.min(90, Math.round((loaded / total) * 90));
  postStatus('loading', { progress: pct });
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
  // WebGPU laptops: fp32 (full quality, GPU is fast).
  // CPU/WASM laptops: q4 ≈ 44 MB — roughly half the q8 download (~86 MB) so
  // the one-time setup completes far faster on slower connections.
  const dtype = device === 'webgpu' ? 'fp32' : 'q4';
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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function load() {
  if (tts) return tts;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    if ('gpu' in (navigator as any) && await hasUsableWebGPU()) {
      try {
        tts = await withTimeout(tryLoad('webgpu'), LOAD_TIMEOUT_MS, 'Kokoro WebGPU load');
        return tts;
      } catch (e) {
        console.warn('[kokoro.worker] WebGPU failed, falling back to WASM:', e);
      }
    }
    tts = await withTimeout(tryLoad('wasm'), LOAD_TIMEOUT_MS, 'Kokoro WASM load');
    return tts;
  })().catch((e) => { loadingPromise = null; throw e; });
  return loadingPromise;
}

async function warmVoice(model: any, voice: string) {
  if (warmedVoices.has(voice)) return;
  // Animate progress 92 → 99 during warm-up so the bar keeps moving instead
  // of appearing frozen at 95% while the silent test generation runs.
  postStatus('loading', { progress: 92 });
  let pct = 92;
  const tick = setInterval(() => {
    pct = Math.min(99, pct + 1);
    postStatus('loading', { progress: pct });
  }, 600);
  try {
    // "Ready" gate — a silent generation must succeed, with a timeout.
    await withTimeout(model.generate('ok', { voice }), LOAD_TIMEOUT_MS, 'Kokoro warm-up');
    warmedVoices.add(voice);
  } finally {
    clearInterval(tick);
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

self.onmessage = async (event: MessageEvent) => {
  const { type, id, text, voice } = event.data || {};
  const v = typeof voice === 'string' && voice ? voice : DEFAULT_VOICE;

  if (type === 'preload') {
    try {
      postStatus('loading', { progress: 0 });
      const model = await load();
      await warmVoice(model, v);
      ready = true;
      postStatus('ready', { progress: 100 });
    } catch (e: any) {
      console.error('[kokoro.worker] preload error:', e);
      postStatus('error', { message: String(e?.message ?? e) });
    }
    return;
  }

  if (type === 'warm') {
    try { const model = await load(); await warmVoice(model, v); } catch (e) { console.warn('[kokoro.worker] warm error:', e); }
    return;
  }

  if (type === 'stop') { currentSpeakId = null; return; }

  if (type === 'speak') {
    currentSpeakId = id;
    try {
      if (!ready) postStatus('loading');
      const model = await load();
      if (!ready) {
        await warmVoice(model, v);
        ready = true;
        postStatus('ready', { progress: 100 });
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
      console.error('[kokoro.worker] speak error:', e);
      postStatus('error', { id, message: String(e?.message ?? e) });
    }
  }
};

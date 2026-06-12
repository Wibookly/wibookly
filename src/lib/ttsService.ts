// Read-aloud orchestrator — 3-tier cascading TTS.
//
//   Tier 1  Kokoro      (kokoro-js worker, ~86MB, WAV)
//   Tier 2  KittenTTS   (kitten-tts-js worker, ~25MB INT8 WAV)
//   Tier 3  speechSynth (browser built-in, zero download)
//
// Device detection picks the starting tier; failure / 45s timeout in a model
// tier auto-cascades to the next tier so the user always hears something.
//
// Public API is unchanged: ttsService.{subscribe,getState,speak,stop,preload,warm}.

import { preferredTier } from '@/lib/deviceEngine';

export type TtsModelState = 'idle' | 'loading' | 'ready' | 'error';

type Listener = (s: TtsState) => void;

export interface TtsState {
  modelState: TtsModelState;
  generatingId: string | null;
  playingId: string | null;
  error: string | null;
  progress: number;
  activeTier: 1 | 2 | 3;
}

const state: TtsState = {
  modelState: false ? 'ready' : 'idle',
  generatingId: null,
  playingId: null,
  error: null,
  progress: 0,
  activeTier: preferredTier,
};

const listeners = new Set<Listener>();
function emit() { for (const l of listeners) l({ ...state }); }

function stripForSpeech(text: string) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

// ─────────────────────────────────────────────────────────────
// Shared Web Audio playback (Tier 1 + 2). Singleton AudioContext.
// ─────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctor: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

// MUST be called synchronously from a user gesture on iOS.
function unlockAudioSync() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
}

function stopPlayback() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* ignore */ }
    try { currentSource.disconnect(); } catch { /* ignore */ }
    currentSource.onended = null;
    currentSource = null;
  }
}

async function playPcmBlob(blob: Blob, id: string, onDone: () => void) {
  console.log('TTS tier:', state.activeTier, '| blob bytes:', blob?.size);
  if (!blob || blob.size === 0) { onDone(); return; }
  const ctx = getAudioContext();
  if (!ctx) { onDone(); return; }
  try {
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
    const arrayBuf = await blob.arrayBuffer();
    const audioData: AudioBuffer = await new Promise((resolve, reject) => {
      try {
        const p = ctx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
        if (p && typeof (p as any).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
      } catch (e) { reject(e); }
    });
    stopPlayback();
    const source = ctx.createBufferSource();
    source.buffer = audioData;
    source.connect(ctx.destination);
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      onDone();
    };
    currentSource = source;
    source.start(0);
  } catch (err) {
    console.error('[tts] decode/play failed', err);
    onDone();
  }
}

// ─────────────────────────────────────────────────────────────
// Model-worker driver (used by Tier 1 and Tier 2).
// ─────────────────────────────────────────────────────────────
const CASCADE_TIMEOUT_MS = 45_000;

interface ModelTier {
  tier: 1 | 2;
  worker: Worker | null;
  ready: boolean;
  loadPromise: Promise<void> | null;
  pendingSpeak: { id: string; resolve: () => void; reject: (e: Error) => void } | null;
}

function makeKokoroWorker(): Worker {
  return new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
}
function makeKittenWorker(): Worker {
  return new Worker(new URL('../workers/kitten.worker.ts', import.meta.url), { type: 'module' });
}

const tiers: { 1: ModelTier; 2: ModelTier } = {
  1: { tier: 1, worker: null, ready: false, loadPromise: null, pendingSpeak: null },
  2: { tier: 2, worker: null, ready: false, loadPromise: null, pendingSpeak: null },
};

function ensureWorker(t: 1 | 2): Worker {
  const slot = tiers[t];
  if (slot.worker) return slot.worker;
  const w = t === 1 ? makeKokoroWorker() : makeKittenWorker();
  slot.worker = w;
  w.onerror = (e) => console.error(`[tts] tier ${t} worker error`, e);
  w.onmessage = (event: MessageEvent) => {
    const { type, state: s, blob, message, progress, final, id } = event.data || {};
    if (type === 'status') {
      if (state.activeTier === t) {
        if (s === 'ready') { state.modelState = 'ready'; state.progress = 100; state.error = null; }
        else if (s === 'loading') { state.modelState = 'loading'; if (typeof progress === 'number') state.progress = progress; }
        else if (s === 'error') { state.modelState = 'error'; state.error = message || 'TTS error'; }
        emit();
      }
      if (s === 'ready') slot.ready = true;
      if (s === 'error') {
        slot.ready = false;
        // If we were loading or speaking on this tier, cascade.
        const pend = slot.pendingSpeak;
        slot.pendingSpeak = null;
        if (pend) pend.reject(new Error(message || `tier ${t} error`));
      }
      return;
    }
    if (type === 'audio-chunk' || type === 'audio') {
      const pend = slot.pendingSpeak;
      if (!pend || pend.id !== id) return;
      void playPcmBlob(blob as Blob, id, () => {
        if (state.playingId === id) { state.playingId = null; emit(); }
      });
      if (final !== false) {
        slot.pendingSpeak = null;
        if (state.generatingId === id) {
          state.generatingId = null;
          state.playingId = id;
          emit();
        }
        pend.resolve();
      }
    }
  };
  return w;
}

function preloadTier(t: 1 | 2, voice?: string): Promise<void> {
  const slot = tiers[t];
  if (slot.ready) return Promise.resolve();
  if (slot.loadPromise) return slot.loadPromise;
  const w = ensureWorker(t);
  slot.loadPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      slot.loadPromise = null;
      reject(new Error(`tier ${t} preload timed out`));
    }, CASCADE_TIMEOUT_MS);
    const onMsg = (event: MessageEvent) => {
      const d = event.data || {};
      if (d.type !== 'status') return;
      if (d.state === 'ready') {
        clearTimeout(timer);
        w.removeEventListener('message', onMsg);
        resolve();
      } else if (d.state === 'error') {
        clearTimeout(timer);
        w.removeEventListener('message', onMsg);
        slot.loadPromise = null;
        reject(new Error(d.message || `tier ${t} preload failed`));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'preload', voice });
  });
  return slot.loadPromise;
}

function speakOnTier(t: 1 | 2, text: string, voice: string, id: string): Promise<void> {
  const w = ensureWorker(t);
  const slot = tiers[t];
  return new Promise<void>((resolve, reject) => {
    slot.pendingSpeak = { id, resolve, reject };
    const timer = setTimeout(() => {
      if (slot.pendingSpeak?.id === id) {
        slot.pendingSpeak = null;
        reject(new Error(`tier ${t} speak timed out`));
      }
    }, CASCADE_TIMEOUT_MS);
    const wrap = (fn: () => void) => { clearTimeout(timer); fn(); };
    const orig = slot.pendingSpeak;
    slot.pendingSpeak = {
      id,
      resolve: () => wrap(() => orig.resolve()),
      reject: (e) => wrap(() => orig.reject(e)),
    };
    w.postMessage({ type: 'speak', id, text: stripForSpeech(text), voice });
  });
}

function stopAllWorkers() {
  for (const k of [1, 2] as const) {
    const slot = tiers[k];
    if (slot.worker) { try { slot.worker.postMessage({ type: 'stop' }); } catch { /* ignore */ } }
    slot.pendingSpeak = null;
  }
}

// ─────────────────────────────────────────────────────────────
// Tier 3 — window.speechSynthesis. Must be called SYNCHRONOUSLY
// from the user gesture on iOS — no awaits before .speak().
// ─────────────────────────────────────────────────────────────
function speakTier3(text: string, voice: string, id: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    state.error = 'Speech synthesis is not supported on this device.';
    state.modelState = 'error';
    emit();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(stripForSpeech(text));
    const voices = window.speechSynthesis.getVoices() || [];
    const match =
      voices.find((v) => v.name === voice) ||
      voices.find((v) => v.voiceURI === voice) ||
      voices.find((v) => v.lang?.startsWith('en'));
    if (match) { u.voice = match; u.lang = match.lang; } else { u.lang = 'en-US'; }
    state.activeTier = 3;
    state.modelState = 'ready';
    state.playingId = id;
    state.generatingId = null;
    state.error = null;
    emit();
    u.onend = () => { if (state.playingId === id) { state.playingId = null; emit(); } };
    u.onerror = (ev: any) => {
      console.error('[tts] tier 3 error', ev?.error || ev);
      if (state.playingId === id) state.playingId = null;
      state.error = ev?.error ? `Speech failed: ${ev.error}` : 'Speech failed.';
      emit();
    };
    window.speechSynthesis.speak(u);
  } catch (e: any) {
    console.error('[tts] tier 3 speak failed', e);
    state.error = String(e?.message ?? e);
    state.playingId = null;
    emit();
  }
}

// ─────────────────────────────────────────────────────────────
// Cascade orchestration
// ─────────────────────────────────────────────────────────────
let cascadeBlocked: Record<1 | 2, boolean> = { 1: false, 2: false };

function setActiveTier(t: 1 | 2 | 3) {
  if (state.activeTier !== t) {
    state.activeTier = t;
    console.log('[tts] active tier ->', t);
  }
}

async function speakWithCascade(text: string, voice: string, id: string) {
  // Always pre-unlock audio inside the click gesture.
  unlockAudioSync();

  const order: (1 | 2 | 3)[] = [];
  if (!cascadeBlocked[1] && (preferredTier as number) === 1) order.push(1);
  if (!cascadeBlocked[2]) order.push(2);
  if (!cascadeBlocked[1] && !order.includes(1)) order.push(1);
  order.push(3);

  state.generatingId = id;
  state.playingId = null;
  state.error = null;
  emit();

  for (const t of order) {
    if (t === 3) { speakTier3(text, voice, id); return; }
    try {
      setActiveTier(t);
      if (!tiers[t].ready) {
        state.modelState = 'loading';
        state.progress = 0;
        emit();
        await preloadTier(t, voice);
      } else {
        state.modelState = 'ready';
        emit();
      }
      await speakOnTier(t, text, voice, id);
      return;
    } catch (e: any) {
      console.warn(`[tts] tier ${t} failed, cascading:`, e?.message || e);
      cascadeBlocked[t] = true;
      // continue to next tier
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────
export const ttsService = {
  subscribe(l: Listener) {
    listeners.add(l);
    l({ ...state });
    return () => { listeners.delete(l); };
  },
  getState(): TtsState { return { ...state }; },

  preload(voice?: string) {
    if (false) return;
    // Honor Save-Data on mobile — lazy-load on first click instead.
    try {
      const conn = (navigator as any).connection;
      if (preferredTier === 2 && conn?.saveData) return;
    } catch { /* ignore */ }
    preloadTier(preferredTier, voice).catch((e) => {
      console.warn(`[tts] preferred tier ${preferredTier} preload failed:`, e?.message || e);
      cascadeBlocked[preferredTier] = true;
      // Try the other model tier in the background as well.
      const other: 1 | 2 = (preferredTier as number) === 1 ? 2 : 1;
      if (!cascadeBlocked[other]) {
        preloadTier(other, voice).catch((e2) => {
          console.warn(`[tts] tier ${other} preload also failed:`, e2?.message || e2);
          cascadeBlocked[other] = true;
        });
      }
    });
  },

  warm(voice: string) {
    if (false) return;
    const t = preferredTier;
    if (!tiers[t].worker) return;
    try { tiers[t].worker!.postMessage({ type: 'warm', voice }); } catch { /* ignore */ }
  },

  speak(text: string, voice: string, id: string) {
    stopPlayback();
    stopAllWorkers();
    void speakWithCascade(text, voice, id);
  },

  stop() {
    stopPlayback();
    stopAllWorkers();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    if (state.generatingId || state.playingId) {
      state.generatingId = null;
      state.playingId = null;
      emit();
    }
  },
};

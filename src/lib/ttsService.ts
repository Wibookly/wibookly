// Device-aware TTS service.
//   • Desktop/laptop: uses kokoro-js inside a web worker (high-quality voice).
//   • Mobile/tablet (iOS/Android): uses window.speechSynthesis directly so
//     iPhone/iPad Safari never tries to download/init the 86MB Kokoro model.

import { useKokoroEngine } from '@/lib/deviceEngine';

export type TtsModelState = 'idle' | 'loading' | 'ready' | 'error';

type Listener = (s: TtsState) => void;

export interface TtsState {
  modelState: TtsModelState;
  generatingId: string | null;
  playingId: string | null;
  error: string | null;
  progress: number;
}

const state: TtsState = {
  // Mobile path: speechSynthesis is always available — mark ready up-front
  // so the UI never shows a "downloading voice" indicator.
  modelState: useKokoroEngine ? 'idle' : 'ready',
  generatingId: null,
  playingId: null,
  error: null,
  progress: useKokoroEngine ? 0 : 100,
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

// =============================================================
// Mobile path — window.speechSynthesis (no model, no download)
// =============================================================
const mobile = {
  speak(text: string, voice: string, id: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      state.error = 'Speech synthesis is not supported on this device.';
      emit();
      return;
    }
    try {
      // CRITICAL on iOS Safari: speechSynthesis.speak must be called
      // synchronously inside the user gesture — no awaits before this.
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(stripForSpeech(text));
      const voices = window.speechSynthesis.getVoices() || [];
      // `voice` may be either a SpeechSynthesisVoice .name or .voiceURI.
      const match =
        voices.find((v) => v.name === voice) ||
        voices.find((v) => v.voiceURI === voice) ||
        voices.find((v) => v.lang?.startsWith('en'));
      if (match) {
        u.voice = match;
        u.lang = match.lang;
      } else {
        u.lang = 'en-US';
      }
      u.rate = 1;
      u.pitch = 1;
      state.playingId = id;
      state.generatingId = null;
      state.error = null;
      emit();
      u.onend = () => {
        if (state.playingId === id) { state.playingId = null; emit(); }
      };
      u.onerror = (ev: any) => {
        console.error('[tts] speechSynthesis error', ev?.error || ev);
        if (state.playingId === id) state.playingId = null;
        state.error = ev?.error ? `Speech playback failed: ${ev.error}` : 'Speech playback failed.';
        emit();
      };
      window.speechSynthesis.speak(u);
    } catch (e: any) {
      console.error('[tts] mobile speak failed', e);
      state.error = String(e?.message ?? e);
      state.playingId = null;
      emit();
    }
  },
  stop() {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    if (state.playingId || state.generatingId) {
      state.playingId = null;
      state.generatingId = null;
      emit();
    }
  },
};

// =============================================================
// Desktop path — Kokoro web worker + Web Audio (unchanged engine)
// =============================================================
let worker: Worker | null = null;
let preloadRequested = false;
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

type ChunkQueue = {
  id: string;
  blobs: Blob[];
  final: boolean;
  started: boolean;
  waitingTimer: number | null;
};
let chunkQueue: ChunkQueue | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctor: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

async function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch { /* ignore */ }
  } catch { /* ignore */ }
}

function stopDesktopPlayback() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* ignore */ }
    try { currentSource.disconnect(); } catch { /* ignore */ }
    currentSource.onended = null;
    currentSource = null;
  }
  if (chunkQueue?.waitingTimer) window.clearTimeout(chunkQueue.waitingTimer);
  chunkQueue = null;
}

async function playChunk(blob: Blob, id: string, onDone: () => void) {
  console.log('TTS blob bytes:', blob?.size);
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
    console.error('[tts] decodeAudioData/play failed', err);
    onDone();
  }
}

function playNextChunk() {
  const q = chunkQueue;
  if (!q) return;
  if (q.waitingTimer) { window.clearTimeout(q.waitingTimer); q.waitingTimer = null; }
  if (q.blobs.length === 0) {
    if (q.final) {
      chunkQueue = null;
      if (state.playingId === q.id) { state.playingId = null; emit(); }
      return;
    }
    q.waitingTimer = window.setTimeout(() => {
      if (chunkQueue === q && q.blobs.length === 0) {
        chunkQueue = null;
        if (state.playingId === q.id) { state.playingId = null; emit(); }
      }
    }, 60000);
    return;
  }
  const blob = q.blobs.shift()!;
  void playChunk(blob, q.id, () => { if (chunkQueue === q) playNextChunk(); });
}

function handleIncomingChunk(id: string, blob: Blob, final: boolean) {
  const active = state.generatingId === id || state.playingId === id || chunkQueue?.id === id;
  if (!active) return;
  if (!chunkQueue || chunkQueue.id !== id) {
    chunkQueue = { id, blobs: [], final: false, started: false, waitingTimer: null };
  }
  chunkQueue.blobs.push(blob);
  if (final) chunkQueue.final = true;
  if (!chunkQueue.started) {
    chunkQueue.started = true;
    stopDesktopPlayback();
    chunkQueue = { id, blobs: [blob], final, started: true, waitingTimer: null };
    state.generatingId = null;
    state.playingId = id;
    state.error = null;
    emit();
    playNextChunk();
  } else if (chunkQueue.waitingTimer) {
    playNextChunk();
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const { type, state: s, id, blob, message, progress, final } = event.data || {};
    if (type === 'status') {
      state.modelState = s;
      state.error = message || null;
      if (typeof progress === 'number') state.progress = progress;
      if (s === 'ready') state.progress = 100;
      emit();
      return;
    }
    if (type === 'audio-chunk') { handleIncomingChunk(id, blob as Blob, !!final); return; }
    if (type === 'audio') { handleIncomingChunk(id, blob as Blob, true); return; }
  };
  return worker;
}

const desktop = {
  preload(voice?: string) {
    if (preloadRequested) {
      if (voice && worker) { try { worker.postMessage({ type: 'warm', voice }); } catch { /* ignore */ } }
      return;
    }
    preloadRequested = true;
    try { void (navigator as any).storage?.persist?.(); } catch { /* ignore */ }
    try {
      const w = ensureWorker();
      w.postMessage({ type: 'preload', voice });
    } catch (e: any) {
      console.error('[tts] preload failed', e);
      state.modelState = 'error';
      state.error = String(e?.message ?? e);
      emit();
    }
  },
  warm(voice: string) {
    try { ensureWorker().postMessage({ type: 'warm', voice }); } catch { /* ignore */ }
  },
  speak(text: string, voice: string, id: string) {
    void unlockAudio();
    try {
      const w = ensureWorker();
      stopDesktopPlayback();
      state.generatingId = id;
      state.playingId = null;
      state.error = null;
      emit();
      w.postMessage({ type: 'speak', id, text, voice });
    } catch (e: any) {
      console.error('[tts] desktop speak failed', e);
      state.error = String(e?.message ?? e);
      state.generatingId = null;
      emit();
    }
  },
  stop() {
    stopDesktopPlayback();
    try { worker?.postMessage({ type: 'stop' }); } catch { /* ignore */ }
    if (state.generatingId || state.playingId) {
      state.generatingId = null;
      state.playingId = null;
      emit();
    }
  },
};

// =============================================================
// Public API — routes to the appropriate engine.
// =============================================================
export const ttsService = {
  subscribe(l: Listener) {
    listeners.add(l);
    l({ ...state });
    return () => { listeners.delete(l); };
  },
  getState(): TtsState { return { ...state }; },
  preload(voice?: string) {
    if (!useKokoroEngine) return; // mobile: nothing to preload
    desktop.preload(voice);
  },
  warm(voice: string) {
    if (!useKokoroEngine) return;
    desktop.warm(voice);
  },
  speak(text: string, voice: string, id: string) {
    if (useKokoroEngine) desktop.speak(text, voice, id);
    else mobile.speak(text, voice, id);
  },
  stop() {
    if (useKokoroEngine) desktop.stop();
    else mobile.stop();
  },
};

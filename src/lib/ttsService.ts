// Singleton TTS service backed by a dedicated Web Worker that runs
// Kokoro-82M entirely in the browser. No server, no API keys.

export type TtsModelState = 'idle' | 'loading' | 'ready' | 'error';

type Listener = (s: TtsState) => void;

export interface TtsState {
  modelState: TtsModelState;
  generatingId: string | null;
  playingId: string | null;
  error: string | null;
  progress: number;
}

let worker: Worker | null = null;
let preloadRequested = false;

// Web Audio primary playback
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

// Fallback <audio> element (persistent ref so it isn't GC'd)
let fallbackAudio: HTMLAudioElement | null = null;
let fallbackUrl: string | null = null;

const requestMeta = new Map<string, { text: string; voice: string }>();

const state: TtsState = {
  modelState: 'idle',
  generatingId: null,
  playingId: null,
  error: null,
  progress: 0,
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l({ ...state });
}

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
    console.log('[tts] audioCtx.state before resume:', ctx.state);
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    console.log('[tts] audioCtx.state after resume:', ctx.state);
  } catch (e) {
    console.error('[tts] audioCtx.resume failed', e);
  }
}

function supportsSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function stripForSpeech(text: string) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackToSpeechSynthesis(text: string, id: string, preferredVoice?: string) {
  if (!supportsSpeechSynthesis()) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(stripForSpeech(text));
    utterance.lang = preferredVoice?.startsWith('b') ? 'en-GB' : 'en-US';
    const voices = synth.getVoices?.() || [];
    const wantBritish = utterance.lang === 'en-GB';
    const matchingVoice = voices.find((voice) => {
      const lang = String(voice.lang || '').toLowerCase();
      return wantBritish ? lang.startsWith('en-gb') : lang.startsWith('en-us') || lang.startsWith('en');
    });
    if (matchingVoice) utterance.voice = matchingVoice;

    state.generatingId = null;
    state.playingId = id;
    state.error = null;
    emit();

    utterance.onend = () => {
      requestMeta.delete(id);
      if (state.playingId === id) {
        state.playingId = null;
        emit();
      }
    };
    utterance.onerror = (event: any) => {
      requestMeta.delete(id);
      console.error('[tts] speechSynthesis error:', event?.error || event);
      if (state.playingId === id) state.playingId = null;
      state.error = event?.error ? `Speech playback failed: ${event.error}` : 'Speech playback failed.';
      emit();
    };

    synth.speak(utterance);
    return true;
  } catch (err) {
    console.error('[tts] speechSynthesis fallback failed:', err);
    return false;
  }
}

function stopPlaybackOnly() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* ignore */ }
    try { currentSource.disconnect(); } catch { /* ignore */ }
    currentSource.onended = null;
    currentSource = null;
  }
  if (fallbackAudio) {
    try { fallbackAudio.pause(); } catch { /* ignore */ }
    fallbackAudio.onended = null;
    fallbackAudio.onerror = null;
    try { fallbackAudio.removeAttribute('src'); fallbackAudio.load(); } catch { /* ignore */ }
  }
  if (fallbackUrl) {
    URL.revokeObjectURL(fallbackUrl);
    fallbackUrl = null;
  }
}

function playWithFallbackAudio(blob: Blob, id: string, meta?: { text: string; voice: string }) {
  try {
    if (!fallbackAudio) {
      fallbackAudio = new Audio();
      fallbackAudio.setAttribute('playsinline', 'true');
      fallbackAudio.preload = 'auto';
    }
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    fallbackUrl = URL.createObjectURL(blob);
    fallbackAudio.src = fallbackUrl;
    fallbackAudio.onended = () => {
      requestMeta.delete(id);
      if (fallbackUrl) { URL.revokeObjectURL(fallbackUrl); fallbackUrl = null; }
      if (state.playingId === id) { state.playingId = null; emit(); }
    };
    fallbackAudio.onerror = () => {
      console.error('[tts] fallback <audio> error', fallbackAudio?.error);
      if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
        requestMeta.delete(id);
        state.error = 'Audio playback error.';
        if (state.playingId === id) state.playingId = null;
        emit();
      }
    };
    fallbackAudio.play().catch((err) => {
      console.error('[tts] fallback play() rejected:', err);
      if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
        requestMeta.delete(id);
        state.error = err?.message || 'Audio failed to start.';
        if (state.playingId === id) state.playingId = null;
        emit();
      }
    });
  } catch (e) {
    console.error('[tts] fallback path failed', e);
    if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
      requestMeta.delete(id);
      state.error = 'Audio failed to start.';
      if (state.playingId === id) state.playingId = null;
      emit();
    }
  }
}

async function playBlob(blob: Blob, id: string) {
  const meta = requestMeta.get(id);
  console.log('TTS blob bytes:', blob.size);
  if (!blob || blob.size === 0) {
    if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
      state.error = 'Empty audio from model.';
      if (state.playingId === id) state.playingId = null;
      emit();
    }
    return;
  }

  stopPlaybackOnly();
  state.generatingId = null;
  state.playingId = id;
  emit();

  const ctx = getAudioContext();
  if (!ctx) {
    playWithFallbackAudio(blob, id, meta);
    return;
  }

  try {
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    const arrayBuf = await blob.arrayBuffer();
    const audioData: AudioBuffer = await new Promise((resolve, reject) => {
      // Use callback form for Safari compatibility
      try {
        const p = ctx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
        // Some implementations also return a promise
        if (p && typeof (p as any).then === 'function') {
          (p as Promise<AudioBuffer>).then(resolve, reject);
        }
      } catch (e) {
        reject(e);
      }
    });

    const source = ctx.createBufferSource();
    source.buffer = audioData;
    source.connect(ctx.destination);
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      requestMeta.delete(id);
      if (state.playingId === id) {
        state.playingId = null;
        emit();
      }
    };
    currentSource = source;
    source.start(0);
  } catch (err) {
    console.error('[tts] decodeAudioData/play failed, falling back to <audio>:', err);
    playWithFallbackAudio(blob, id, meta);
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const { type, state: s, id, blob, message, progress } = event.data || {};
    if (type === 'status') {
      state.modelState = s;
      state.error = message || null;
      if (typeof progress === 'number') state.progress = progress;
      if (s === 'ready') state.progress = 100;
      if (s === 'error' && id && state.generatingId === id) {
        const meta = requestMeta.get(id);
        state.generatingId = null;
        if (meta && fallbackToSpeechSynthesis(meta.text, id, meta.voice)) {
          requestMeta.delete(id);
          return;
        }
        requestMeta.delete(id);
      }
      emit();
      return;
    }
    if (type === 'audio') {
      void playBlob(blob as Blob, id);
      return;
    }
  };
  return worker;
}

export const ttsService = {
  subscribe(l: Listener) {
    listeners.add(l);
    l({ ...state });
    return () => { listeners.delete(l); };
  },
  getState(): TtsState { return { ...state }; },
  preload(voice?: string) {
    if (preloadRequested) {
      if (voice && worker) {
        try { worker.postMessage({ type: 'warm', voice }); } catch { /* ignore */ }
      }
      return;
    }
    preloadRequested = true;
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
    try {
      const w = ensureWorker();
      w.postMessage({ type: 'warm', voice });
    } catch { /* ignore */ }
  },
  speak(text: string, voice: string, id: string) {
    try {
      // CRITICAL: unlock the AudioContext synchronously within the user gesture.
      // Kick this off immediately; do not await before posting to worker so
      // we stay inside the gesture activation window.
      void unlockAudio();

      if (supportsSpeechSynthesis()) {
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      }
      const w = ensureWorker();
      stopPlaybackOnly();
      state.generatingId = id;
      state.playingId = null;
      state.error = null;
      emit();
      requestMeta.set(id, { text: stripForSpeech(text), voice });
      w.postMessage({ type: 'speak', id, text, voice });
    } catch (e: any) {
      console.error('[tts] speak failed', e);
      state.error = String(e?.message ?? e);
      state.generatingId = null;
      emit();
    }
  },
  stop() {
    stopPlaybackOnly();
    requestMeta.clear();
    if (supportsSpeechSynthesis()) {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    }
    if (state.generatingId || state.playingId) {
      state.generatingId = null;
      state.playingId = null;
      emit();
    }
  },
};

// Singleton TTS service backed by a dedicated Web Worker that runs
// Kokoro-82M entirely in the browser. No server, no API keys.

export type TtsModelState = 'idle' | 'loading' | 'ready' | 'error';

type Listener = (s: TtsState) => void;

export interface TtsState {
  modelState: TtsModelState;
  generatingId: string | null;
  playingId: string | null;
  error: string | null;
}

let worker: Worker | null = null;
let preloadRequested = false;
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

const state: TtsState = {
  modelState: 'idle',
  generatingId: null,
  playingId: null,
  error: null,
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l({ ...state });
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const { type, state: s, id, blob, message } = event.data || {};
    if (type === 'status') {
      state.modelState = s;
      state.error = message || null;
      if (s === 'error' && id && state.generatingId === id) {
        state.generatingId = null;
      }
      emit();
      return;
    }
    if (type === 'audio') {
      const url = URL.createObjectURL(blob as Blob);
      try { console.log('[tts] blob bytes:', (blob as Blob).size); } catch { /* ignore */ }
      stopAudioOnly();
      currentUrl = url;
      const el = new Audio(url);
      el.setAttribute('playsinline', 'true');
      currentAudio = el;
      state.generatingId = null;
      state.playingId = id;
      emit();
      el.onended = () => {
        if (currentUrl === url) {
          URL.revokeObjectURL(url);
          currentUrl = null;
        }
        if (state.playingId === id) {
          state.playingId = null;
          emit();
        }
        currentAudio = null;
      };
      el.onerror = () => {
        console.error('[tts] <audio> error', el.error);
        state.error = 'Audio playback error.';
        if (state.playingId === id) state.playingId = null;
        emit();
        if (currentUrl === url) {
          URL.revokeObjectURL(url);
          currentUrl = null;
        }
        currentAudio = null;
      };
      el.play().catch((err) => {
        console.error('[tts] play() rejected:', err);
        state.error = err?.message || 'Audio failed to start.';
        if (state.playingId === id) state.playingId = null;
        emit();
      });
      return;
    }
  };
  return worker;
}

function stopAudioOnly() {
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

export const ttsService = {
  subscribe(l: Listener) {
    listeners.add(l);
    l({ ...state });
    return () => { listeners.delete(l); };
  },
  getState(): TtsState { return { ...state }; },
  preload() {
    if (preloadRequested) return;
    preloadRequested = true;
    try {
      const w = ensureWorker();
      w.postMessage({ type: 'preload' });
    } catch (e: any) {
      console.error('[tts] preload failed', e);
      state.modelState = 'error';
      state.error = String(e?.message ?? e);
      emit();
    }
  },
  speak(text: string, voice: string, id: string) {
    try {
      const w = ensureWorker();
      stopAudioOnly();
      state.generatingId = id;
      state.playingId = null;
      state.error = null;
      emit();
      w.postMessage({ type: 'speak', id, text, voice });
    } catch (e: any) {
      console.error('[tts] speak failed', e);
      state.error = String(e?.message ?? e);
      state.generatingId = null;
      emit();
    }
  },
  stop() {
    stopAudioOnly();
    if (state.generatingId || state.playingId) {
      state.generatingId = null;
      state.playingId = null;
      emit();
    }
  },
};

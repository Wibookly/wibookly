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
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

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
        state.generatingId = null;
      }
      emit();
      return;
    }
    if (type === 'audio') {
      const url = URL.createObjectURL(blob as Blob);
      try { console.log('[tts] blob bytes:', (blob as Blob).size); } catch { /* ignore */ }
      // Reuse the <audio> element that was created synchronously during the
      // user's click in speak(). Safari/iPadOS will only allow .play() on an
      // element that was instantiated inside the original user gesture, so we
      // must NOT create a new Audio() here.
      if (currentUrl) {
        try { URL.revokeObjectURL(currentUrl); } catch { /* ignore */ }
      }
      currentUrl = url;
      let el = currentAudio;
      if (!el) {
        // Fallback (no prior gesture-bound element) — will likely be blocked
        // by autoplay policy, but better than nothing.
        el = new Audio();
        el.setAttribute('playsinline', 'true');
        currentAudio = el;
      }
      el.src = url;
      el.playbackRate = 0.92;
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
        console.error('[tts] <audio> error', el!.error);
        state.error = 'Audio playback error.';
        if (state.playingId === id) state.playingId = null;
        emit();
        if (currentUrl === url) {
          URL.revokeObjectURL(url);
          currentUrl = null;
        }
        currentAudio = null;
      };
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          console.error('[tts] play() rejected:', err);
          state.error = err?.message || 'Audio failed to start. Tap Play again.';
          if (state.playingId === id) state.playingId = null;
          emit();
        });
      }
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
  preload(voice?: string) {
    if (preloadRequested) {
      // If a specific voice is requested after initial preload, warm it too.
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

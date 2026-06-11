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
let pendingPlayToken = 0;
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
      if (state.playingId === id) {
        state.playingId = null;
        emit();
      }
    };
    utterance.onerror = (event: any) => {
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
      }
      emit();
      return;
    }
    if (type === 'audio') {
      const meta = id ? requestMeta.get(id) : undefined;
      const url = URL.createObjectURL(blob as Blob);
      try { console.log('[tts] blob bytes:', (blob as Blob).size); } catch { /* ignore */ }
      stopAudioOnly();
      currentUrl = url;
      const el = new Audio(url);
      el.setAttribute('playsinline', 'true');
      el.preload = 'auto';
      currentAudio = el;
      state.generatingId = null;
      state.playingId = id;
      emit();
      const playToken = ++pendingPlayToken;
      let started = false;
      let fallbackTimer: number | null = window.setTimeout(() => {
        if (started || playToken !== pendingPlayToken || currentAudio !== el) return;
        console.warn('[tts] audio did not start in time, falling back to speechSynthesis');
        stopAudioOnly();
        if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
          state.error = 'Audio failed to start.';
          if (state.playingId === id) state.playingId = null;
          emit();
        }
      }, 1800);
      const markStarted = () => {
        started = true;
        if (fallbackTimer != null) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      };
      el.onplaying = markStarted;
      el.oncanplay = () => {
        if (playToken !== pendingPlayToken || currentAudio !== el) return;
        markStarted();
      };
      el.onended = () => {
        markStarted();
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
        markStarted();
        console.error('[tts] <audio> error', el.error);
        stopAudioOnly();
        if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
          state.error = 'Audio playback error.';
          if (state.playingId === id) state.playingId = null;
          emit();
        }
        if (currentUrl === url) {
          URL.revokeObjectURL(url);
          currentUrl = null;
        }
        currentAudio = null;
      };
      el.play().catch((err) => {
        markStarted();
        console.error('[tts] play() rejected:', err);
        stopAudioOnly();
        if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
          state.error = err?.message || 'Audio failed to start.';
          if (state.playingId === id) state.playingId = null;
          emit();
        }
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
  pendingPlayToken += 1;
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
      if (supportsSpeechSynthesis()) {
        try {
          window.speechSynthesis.cancel();
        } catch { /* ignore */ }
      }
      const w = ensureWorker();
      stopAudioOnly();
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
    stopAudioOnly();
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

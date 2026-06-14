// Read-aloud orchestrator — calls the hosted TTS edge function and plays
// decoded audio through one shared AudioContext.

import { toast } from 'sonner';

export type TtsModelState = 'idle' | 'loading' | 'ready' | 'error';

type Listener = (s: TtsState) => void;

export interface TtsState {
  modelState: TtsModelState;
  generatingId: string | null;
  playingId: string | null;
  error: string | null;
  progress: number;
  /** Legacy field — always 1 (server). Kept so existing UI code compiles. */
  activeTier: 1;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const TTS_URL = `${SUPABASE_URL}/functions/v1/tts`;
const FETCH_TIMEOUT_MS = 90_000;

const state: TtsState = {
  modelState: 'ready', // No model to load — always "ready".
  generatingId: null,
  playingId: null,
  error: null,
  progress: 100,
  activeTier: 1,
};

const listeners = new Set<Listener>();
function emit() { for (const l of listeners) l({ ...state }); }

function stripForSpeech(text: string) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

let sharedAudioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let playToken = 0;

function getAudioContext() {
  if (sharedAudioContext) return sharedAudioContext;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('This browser does not support audio playback.');
  sharedAudioContext = new AudioContextCtor();
  return sharedAudioContext;
}

function base64ToUint8Array(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function unlockAudioContext() {
  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  const buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start(0);
}

function stopPlayback() {
  if (currentSource) {
    const source = currentSource;
    currentSource = null;
    try { source.disconnect(); } catch { /* ignore */ }
    try { source.stop(); } catch { /* ignore */ }
  }
}

async function fetchAudioBlob(text: string, voice: string): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ text, voice }),
      signal: controller.signal,
    });
    const raw = await res.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { error: 'Invalid TTS response', detail: raw };
    }
    if (!res.ok) {
      const detail = payload?.detail || payload?.error || 'Unknown TTS error';
      throw new Error(`tts ${res.status}: ${detail}`);
    }
    if (!payload?.audio) {
      throw new Error(payload?.detail || payload?.error || 'TTS response did not include audio.');
    }
    const bytes = base64ToUint8Array(payload.audio);
    return new Blob([bytes], { type: payload.mimeType || 'audio/mpeg' });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('tts timeout');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function playBlob(blob: Blob, token: number) {
  const audioCtx = getAudioContext();
  const buffer = await blob.arrayBuffer();
  const data = await new Promise<AudioBuffer>((res, rej) => {
    const decoded = audioCtx.decodeAudioData(buffer.slice(0), res, rej);
    if (decoded && 'then' in decoded) {
      decoded.then(res).catch(rej);
    }
  });
  if (token !== playToken) return;

  stopPlayback();
  await new Promise<void>((resolve) => {
    const src = audioCtx.createBufferSource();
    src.buffer = data;
    src.connect(audioCtx.destination);
    src.onended = () => {
      try { src.disconnect(); } catch { /* ignore */ }
      if (currentSource === src) currentSource = null;
      resolve();
    };
    currentSource = src;
    src.start(0);
  });
}

export const ttsService = {
  subscribe(l: Listener) { listeners.add(l); l({ ...state }); return () => { listeners.delete(l); }; },
  getState(): TtsState { return { ...state }; },

  /** No-op — kept for API compatibility. Server requires no preload. */
  preload(_voice?: string) { /* no-op */ },
  /** No-op — kept for API compatibility. */
  warm(_voice?: string) { /* no-op */ },

  /** Stop any current playback. */
  stop() {
    playToken += 1;
    stopPlayback();
    if (state.generatingId || state.playingId) {
      state.generatingId = null;
      state.playingId = null;
      state.error = null;
      state.modelState = 'ready';
      emit();
    }
  },

  /**
   * Speak `text`. MUST be called from a user-gesture handler so playback can
   * start on iPhone/iPad. The edge function now does the final markdown cleanup
   * and length limiting before sending to Kokoro.
   */
  async speak(text: string, voice: string, id: string) {
    playToken += 1;
    const token = playToken;
    stopPlayback();
    try {
      await unlockAudioContext();
    } catch (err: any) {
      state.generatingId = null;
      state.playingId = null;
      state.error = String(err?.message ?? err);
      state.modelState = 'error';
      emit();
      return;
    }

    const cleaned = stripForSpeech(text);
    if (!cleaned) return;

    state.generatingId = id;
    state.playingId = null;
    state.error = null;
    state.modelState = 'ready';
    emit();

    try {
      if (token !== playToken) return;
      const blob = await fetchAudioBlob(cleaned, voice);
      console.log('TTS blob bytes:', blob.size);

      if (token !== playToken) return;
      if (state.generatingId === id) {
        state.generatingId = null;
        state.playingId = id;
        emit();
      }

      await playBlob(blob, token);

      if (state.playingId === id) {
        state.playingId = null;
        emit();
      }
    } catch (err: any) {
      console.error('[tts] speak failed', err);
      state.generatingId = null;
      state.playingId = null;
      state.error = String(err?.message ?? err);
      state.modelState = 'error';
      toast.error(state.error || 'Voice playback failed');
      emit();
      setTimeout(() => {
        if (state.modelState === 'error') {
          state.modelState = 'ready';
          state.error = null;
          emit();
        }
      }, 4000);
    }
  },
};

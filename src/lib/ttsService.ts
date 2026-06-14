// Read-aloud orchestrator — calls the hosted TTS edge function and plays
// returned audio with a resilient browser playback strategy.

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
  modelState: 'ready',
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
let currentAudioElement: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let settleCurrentPlayback: (() => void) | null = null;
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

function clearAudioElement() {
  const audio = currentAudioElement;
  const objectUrl = currentObjectUrl;
  currentAudioElement = null;
  currentObjectUrl = null;

  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    try { audio.pause(); } catch { /* ignore */ }
    try {
      audio.removeAttribute('src');
      audio.load();
    } catch { /* ignore */ }
  }

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
}

function stopPlayback() {
  const settle = settleCurrentPlayback;
  settleCurrentPlayback = null;

  if (currentSource) {
    const source = currentSource;
    currentSource = null;
    source.onended = null;
    try { source.stop(0); } catch { /* ignore */ }
    try { source.disconnect(); } catch { /* ignore */ }
  }

  clearAudioElement();
  settle?.();
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

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('audio/')) {
      const directBlob = await res.blob();
      if (!res.ok) throw new Error(`tts ${res.status}: ${res.statusText || 'Audio response failed'}`);
      if (directBlob.size <= 0) throw new Error('TTS returned empty audio.');
      return directBlob;
    }

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

    if (typeof payload?.audio === 'string' && payload.audio.length > 0) {
      const bytes = base64ToUint8Array(payload.audio);
      if (bytes.byteLength <= 0) throw new Error('TTS returned empty audio.');
      return new Blob([bytes], { type: payload.mimeType || 'audio/mpeg' });
    }

    if (payload?.audioBase64) {
      const bytes = base64ToUint8Array(String(payload.audioBase64));
      if (bytes.byteLength <= 0) throw new Error('TTS returned empty audio.');
      return new Blob([bytes], { type: payload.mimeType || payload.contentType || 'audio/mpeg' });
    }

    if (!payload?.audio) {
      throw new Error(payload?.detail || payload?.error || 'TTS response did not include audio.');
    }

    throw new Error('TTS returned audio in an unsupported format.');
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('tts timeout');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatMediaError(error: MediaError | null) {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Audio playback was aborted.';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'A network error interrupted audio playback.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'The browser could not decode the audio.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This browser could not play the audio format.';
    default:
      return 'Unknown audio playback error.';
  }
}

async function playBlobWithAudioContext(blob: Blob, token: number) {
  const audioCtx = getAudioContext();
  await audioCtx.resume();
  const buffer = await blob.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(buffer.slice(0));
  if (token !== playToken) return;

  stopPlayback();
  await new Promise<void>((resolve) => {
    let settled = false;
    const src = audioCtx.createBufferSource();
    const finish = () => {
      if (settled) return;
      settled = true;
      if (settleCurrentPlayback === finish) settleCurrentPlayback = null;
      src.onended = null;
      try { src.disconnect(); } catch { /* ignore */ }
      if (currentSource === src) currentSource = null;
      resolve();
    };

    src.buffer = decoded;
    src.connect(audioCtx.destination);
    src.onended = finish;
    currentSource = src;
    settleCurrentPlayback = finish;
    src.start(0);
  });
}

async function playBlobWithHtmlAudio(blob: Blob, token: number) {
  if (token !== playToken) return;

  stopPlayback();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const audio = new Audio();
    const objectUrl = URL.createObjectURL(blob);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (settleCurrentPlayback === settle) settleCurrentPlayback = null;
      if (currentAudioElement === audio) currentAudioElement = null;
      if (currentObjectUrl === objectUrl) currentObjectUrl = null;

      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch { /* ignore */ }
      URL.revokeObjectURL(objectUrl);

      if (error) reject(error);
      else resolve();
    };

    const settle = () => finish();
    settleCurrentPlayback = settle;
    currentAudioElement = audio;
    currentObjectUrl = objectUrl;

    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.src = objectUrl;
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error(formatMediaError(audio.error)));
    audio.onpause = () => {
      if (token !== playToken) finish();
    };

    void audio.play().catch((err) => {
      finish(new Error(String(err?.message ?? err)));
    });
  });
}

async function playBlob(blob: Blob, token: number, allowAudioContext: boolean) {
  if (allowAudioContext) {
    try {
      await playBlobWithAudioContext(blob, token);
      return;
    } catch (err) {
      console.warn('[tts] Web Audio playback failed, falling back to HTMLAudioElement', err);
    }
  }

  await playBlobWithHtmlAudio(blob, token);
}

export const ttsService = {
  subscribe(l: Listener) { listeners.add(l); l({ ...state }); return () => { listeners.delete(l); }; },
  getState(): TtsState { return { ...state }; },

  preload(_voice?: string) { /* no-op */ },
  warm(_voice?: string) { /* no-op */ },

  stop() {
    playToken += 1;
    stopPlayback();
    if (state.generatingId || state.playingId || state.error) {
      state.generatingId = null;
      state.playingId = null;
      state.error = null;
      state.modelState = 'ready';
      emit();
    }
  },

  async speak(text: string, voice: string, id: string) {
    playToken += 1;
    const token = playToken;
    stopPlayback();

    const cleaned = stripForSpeech(text);
    if (!cleaned) return;

    let audioContextReady = false;
    try {
      await unlockAudioContext();
      audioContextReady = true;
    } catch (err) {
      console.warn('[tts] audio context unlock failed, will use HTML audio fallback', err);
    }

    state.generatingId = id;
    state.playingId = null;
    state.error = null;
    state.modelState = 'loading';
    emit();

    try {
      if (token !== playToken) return;
      const blob = await fetchAudioBlob(cleaned, voice);
      console.log('TTS blob bytes:', blob.size);

      if (token !== playToken) return;
      if (state.generatingId === id) {
        state.generatingId = null;
        state.playingId = id;
        state.modelState = 'ready';
        emit();
      }

      await playBlob(blob, token, audioContextReady);

      if (state.playingId === id) {
        state.playingId = null;
        state.modelState = 'ready';
        emit();
      }
    } catch (err: any) {
      console.error('[tts] speak failed', err);
      state.generatingId = null;
      state.playingId = null;
      state.error = String(err?.message ?? err);
      state.modelState = 'ready';
      toast.error('Voice playback failed', { description: state.error || 'Unknown playback error' });
      emit();
    }
  },
};

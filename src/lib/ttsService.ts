// Read-aloud orchestrator — calls a hosted Kokoro TTS server via the
// `tts` edge function and plays a small MP3 through Web Audio.
//
// No in-browser model. No download. No "preparing voice" step. Works on
// desktop, iPhone and iPad. Public API unchanged so existing callers
// (useKokoroTTS hook, AppLayout, UserAvatarDropdown, useReportClientStatus)
// keep compiling.

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
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

// ─────────────────────────────────────────────────────────────
// Shared AudioContext singleton + iOS unlock.
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

/** MUST be called synchronously inside a user gesture (click). */
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

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decodeAudio(ctx: AudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return await new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && typeof (p as any).then === 'function') {
        (p as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (e) { reject(e); }
  });
}

async function fetchAudioBlob(text: string, voice: string): Promise<Blob> {
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify({ text, voice }),
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !ct.includes('application/json')) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tts ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json() as { audio?: string; mimeType?: string; error?: string; detail?: string };
  if (data.error) throw new Error(`${data.error}${data.detail ? ` — ${data.detail}` : ''}`);
  if (!data.audio) throw new Error('Empty audio response');
  const bytes = base64ToBytes(data.audio);
  return new Blob([bytes], { type: data.mimeType || 'audio/mpeg' });
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
    stopPlayback();
    if (state.generatingId || state.playingId) {
      state.generatingId = null;
      state.playingId = null;
      emit();
    }
  },

  /**
   * Speak `text`. MUST be called from a user-gesture handler so iOS unlocks
   * the AudioContext. Returns once playback has started (or rejects on error).
   */
  speak(text: string, voice: string, id: string) {
    // iOS unlock — synchronous inside the click handler.
    unlockAudioSync();
    stopPlayback();

    const cleaned = stripForSpeech(text);
    if (!cleaned) return;

    state.generatingId = id;
    state.playingId = null;
    state.error = null;
    state.modelState = 'ready';
    emit();

    void (async () => {
      try {
        const blob = await fetchAudioBlob(cleaned, voice);
        console.log('TTS blob bytes:', blob.size);
        if (state.generatingId !== id) return; // stopped or replaced
        const ctx = getAudioContext();
        if (!ctx) throw new Error('Web Audio not supported');
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
        const arrayBuf = await blob.arrayBuffer();
        const audioData = await decodeAudio(ctx, arrayBuf);
        if (state.generatingId !== id) return;

        stopPlayback();
        const source = ctx.createBufferSource();
        source.buffer = audioData;
        source.connect(ctx.destination);
        source.onended = () => {
          if (currentSource === source) currentSource = null;
          if (state.playingId === id) {
            state.playingId = null;
            emit();
          }
        };
        currentSource = source;
        source.start(0);

        state.generatingId = null;
        state.playingId = id;
        emit();
      } catch (err: any) {
        console.error('[tts] speak failed', err);
        state.generatingId = null;
        state.playingId = null;
        state.error = String(err?.message ?? err);
        state.modelState = 'error';
        emit();
        // Auto-recover so the next click tries again.
        setTimeout(() => {
          if (state.modelState === 'error') {
            state.modelState = 'ready';
            state.error = null;
            emit();
          }
        }, 4000);
      }
    })();
  },
};

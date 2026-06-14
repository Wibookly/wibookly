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

const SILENT_AUDIO_DATA_URI = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;

function getOrCreateAudio(): HTMLAudioElement {
  if (currentAudio) return currentAudio;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.setAttribute('webkit-playsinline', '');
  currentAudio = audio;
  return audio;
}

function stopPlayback() {
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio.onended = null;
    currentAudio.onerror = null;
  }
  if (currentAudioUrl) {
    try { URL.revokeObjectURL(currentAudioUrl); } catch { /* ignore */ }
    currentAudioUrl = null;
  }
}

function createPlayableAudio(blob: Blob) {
  const audio = getOrCreateAudio();
  const url = URL.createObjectURL(blob);
  audio.src = url;
  audio.load();
  currentAudioUrl = url;
  return audio;
}

function primeAudioForGestureSync() {
  const audio = getOrCreateAudio();
  audio.muted = true;
  if (!audio.src) {
    audio.src = SILENT_AUDIO_DATA_URI;
    audio.load();
  }
  void audio.play()
    .then(() => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch { /* ignore */ }
    })
    .catch(() => { /* ignore */ });
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
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tts ${res.status}: ${detail.slice(0, 200)}`);
  }
  if (ct.includes('audio/')) {
    return await res.blob();
  }
  const detail = await res.text().catch(() => '');
  throw new Error(`tts returned unexpected content-type ${ct || 'unknown'}: ${detail.slice(0, 200)}`);
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
   * Speak `text`. MUST be called from a user-gesture handler so playback can
   * start on iPhone/iPad. Long replies are split into ~500-char sentence chunks
   * and the resulting MP3s are fetched + played sequentially — the hosted
   * Kokoro server 502s on very long inputs.
   */
  speak(text: string, voice: string, id: string) {
    stopPlayback();
    primeAudioForGestureSync();

    const cleaned = stripForSpeech(text);
    if (!cleaned) return;
    const chunks = splitIntoChunks(cleaned, 500);

    state.generatingId = id;
    state.playingId = null;
    state.error = null;
    state.modelState = 'ready';
    emit();

    void (async () => {
      try {
        let nextBlob: Blob | null = null;
        let nextFetch: Promise<Blob | null> | null = (async () => {
          const blob = await fetchAudioBlob(chunks[0], voice);
          console.log('TTS blob bytes:', blob.size, 'chunk 1/' + chunks.length);
          return blob;
        })();

        for (let i = 0; i < chunks.length; i++) {
          if (state.generatingId !== id && state.playingId !== id) return; // stopped
          nextBlob = await nextFetch;
          // Pre-fetch the next chunk while this one plays.
          nextFetch = i + 1 < chunks.length
            ? (async () => {
                try {
                  const blob = await fetchAudioBlob(chunks[i + 1], voice);
                  console.log('TTS blob bytes:', blob.size, `chunk ${i + 2}/${chunks.length}`);
                  return blob;
                } catch (e) {
                  console.error('[tts] chunk fetch failed', e);
                  return null;
                }
              })()
            : null;

          if (!nextBlob) continue;
          if (state.generatingId !== id && state.playingId !== id) return;

          // Flip to playing state on the first chunk that's ready.
          if (state.generatingId === id) {
            state.generatingId = null;
            state.playingId = id;
            emit();
          }

          await new Promise<void>((resolve, reject) => {
            stopPlayback();
            const audio = createPlayableAudio(nextBlob!);
            audio.muted = false;
            audio.onended = () => {
              resolve();
            };
            audio.onerror = () => {
              reject(new Error('Audio playback failed.'));
            };
            void audio.play().catch((err) => {
              console.error('[tts] audio play failed', err);
              reject(err instanceof Error ? err : new Error(String(err)));
            });
          });

          if (state.playingId !== id) return; // user pressed stop
        }

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

function splitIntoChunks(text: string, maxLen = 500): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [text];
  const chunks: string[] = [];
  let cur = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > maxLen) {
      if (cur) { chunks.push(cur); cur = ''; }
      // Hard-split very long sentences on whitespace.
      let buf = '';
      for (const word of s.split(/\s+/)) {
        if ((buf + ' ' + word).trim().length > maxLen) {
          if (buf) chunks.push(buf);
          buf = word;
        } else {
          buf = buf ? `${buf} ${word}` : word;
        }
      }
      if (buf) chunks.push(buf);
      continue;
    }
    if (cur && (cur.length + s.length + 1) > maxLen) { chunks.push(cur); cur = s; }
    else { cur = cur ? `${cur} ${s}` : s; }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}

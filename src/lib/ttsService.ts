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
const AUDIO_CACHE_PREFIX = 'inboxiq:tts-audio:';
const AUDIO_CACHE_NAME = 'inboxiq-tts-audio-v1';
const AUDIO_CACHE_LIMIT = 24;
const AUDIO_CACHE_INDEX_KEY = `${AUDIO_CACHE_PREFIX}index`;
const BROWSER_SPEECH_LANG = 'en-US';
const BROWSER_SPEECH_START_TIMEOUT_MS = 900;
const BROWSER_SPEECH_HINTS: Record<string, string[]> = {
  af_heart: ['ava', 'samantha', 'allison', 'aria', 'jenny', 'zira', 'female'],
  am_michael: ['alex', 'daniel', 'aaron', 'matthew', 'david', 'andrew', 'brian', 'male'],
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

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
let currentUtterance: SpeechSynthesisUtterance | null = null;
let playToken = 0;
let currentFetchController: AbortController | null = null;
let backgroundFetchController: AbortController | null = null;
let backgroundPreloadRunning = false;
let backgroundPreloadTimer: number | null = null;
const memoryBlobCache = new Map<string, Blob>();
const inFlightAudioRequests = new Map<string, { promise: Promise<Blob>; background: boolean }>();
const queuedPreloadRequests = new Map<string, { text: string; voice: string }>();

function getCacheKey(text: string, voice: string) {
  return `${voice}:${hashString(text)}`;
}

function getStorageKey(cacheKey: string) {
  return `${AUDIO_CACHE_PREFIX}${cacheKey}`;
}

function cloneBlob(blob: Blob) {
  return blob.slice(0, blob.size, blob.type || 'audio/mpeg');
}

function readCacheIndex() {
  try {
    return JSON.parse(localStorage.getItem(AUDIO_CACHE_INDEX_KEY) || '[]') as string[];
  } catch {
    return [];
  }
}

function canUsePersistentCache() {
  return typeof window !== 'undefined' && 'caches' in window;
}

function getPersistentCacheRequest(cacheKey: string) {
  return new Request(`https://tts-cache.local/${encodeURIComponent(cacheKey)}`);
}

async function openPersistentAudioCache() {
  if (!canUsePersistentCache()) return null;
  try {
    return await caches.open(AUDIO_CACHE_NAME);
  } catch {
    return null;
  }
}

async function touchCacheIndex(cacheKey: string) {
  const existing = readCacheIndex();
  const next = [cacheKey, ...existing.filter((item) => item !== cacheKey)].slice(0, AUDIO_CACHE_LIMIT);

  try {
    localStorage.setItem(AUDIO_CACHE_INDEX_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }

  const evicted = existing.filter((item) => !next.includes(item));
  if (!evicted.length) return;

  const cache = await openPersistentAudioCache();
  if (!cache) return;

  await Promise.all(evicted.map((item) => cache.delete(getPersistentCacheRequest(item)).catch(() => false)));
}

function getCachedBlob(cacheKey: string): Blob | null {
  const inMemory = memoryBlobCache.get(cacheKey);
  if (inMemory) return cloneBlob(inMemory);
  return null;
}

async function readBlobFromPersistentCache(cacheKey: string): Promise<Blob | null> {
  const cache = await openPersistentAudioCache();
  if (!cache) return null;

  try {
    const res = await cache.match(getPersistentCacheRequest(cacheKey));
    if (!res?.ok) return null;

    const blob = await res.blob();
    if (blob.size <= 0) {
      await cache.delete(getPersistentCacheRequest(cacheKey));
      return null;
    }

    memoryBlobCache.set(cacheKey, blob);
    void touchCacheIndex(cacheKey);
    return cloneBlob(blob);
  } catch {
    return null;
  }
}

async function storeBlobInCache(cacheKey: string, blob: Blob) {
  memoryBlobCache.set(cacheKey, blob);

  const cache = await openPersistentAudioCache();
  if (!cache) return;

  try {
    await cache.put(
      getPersistentCacheRequest(cacheKey),
      new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'audio/mpeg',
          'Cache-Control': 'private, max-age=2592000, immutable',
        },
      }),
    );
    void touchCacheIndex(cacheKey);
  } catch {
    /* ignore cache write failures */
  }
}

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

function canUseBrowserSpeech() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined';
}

function pickBrowserVoice(preferredVoice: string): SpeechSynthesisVoice | null {
  if (!canUseBrowserSpeech()) return null;

  const hints = BROWSER_SPEECH_HINTS[preferredVoice] ?? [];
  const voices = window.speechSynthesis.getVoices().filter((voice) => {
    const lang = String(voice.lang || '').toLowerCase();
    return lang.startsWith('en-us') && !lang.startsWith('en-gb');
  });

  if (!voices.length) return null;

  const scoreVoice = (voice: SpeechSynthesisVoice) => {
    const name = String(voice.name || '').toLowerCase();
    let score = 0;
    if (voice.default) score += 4;
    if (voice.localService) score += 4;
    if (String(voice.lang || '').toLowerCase() === 'en-us') score += 3;
    if (hints.some((hint) => name.includes(hint))) score += 10;
    return score;
  };

  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] ?? null;
}

function stopSpeechSynthesis() {
  if (!canUseBrowserSpeech()) return;
  currentUtterance = null;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
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
  stopSpeechSynthesis();
  settle?.();
}

function clearBackgroundPreloadTimer() {
  if (backgroundPreloadTimer == null) return;
  window.clearTimeout(backgroundPreloadTimer);
  backgroundPreloadTimer = null;
}

function cancelActiveBackgroundPreload() {
  backgroundFetchController?.abort();
  backgroundFetchController = null;
}

function scheduleBackgroundPreload(delayMs = 900) {
  if (!queuedPreloadRequests.size || backgroundPreloadRunning || backgroundPreloadTimer != null) return;
  backgroundPreloadTimer = window.setTimeout(() => {
    backgroundPreloadTimer = null;
    void processBackgroundPreloadQueue();
  }, delayMs);
}

async function processBackgroundPreloadQueue() {
  if (backgroundPreloadRunning || !queuedPreloadRequests.size) return;
  if (currentFetchController || state.generatingId) {
    scheduleBackgroundPreload(1200);
    return;
  }

  const nextEntry = queuedPreloadRequests.entries().next();
  if (nextEntry.done) return;

  const [cacheKey, job] = nextEntry.value;
  queuedPreloadRequests.delete(cacheKey);
  backgroundPreloadRunning = true;

  try {
    await fetchAudioBlob(job.text, job.voice, { trackAsCurrent: false, background: true });
  } catch (err) {
    if (String((err as Error)?.message ?? err) !== 'tts canceled') {
      console.warn('[tts] background preload failed', err);
    }
  } finally {
    backgroundPreloadRunning = false;
    if (queuedPreloadRequests.size) {
      scheduleBackgroundPreload(500);
    }
  }
}

async function fetchAudioBlob(text: string, voice: string, options?: { trackAsCurrent?: boolean; background?: boolean }): Promise<Blob> {
  const cacheKey = getCacheKey(text, voice);
  const trackAsCurrent = options?.trackAsCurrent !== false;
  const isBackground = options?.background === true;
  const cached = getCachedBlob(cacheKey);
  if (cached) {
    console.log('TTS cache hit (memory):', cacheKey, 'bytes:', cached.size);
    return cached;
  }

  const persistentCached = await readBlobFromPersistentCache(cacheKey);
  if (persistentCached) {
    console.log('TTS cache hit (persistent):', cacheKey, 'bytes:', persistentCached.size);
    return persistentCached;
  }

  const inFlight = inFlightAudioRequests.get(cacheKey);
  if (inFlight && !(trackAsCurrent && inFlight.background)) {
    console.log('TTS awaiting in-flight audio:', cacheKey);
    return inFlight.promise;
  }
  if (trackAsCurrent) {
    currentFetchController?.abort();
  }
  const controller = new AbortController();
  if (trackAsCurrent) {
    currentFetchController = controller;
  }
  if (isBackground) {
    backgroundFetchController = controller;
  }
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const requestPromise = (async () => {
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
      await storeBlobInCache(cacheKey, directBlob);
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
      const blob = new Blob([bytes], { type: payload.mimeType || 'audio/mpeg' });
      await storeBlobInCache(cacheKey, blob);
      return blob;
    }

    if (payload?.audioBase64) {
      const bytes = base64ToUint8Array(String(payload.audioBase64));
      if (bytes.byteLength <= 0) throw new Error('TTS returned empty audio.');
      const blob = new Blob([bytes], { type: payload.mimeType || payload.contentType || 'audio/mpeg' });
      await storeBlobInCache(cacheKey, blob);
      return blob;
    }

    if (!payload?.audio) {
      throw new Error(payload?.detail || payload?.error || 'TTS response did not include audio.');
    }

    throw new Error('TTS returned audio in an unsupported format.');
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      if (trackAsCurrent && currentFetchController === controller) {
        throw new Error('tts timeout');
      }
      throw new Error('tts canceled');
    }
    throw err;
  } finally {
    const activeRequest = inFlightAudioRequests.get(cacheKey);
    if (activeRequest?.promise === requestPromise) {
      inFlightAudioRequests.delete(cacheKey);
    }
    if (trackAsCurrent && currentFetchController === controller) {
      currentFetchController = null;
    }
    if (isBackground && backgroundFetchController === controller) {
      backgroundFetchController = null;
    }
    window.clearTimeout(timeoutId);
  }
  })();

  inFlightAudioRequests.set(cacheKey, { promise: requestPromise, background: isBackground });
  return requestPromise;
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

async function playWithBrowserSpeech(text: string, preferredVoice: string, token: number) {
  if (!canUseBrowserSpeech()) {
    throw new Error('Browser speech synthesis is unavailable.');
  }

  const synthesis = window.speechSynthesis;
  if (!synthesis.getVoices().length) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        synthesis.onvoiceschanged = null;
        resolve();
      };

      synthesis.onvoiceschanged = () => finish();
      window.setTimeout(finish, 250);
    });
  }

  const voice = pickBrowserVoice(preferredVoice);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang || BROWSER_SPEECH_LANG;
  utterance.voice = voice ?? null;
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 0.78;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let started = false;
    const startTimeout = window.setTimeout(() => {
      if (!started) {
        try { synthesis.cancel(); } catch { /* ignore */ }
        finish(new Error('Browser speech did not start in time.'));
      }
    }, BROWSER_SPEECH_START_TIMEOUT_MS);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(startTimeout);
      if (settleCurrentPlayback === settle) settleCurrentPlayback = null;
      if (currentUtterance === utterance) currentUtterance = null;
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
      if (error) reject(error);
      else resolve();
    };

    const settle = () => finish();
    settleCurrentPlayback = settle;
    currentUtterance = utterance;

    utterance.onstart = () => {
      started = true;
    };
    utterance.onend = () => finish();
    utterance.onerror = (event) => {
      const error = event.error && event.error !== 'interrupted' && event.error !== 'canceled'
        ? new Error(`Speech synthesis failed: ${event.error}`)
        : undefined;
      finish(error);
    };

    if (token !== playToken) {
      finish();
      return;
    }

    try {
      synthesis.cancel();
      synthesis.speak(utterance);
    } catch (err) {
      finish(new Error(String((err as Error)?.message ?? err)));
    }
  });
}

export const ttsService = {
  subscribe(l: Listener) { listeners.add(l); l({ ...state }); return () => { listeners.delete(l); }; },
  getState(): TtsState { return { ...state }; },

  preload(text: string, voice?: string) {
    const cleaned = stripForSpeech(text);
    const targetVoice = voice || 'af_heart';
    if (!cleaned) return;

    if (canUseBrowserSpeech()) {
      const synthesis = window.speechSynthesis;
      void synthesis.getVoices();
      return;
    }

    const cacheKey = getCacheKey(cleaned, targetVoice);
    if (getCachedBlob(cacheKey) || inFlightAudioRequests.has(cacheKey)) return;

    queuedPreloadRequests.set(cacheKey, { text: cleaned, voice: targetVoice });
    scheduleBackgroundPreload();
  },
  warm(_voice?: string) { /* no-op */ },

  stop() {
    playToken += 1;
    currentFetchController?.abort();
    currentFetchController = null;
    cancelActiveBackgroundPreload();
    stopPlayback();
    if (state.generatingId || state.playingId || state.error) {
      state.generatingId = null;
      state.playingId = null;
      state.error = null;
      state.modelState = 'ready';
      emit();
    }
    if (queuedPreloadRequests.size) scheduleBackgroundPreload(1200);
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
      if (canUseBrowserSpeech()) {
        try {
          if (token !== playToken) return;
          state.generatingId = null;
          state.playingId = id;
          state.modelState = 'ready';
          emit();

          await playWithBrowserSpeech(cleaned, voice, token);

          if (state.playingId === id) {
            state.playingId = null;
            state.modelState = 'ready';
            emit();
          }
          return;
        } catch (browserSpeechError) {
          console.warn('[tts] browser speech failed, falling back to hosted audio', browserSpeechError);
          if (token !== playToken) return;
          state.generatingId = id;
          state.playingId = null;
          state.modelState = 'loading';
          emit();
        }
      }

      cancelActiveBackgroundPreload();
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
      if (String(err?.message ?? err) === 'tts canceled' || token !== playToken) {
        return;
      }
      console.error('[tts] speak failed', err);
      state.generatingId = null;
      state.playingId = null;
      state.error = String(err?.message ?? err);
      state.modelState = 'ready';
      toast.error('Voice playback failed', { description: state.error || 'Unknown playback error' });
      emit();
    } finally {
      if (queuedPreloadRequests.size) scheduleBackgroundPreload(1500);
    }
  },
};

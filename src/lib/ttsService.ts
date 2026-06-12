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

// Previously we forced mobile browsers onto the device's built-in
// speechSynthesis voices (robotic). Users want the high-quality Kokoro
// voices on phones too, so we now load the model everywhere and only fall
// back to speechSynthesis if the worker truly cannot run.
function isNativeOnlyDevice(): boolean {
  return false;
}

// Web Audio primary playback
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

// Fallback <audio> element (persistent ref so it isn't GC'd)
let fallbackAudio: HTMLAudioElement | null = null;
let fallbackUrl: string | null = null;

// Watchdog timer that bails to speechSynthesis if Kokoro stalls.
let watchdogTimer: number | null = null;

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

function configureAudioSession() {
  // iOS Safari 17+: route Web Audio through the "playback" session so it
  // plays even when the hardware silent (mute) switch is on.
  try {
    const session = (navigator as any).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch { /* ignore */ }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  configureAudioSession();
  if (audioCtx) return audioCtx;
  const Ctor: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

// 44-byte silent WAV used purely to unlock the <audio> element on iOS.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';

async function unlockAudio() {
  // Pre-create + prime the HTMLAudioElement INSIDE the user gesture so iOS
  // Safari permits later .play() calls when worker audio arrives async.
  try {
    if (!fallbackAudio) {
      fallbackAudio = new Audio();
      fallbackAudio.setAttribute('playsinline', 'true');
      fallbackAudio.preload = 'auto';
    }
    // Play a tiny silent clip inside the gesture to unlock the element.
    // IMPORTANT: never mute or pause here — a pending play() promise can
    // resolve later (after the real audio src is set) and would otherwise
    // pause/mute the actual speech mid-playback.
    if (!fallbackAudio.src || fallbackAudio.src.startsWith('data:')) {
      fallbackAudio.muted = false;
      fallbackAudio.src = SILENT_WAV;
      const p = fallbackAudio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }

  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    console.log('[tts] audioCtx.state before resume:', ctx.state);
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // iOS: play a 1-sample silent buffer inside the gesture to fully unlock.
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch { /* ignore */ }
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

// --- Chunked playback queue -------------------------------------------------
// The worker streams sentence-sized audio chunks so playback starts within
// seconds even for long answers on slow (WASM) devices.
type ChunkQueue = {
  id: string;
  blobs: Blob[];
  final: boolean;
  started: boolean;
  waitingTimer: number | null;
};
let chunkQueue: ChunkQueue | null = null;

function clearChunkQueue() {
  if (chunkQueue?.waitingTimer) window.clearTimeout(chunkQueue.waitingTimer);
  chunkQueue = null;
}

function finishRequest(id: string) {
  requestMeta.delete(id);
  clearChunkQueue();
  if (state.playingId === id) {
    state.playingId = null;
    emit();
  }
}

function failToSynthOrError(id: string, meta: { text: string; voice: string } | undefined, errMsg: string) {
  clearChunkQueue();
  if (!fallbackToSpeechSynthesis(meta?.text || '', id, meta?.voice)) {
    requestMeta.delete(id);
    state.error = errMsg;
    if (state.playingId === id) state.playingId = null;
    if (state.generatingId === id) state.generatingId = null;
    emit();
  }
}

function playWithFallbackAudio(blob: Blob, id: string, meta: { text: string; voice: string } | undefined, onDone: () => void) {
  try {
    if (!fallbackAudio) {
      fallbackAudio = new Audio();
      fallbackAudio.setAttribute('playsinline', 'true');
      fallbackAudio.preload = 'auto';
    }
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    fallbackUrl = URL.createObjectURL(blob);
    fallbackAudio.muted = false;
    fallbackAudio.volume = 1;
    fallbackAudio.src = fallbackUrl;
    fallbackAudio.onended = () => {
      if (fallbackUrl) { URL.revokeObjectURL(fallbackUrl); fallbackUrl = null; }
      onDone();
    };
    fallbackAudio.onerror = () => {
      console.error('[tts] fallback <audio> error', fallbackAudio?.error);
      failToSynthOrError(id, meta, 'Audio playback error.');
    };
    fallbackAudio.play().catch((err) => {
      console.error('[tts] fallback play() rejected:', err);
      failToSynthOrError(id, meta, err?.message || 'Audio failed to start.');
    });
  } catch (e) {
    console.error('[tts] fallback path failed', e);
    failToSynthOrError(id, meta, 'Audio failed to start.');
  }
}

async function playChunk(blob: Blob, id: string, onDone: () => void) {
  const meta = requestMeta.get(id);
  console.log('[tts] playing chunk bytes:', blob?.size);
  if (!blob || blob.size === 0) {
    onDone();
    return;
  }

  const ctx = getAudioContext();
  if (!ctx) {
    playWithFallbackAudio(blob, id, meta, onDone);
    return;
  }

  try {
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    if (ctx.state !== 'running') {
      console.warn('[tts] AudioContext not running (%s) — using <audio> fallback', ctx.state);
      playWithFallbackAudio(blob, id, meta, onDone);
      return;
    }
    const arrayBuf = await blob.arrayBuffer();
    const audioData: AudioBuffer = await new Promise((resolve, reject) => {
      try {
        const p = ctx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
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
      onDone();
    };
    currentSource = source;
    source.start(0);
    // Safety net: if the context got suspended right after start (iOS
    // backgrounding / interruption), fall back so the user hears something.
    window.setTimeout(() => {
      if (currentSource === source && ctx.state !== 'running') {
        console.warn('[tts] context suspended after start — falling back to <audio>');
        try { source.stop(); } catch { /* ignore */ }
        source.onended = null;
        currentSource = null;
        playWithFallbackAudio(blob, id, meta, onDone);
      }
    }, 300);
  } catch (err) {
    console.error('[tts] decodeAudioData/play failed, falling back to <audio>:', err);
    playWithFallbackAudio(blob, id, meta, onDone);
  }
}

function playNextChunk() {
  const q = chunkQueue;
  if (!q) return;
  if (q.waitingTimer) { window.clearTimeout(q.waitingTimer); q.waitingTimer = null; }
  if (q.blobs.length === 0) {
    if (q.final) {
      finishRequest(q.id);
      return;
    }
    // Next chunk still generating — wait for it (with a safety cutoff so we
    // never hang forever if the worker dies mid-stream).
    q.waitingTimer = window.setTimeout(() => {
      if (chunkQueue === q && q.blobs.length === 0) {
        console.warn('[tts] next chunk never arrived — finishing playback');
        finishRequest(q.id);
      }
    }, 60000);
    return;
  }
  const blob = q.blobs.shift()!;
  void playChunk(blob, q.id, () => {
    if (chunkQueue === q) playNextChunk();
  });
}

function handleIncomingChunk(id: string, blob: Blob, final: boolean) {
  // Ignore chunks for stale/cancelled requests.
  const active = state.generatingId === id || state.playingId === id || chunkQueue?.id === id;
  if (!active) return;
  if (!chunkQueue || chunkQueue.id !== id) {
    clearChunkQueue();
    chunkQueue = { id, blobs: [], final: false, started: false, waitingTimer: null };
  }
  chunkQueue.blobs.push(blob);
  if (final) chunkQueue.final = true;
  if (!chunkQueue.started) {
    chunkQueue.started = true;
    if (watchdogTimer) { window.clearTimeout(watchdogTimer); watchdogTimer = null; }
    stopPlaybackOnly();
    state.generatingId = null;
    state.playingId = id;
    state.error = null;
    emit();
    playNextChunk();
  } else if (chunkQueue.waitingTimer) {
    // Player was idle waiting on this chunk — kick it.
    playNextChunk();
  }
}

// iPads/tablets report desktop UAs but have touch — they need the smaller
// model so Safari's Cache Storage quota doesn't evict it between refreshes.
function isCompactDevice(): boolean {
  try {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod|Android|Mobile|Tablet/i.test(ua)) return true;
    if ((navigator as any).maxTouchPoints > 1 && /Macintosh/.test(ua)) return true;
  } catch { /* ignore */ }
  return false;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
  try { worker.postMessage({ type: 'config', compact: isCompactDevice() }); } catch { /* ignore */ }
  worker.onmessage = (event: MessageEvent) => {
    const { type, state: s, id, blob, message, progress, final } = event.data || {};
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
    if (type === 'audio-chunk') {
      handleIncomingChunk(id, blob as Blob, !!final);
      return;
    }
    if (type === 'audio') {
      // Legacy single-blob message — treat as one final chunk.
      handleIncomingChunk(id, blob as Blob, true);
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
    // Ask the browser to make our storage persistent so the cached voice
    // model is NOT evicted between sessions (prevents re-downloads).
    try { void (navigator as any).storage?.persist?.(); } catch { /* ignore */ }
    // On iOS/Android: skip the 80MB+ Kokoro download entirely. We use the
    // device's built-in speechSynthesis voices, which are instant.
    if (isNativeOnlyDevice()) {
      state.modelState = supportsSpeechSynthesis() ? 'ready' : 'error';
      state.progress = 100;
      state.error = supportsSpeechSynthesis() ? null : 'No speech synthesis available on this device.';
      emit();
      return;
    }
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
    if (isNativeOnlyDevice()) return;
    try {
      const w = ensureWorker();
      w.postMessage({ type: 'warm', voice });
    } catch { /* ignore */ }
  },
  speak(text: string, voice: string, id: string) {
    try {
      // CRITICAL: unlock the AudioContext synchronously within the user gesture.
      void unlockAudio();

      if (supportsSpeechSynthesis()) {
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      }

      // Mobile Safari / Android: use native speechSynthesis directly — no
      // model download, no WASM, no worker. Plays immediately on tap.
      if (isNativeOnlyDevice()) {
        stopPlaybackOnly();
        requestMeta.set(id, { text: stripForSpeech(text), voice });
        if (!fallbackToSpeechSynthesis(text, id, voice)) {
          state.error = 'Speech is not supported on this device.';
          state.generatingId = null;
          state.playingId = null;
          emit();
        }
        return;
      }

      const w = ensureWorker();
      stopPlaybackOnly();
      clearChunkQueue();
      state.generatingId = id;
      state.playingId = null;
      state.error = null;
      emit();
      requestMeta.set(id, { text: stripForSpeech(text), voice });
      w.postMessage({ type: 'speak', id, text, voice });

      // Watchdog: if Kokoro hasn't produced the FIRST chunk in time (slow or
      // stalled model download/generation), fall back to the device's built-in
      // voice so the user never gets stuck on an endless "loading" spinner.
      // Chunked generation means the first chunk arrives fast once ready.
      if (watchdogTimer) window.clearTimeout(watchdogTimer);
      const timeoutMs = state.modelState === 'ready' ? 30000 : 90000;
      watchdogTimer = window.setTimeout(() => {
        if (state.generatingId !== id) return; // audio arrived or was stopped
        console.warn('[tts] watchdog: Kokoro timed out — falling back to speechSynthesis');
        state.generatingId = null;
        try { w.postMessage({ type: 'stop' }); } catch { /* ignore */ }
        const meta = requestMeta.get(id);
        if (!fallbackToSpeechSynthesis(meta?.text || text, id, meta?.voice || voice)) {
          state.error = 'Speech timed out. Please try again.';
          emit();
        }
      }, timeoutMs);
    } catch (e: any) {
      console.error('[tts] speak failed', e);
      state.error = String(e?.message ?? e);
      state.generatingId = null;
      emit();
    }
  },
  stop() {
    if (watchdogTimer) { window.clearTimeout(watchdogTimer); watchdogTimer = null; }
    clearChunkQueue();
    stopPlaybackOnly();
    requestMeta.clear();
    try { worker?.postMessage({ type: 'stop' }); } catch { /* ignore */ }
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

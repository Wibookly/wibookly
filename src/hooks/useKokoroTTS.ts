import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Free, in-browser TTS powered by Kokoro-82M ONNX via kokoro-js / transformers.js.
 * The model is cached by the browser, but first-time warmup can still take a
 * while, so playback falls back to the browser's native speech instantly while
 * Kokoro finishes preparing in the background.
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// Voice IDs ship with the Kokoro v1.0 model. Prefix conventions:
//   a = American English, b = British English,
//   j = Japanese, z = Mandarin Chinese, e = Spanish,
//   f = French, h = Hindi, i = Italian, p = Brazilian Portuguese
//   f/m after the language letter = female/male
export type KokoroVoiceId = string;

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  language: string; // human-readable group label
}

export const KOKORO_VOICES: KokoroVoiceOption[] = [
  { id: 'af_heart', label: 'Heart', gender: 'female', language: 'English — United States' },
  { id: 'af_alloy', label: 'Alloy', gender: 'female', language: 'English — United States' },
  { id: 'af_aoede', label: 'Aoede', gender: 'female', language: 'English — United States' },
  { id: 'af_bella', label: 'Bella', gender: 'female', language: 'English — United States' },
  { id: 'af_jessica', label: 'Jessica', gender: 'female', language: 'English — United States' },
  { id: 'af_kore', label: 'Kore', gender: 'female', language: 'English — United States' },
  { id: 'af_nicole', label: 'Nicole', gender: 'female', language: 'English — United States' },
  { id: 'af_nova', label: 'Nova', gender: 'female', language: 'English — United States' },
  { id: 'af_river', label: 'River', gender: 'female', language: 'English — United States' },
  { id: 'af_sarah', label: 'Sarah', gender: 'female', language: 'English — United States' },
  { id: 'af_sky', label: 'Sky', gender: 'female', language: 'English — United States' },
  { id: 'am_adam', label: 'Adam', gender: 'male', language: 'English — United States' },
  { id: 'am_echo', label: 'Echo', gender: 'male', language: 'English — United States' },
  { id: 'am_eric', label: 'Eric', gender: 'male', language: 'English — United States' },
  { id: 'am_fenrir', label: 'Fenrir', gender: 'male', language: 'English — United States' },
  { id: 'am_liam', label: 'Liam', gender: 'male', language: 'English — United States' },
  { id: 'am_michael', label: 'Michael', gender: 'male', language: 'English — United States' },
  { id: 'am_onyx', label: 'Onyx', gender: 'male', language: 'English — United States' },
  { id: 'am_puck', label: 'Puck', gender: 'male', language: 'English — United States' },
  { id: 'am_santa', label: 'Santa', gender: 'male', language: 'English — United States' },
  { id: 'bf_alice', label: 'Alice', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_emma', label: 'Emma', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella', label: 'Isabella', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_lily', label: 'Lily', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bm_daniel', label: 'Daniel', gender: 'male', language: 'English — United Kingdom' },
  { id: 'bm_fable', label: 'Fable', gender: 'male', language: 'English — United Kingdom' },
  { id: 'bm_george', label: 'George', gender: 'male', language: 'English — United Kingdom' },
  { id: 'bm_lewis', label: 'Lewis', gender: 'male', language: 'English — United Kingdom' },
];

export const KOKORO_VOICES_BY_LANGUAGE: Record<string, KokoroVoiceOption[]> =
  KOKORO_VOICES.reduce((acc, v) => {
    (acc[v.language] ||= []).push(v);
    return acc;
  }, {} as Record<string, KokoroVoiceOption[]>);

const VOICE_KEY = 'inboxiq:kokoro-voice';
const KOKORO_READY_KEY = 'inboxiq:kokoro-ready';
const DEFAULT_VOICE_ID: KokoroVoiceId = 'af_heart';
const VALID_KOKORO_VOICE_IDS = new Set(KOKORO_VOICES.map((voice) => voice.id));
const FEMALE_VOICE_HINTS = ['samantha', 'victoria', 'karen', 'ava', 'zira', 'aria', 'jenny', 'susan', 'serena', 'female'];
const MALE_VOICE_HINTS = ['alex', 'daniel', 'fred', 'tom', 'david', 'guy', 'mark', 'male'];

function resolveVoiceId(voiceId: string | null | undefined): KokoroVoiceId {
  return voiceId && VALID_KOKORO_VOICE_IDS.has(voiceId) ? voiceId : DEFAULT_VOICE_ID;
}

export function getStoredVoice(): KokoroVoiceId {
  try { return resolveVoiceId(localStorage.getItem(VOICE_KEY)); }
  catch { return DEFAULT_VOICE_ID; }
}

export function setStoredVoice(v: KokoroVoiceId) {
  try { localStorage.setItem(VOICE_KEY, resolveVoiceId(v)); } catch { /* ignore */ }
}

let ttsInstance: any | null = null;
let ttsPromise: Promise<any> | null = null;
const progressListeners = new Set<(pct: number) => void>();
const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WEB_SPEECH_START_TIMEOUT_MS = 1400;
const WEB_SPEECH_CHUNK_SIZE = 260;
const WEB_SPEECH_KEEPALIVE_MS = 10000;

function emitProgress(pct: number) {
  progressListeners.forEach((cb) => cb(pct));
}

async function getTTS(onProgress?: (pct: number) => void) {
  if (onProgress) progressListeners.add(onProgress);
  try {
    if (ttsInstance) {
      onProgress?.(100);
      return ttsInstance;
    }
    if (!ttsPromise) {
      ttsPromise = (async () => {
        const { env } = await import('@huggingface/transformers');
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = 1;
          env.backends.onnx.wasm.proxy = false;
        }
        const { KokoroTTS } = await import('kokoro-js');
        const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p: any) => {
            if (p?.status === 'progress' && typeof p.progress === 'number') {
              emitProgress(Math.round(p.progress));
            }
          },
        });
        ttsInstance = tts;
        try { localStorage.setItem(KOKORO_READY_KEY, '1'); } catch { /* ignore */ }
        emitProgress(100);
        return tts;
      })();
    }
    try {
      return await ttsPromise;
    } catch (error) {
      ttsPromise = null;
      throw error;
    }
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

function supportsKokoroRuntime() {
  return typeof window !== 'undefined' && typeof Audio !== 'undefined';
}

function getVoiceProfile(voiceId: KokoroVoiceId) {
  return KOKORO_VOICES.find((item) => item.id === voiceId) ?? KOKORO_VOICES[0];
}

function hashVoiceId(voiceId: KokoroVoiceId) {
  let hash = 0;
  for (let i = 0; i < voiceId.length; i += 1) {
    hash = ((hash << 5) - hash + voiceId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getFallbackSpeechTuning(voiceId: KokoroVoiceId) {
  const profile = getVoiceProfile(voiceId);
  const hash = hashVoiceId(voiceId);
  const pitchOffset = ((hash % 7) - 3) * 0.045;
  const rateOffset = (((Math.floor(hash / 7) % 5) - 2) * 0.025);
  const basePitch = profile.gender === 'male' ? 0.9 : 1.08;
  const ukRateOffset = profile.language === 'English — United Kingdom' ? -0.03 : 0;

  return {
    pitch: Math.max(0.7, Math.min(1.35, basePitch + pitchOffset)),
    rate: Math.max(0.82, Math.min(1.12, 0.98 + rateOffset + ukRateOffset)),
  };
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function getLanguageHints(voiceId: KokoroVoiceId): string[] {
  const voice = KOKORO_VOICES.find((item) => item.id === voiceId);
  switch (voice?.language) {
    case 'English — United States': return ['en-US', 'en'];
    case 'English — United Kingdom': return ['en-GB', 'en'];
    case 'Japanese': return ['ja-JP', 'ja'];
    case 'Mandarin Chinese': return ['zh-CN', 'zh'];
    case 'Spanish': return ['es-ES', 'es'];
    case 'French': return ['fr-FR', 'fr'];
    case 'Hindi': return ['hi-IN', 'hi'];
    case 'Italian': return ['it-IT', 'it'];
    case 'Portuguese (Brazil)': return ['pt-BR', 'pt'];
    default: return ['en-US', 'en'];
  }
}

function pickBrowserVoice(voiceId: KokoroVoiceId) {
  try {
    window.speechSynthesis?.getVoices?.();
    const voices = window.speechSynthesis?.getVoices?.() ?? [];
    if (!voices.length) return null;
    const profile = getVoiceProfile(voiceId);
    const hints = getLanguageHints(voiceId).map((hint) => hint.toLowerCase());
    const label = profile.label.toLowerCase();
    const preferredGenderHints = profile.gender === 'female' ? FEMALE_VOICE_HINTS : MALE_VOICE_HINTS;
    const regionHints = profile.language === 'English — United Kingdom'
      ? ['uk', 'british', 'england']
      : ['us', 'american', 'united states'];

    const ranked = voices
      .map((voice) => {
        const lang = voice.lang?.toLowerCase() ?? '';
        const name = voice.name?.toLowerCase() ?? '';
        let score = 0;

        if (lang === hints[0]) score += 120;
        else if (hints.some((hint) => lang.startsWith(hint))) score += 80;
        else if (lang.startsWith(hints[0].slice(0, 2))) score += 45;

        if (name.includes(label)) score += 60;
        if (preferredGenderHints.some((hint) => name.includes(hint))) score += 35;
        if (regionHints.some((hint) => name.includes(hint))) score += 20;
        if (voice.default) score += 4;

        return { voice, score };
      })
      .sort((a, b) => b.score - a.score);

    return ranked[0]?.score > 0 ? ranked[0].voice : voices[0] ?? null;
  } catch {
    return null;
  }
}

function splitForBrowserSpeech(text: string) {
  if (text.length <= WEB_SPEECH_CHUNK_SIZE) return [text];

  const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [text];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();
    if (!current || next.length <= WEB_SPEECH_CHUNK_SIZE) {
      current = next;
      continue;
    }

    chunks.push(current);
    current = sentence.trim();
  }

  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function createWebSpeechSession(text: string, voiceId: KokoroVoiceId, onEnd: () => void) {
  const synth = window.speechSynthesis;
  const chunks = splitForBrowserSpeech(text);
  const tuning = getFallbackSpeechTuning(voiceId);
  const matchedVoice = pickBrowserVoice(voiceId);
  const lang = getLanguageHints(voiceId)[0] || 'en-US';
  let chunkIndex = 0;
  let active = true;
  let keepAliveTimer: number | null = null;
  let startTimer: number | null = null;

  const clearTimers = () => {
    if (keepAliveTimer !== null) {
      window.clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    if (startTimer !== null) {
      window.clearTimeout(startTimer);
      startTimer = null;
    }
  };

  const finish = () => {
    if (!active) return;
    active = false;
    clearTimers();
    onEnd();
  };

  const startKeepAlive = () => {
    if (keepAliveTimer !== null) return;
    keepAliveTimer = window.setInterval(() => {
      try {
        if (active && synth?.speaking) synth.resume();
      } catch {
        /* ignore */
      }
    }, WEB_SPEECH_KEEPALIVE_MS);
  };

  const speakChunk = (): boolean => {
    const chunk = chunks[chunkIndex];
    if (!chunk) {
      finish();
      return true;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = tuning.rate;
    utterance.pitch = tuning.pitch;
    utterance.volume = 1;
    utterance.lang = lang;
    if (matchedVoice) utterance.voice = matchedVoice;

    utterance.onstart = () => {
      if (startTimer !== null) {
        window.clearTimeout(startTimer);
        startTimer = null;
      }
      startKeepAlive();
    };

    utterance.onend = () => {
      if (!active) return;
      clearTimers();
      chunkIndex += 1;
      if (chunkIndex >= chunks.length) {
        finish();
        return;
      }
      window.setTimeout(() => {
        if (active) speakChunk();
      }, 0);
    };

    utterance.onerror = () => {
      finish();
    };

    try {
      synth?.resume?.();
      synth?.speak(utterance);
      startTimer = window.setTimeout(() => {
        if (!active) return;
        try {
          synth?.resume?.();
        } catch {
          /* ignore */
        }
      }, WEB_SPEECH_START_TIMEOUT_MS);
      return true;
    } catch {
      finish();
      return false;
    }
  };

  return {
    start() {
      try {
        if (!synth) {
          finish();
          return false;
        }
        synth.getVoices?.();
        synth.cancel();
        synth.resume?.();
        return speakChunk();
      } catch {
        finish();
        return false;
      }
    },
    stop() {
      active = false;
      clearTimers();
      try { synth?.cancel(); } catch { /* ignore */ }
    },
  };
}

async function requestPersistentCache() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
}

export function useKokoroTTS() {
  const fallbackStopRef = useRef<(() => void) | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const requestNonceRef = useRef(0);
  const warmupNoticeShownRef = useRef(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !ttsInstance && !!ttsPromise);
  const [loadProgress, setLoadProgress] = useState<number>(() => {
    try { return localStorage.getItem(KOKORO_READY_KEY) ? 100 : 0; }
    catch { return 0; }
  });

  const cleanupAudioElement = useCallback(() => {
    try {
      const el = audioElementRef.current;
      if (el) {
        el.onended = null;
        el.onerror = null;
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.remove();
      }
    } catch {
      /* ignore */
    } finally {
      audioElementRef.current = null;
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    }
  }, []);

  const stop = useCallback(() => {
    requestNonceRef.current += 1;
    try {
      fallbackStopRef.current?.();
      fallbackStopRef.current = null;
      cleanupAudioElement();
      window.speechSynthesis?.cancel();
    } catch { /* ignore */ }
    setSpeakingId(null);
  }, [cleanupAudioElement]);

  useEffect(() => () => stop(), [stop]);

  const preload = useCallback(async () => {
    if (ttsInstance) {
      setLoadProgress(100);
      return;
    }
    if (!supportsKokoroRuntime()) {
      setLoadProgress(100);
      return;
    }
    try {
      setLoading(true);
      await requestPersistentCache();
      await getTTS((pct) => setLoadProgress(pct));
      setLoadProgress(100);
    } catch (err) {
      console.warn('[kokoro] preload failed (browser voice can still be used):', err);
    } finally {
      setLoading(false);
    }
  }, []);

  async function unlockAudioOutput() {
    if (typeof window === 'undefined') return;
    const el = new Audio(SILENT_WAV_DATA_URL);
    el.preload = 'auto';
    el.muted = true;
    el.setAttribute('playsinline', 'true');
    try {
      await el.play();
    } catch {
      /* ignore */
    } finally {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {
        /* ignore */
      }
    }
  }

  const playWithAudioElement = useCallback(async (
    rawAudio: { toBlob?: () => Blob },
    id: string,
    requestNonce: number,
  ) => {
    if (typeof rawAudio.toBlob !== 'function') {
      throw new Error('Audio blob playback is unavailable');
    }

    const blob = rawAudio.toBlob();
    if (!(blob instanceof Blob)) {
      throw new Error('Generated audio blob is invalid');
    }

    cleanupAudioElement();
    const url = URL.createObjectURL(blob);
    const audioElement = document.createElement('audio');
    audioElement.src = url;
    audioElement.preload = 'auto';
    audioElement.setAttribute('playsinline', 'true');
    audioElement.crossOrigin = 'anonymous';
    audioElement.style.display = 'none';
    document.body.appendChild(audioElement);
    audioElementRef.current = audioElement;
    audioUrlRef.current = url;

    const clear = (shouldResetSpeaking: boolean) => {
      if (audioElementRef.current === audioElement) audioElementRef.current = null;
      if (audioUrlRef.current === url) {
        URL.revokeObjectURL(url);
        audioUrlRef.current = null;
      }
      audioElement.remove();
      if (shouldResetSpeaking && requestNonce === requestNonceRef.current) {
        setSpeakingId((current) => (current === id ? null : current));
      }
    };

    audioElement.onended = () => clear(true);
    audioElement.onerror = () => clear(true);

    try {
      audioElement.load();
      await audioElement.play();
      if (audioElement.paused) {
        throw new Error('Audio remained paused after play()');
      }
    } catch (error) {
      clear(false);
      throw error;
    }
  }, [cleanupAudioElement]);

  const speak = useCallback(async (text: string, id: string) => {
    const clean = cleanForSpeech(text);
    if (!clean) return;

    stop();
    const requestNonce = requestNonceRef.current;
    setSpeakingId(id);
    const selectedVoice = resolveVoiceId(getStoredVoice());
    setStoredVoice(selectedVoice);
    const fallbackSession = createWebSpeechSession(clean, selectedVoice, () => {
      fallbackStopRef.current = null;
      setSpeakingId((current) => (current === id ? null : current));
    });
    fallbackStopRef.current = fallbackSession.stop;
    const startFallbackNow = () => {
      const started = fallbackSession.start();
      if (!started) {
        setSpeakingId(null);
        toast.error('Audio playback failed. Please try again.');
      }
      return started;
    };

    if (!supportsKokoroRuntime()) {
      startFallbackNow();
      return;
    }

    if (!ttsInstance) {
      if (!startFallbackNow()) return;

      const unlockPromise = unlockAudioOutput();
      setLoading(true);

      if (!warmupNoticeShownRef.current) {
        warmupNoticeShownRef.current = true;
        toast('Preparing the selected voice. The first play can take a few seconds.', {
          id: 'kokoro-warmup',
          duration: 2600,
        });
      }

      void (async () => {
        try {
          await requestPersistentCache();
          await unlockPromise;
          await getTTS((pct) => setLoadProgress(pct));
          setLoadProgress(100);
        } catch (err) {
          if (requestNonce !== requestNonceRef.current) return;
          console.warn('[kokoro] background warmup failed (browser voice still active):', err);
        } finally {
          setLoading(false);
        }
      })();

      return;
    }

    try {
      const unlockPromise = unlockAudioOutput();
      setLoading(true);
      await requestPersistentCache();
      await unlockPromise;

      if (!ttsInstance && !warmupNoticeShownRef.current) {
        warmupNoticeShownRef.current = true;
        toast('Preparing the selected voice. The first play can take a few seconds.', {
          id: 'kokoro-warmup',
          duration: 2600,
        });
      }

      const tts = await getTTS((pct) => setLoadProgress(pct));
      setLoadProgress(100);

      let audio;
      try {
        audio = await tts.generate(clean, { voice: selectedVoice });
      } catch (voiceError) {
        if (selectedVoice === DEFAULT_VOICE_ID) throw voiceError;
        const safeVoice = DEFAULT_VOICE_ID;
        setStoredVoice(safeVoice);
        audio = await tts.generate(clean, { voice: safeVoice });
      }

      if (requestNonce !== requestNonceRef.current) {
        return;
      }

      try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
      await playWithAudioElement(audio, id, requestNonce);
    } catch (err) {
      if (requestNonce !== requestNonceRef.current) return;
      console.warn('[tts] falling back to browser voice:', err);
      startFallbackNow();
    } finally {
      setLoading(false);
    }
  }, [playWithAudioElement, stop]);

  return { speak, stop, speakingId, loading, loadProgress, preload };
}

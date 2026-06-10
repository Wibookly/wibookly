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
  { id: 'af_bella', label: 'Bella', gender: 'female', language: 'English — United States' },
  { id: 'af_heart', label: 'Heart', gender: 'female', language: 'English — United States' },
  { id: 'af_nova', label: 'Nova', gender: 'female', language: 'English — United States' },
  { id: 'af_sarah', label: 'Sarah', gender: 'female', language: 'English — United States' },
  { id: 'af_nicole', label: 'Nicole', gender: 'female', language: 'English — United States' },
  { id: 'am_adam', label: 'Adam', gender: 'male', language: 'English — United States' },
  { id: 'am_michael', label: 'Michael', gender: 'male', language: 'English — United States' },
  { id: 'am_onyx', label: 'Onyx', gender: 'male', language: 'English — United States' },
  { id: 'am_echo', label: 'Echo', gender: 'male', language: 'English — United States' },
  { id: 'bf_emma', label: 'Emma', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella', label: 'Isabella', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_alice', label: 'Alice', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bm_george', label: 'George', gender: 'male', language: 'English — United Kingdom' },
  { id: 'bm_lewis', label: 'Lewis', gender: 'male', language: 'English — United Kingdom' },
  { id: 'bm_daniel', label: 'Daniel', gender: 'male', language: 'English — United Kingdom' },
  { id: 'jf_alpha', label: 'Alpha', gender: 'female', language: 'Japanese' },
  { id: 'jm_kumo', label: 'Kumo', gender: 'male', language: 'Japanese' },
  { id: 'zf_xiaobei', label: 'Xiaobei', gender: 'female', language: 'Mandarin Chinese' },
  { id: 'zm_yunjian', label: 'Yunjian', gender: 'male', language: 'Mandarin Chinese' },
  { id: 'ef_dora', label: 'Dora', gender: 'female', language: 'Spanish' },
  { id: 'em_alex', label: 'Alex', gender: 'male', language: 'Spanish' },
  { id: 'ff_siwis', label: 'Siwis', gender: 'female', language: 'French' },
  { id: 'hf_alpha', label: 'Alpha', gender: 'female', language: 'Hindi' },
  { id: 'hm_omega', label: 'Omega', gender: 'male', language: 'Hindi' },
  { id: 'if_sara', label: 'Sara', gender: 'female', language: 'Italian' },
  { id: 'im_nicola', label: 'Nicola', gender: 'male', language: 'Italian' },
  { id: 'pf_dora', label: 'Dora', gender: 'female', language: 'Portuguese (Brazil)' },
  { id: 'pm_alex', label: 'Alex', gender: 'male', language: 'Portuguese (Brazil)' },
];

export const KOKORO_VOICES_BY_LANGUAGE: Record<string, KokoroVoiceOption[]> =
  KOKORO_VOICES.reduce((acc, v) => {
    (acc[v.language] ||= []).push(v);
    return acc;
  }, {} as Record<string, KokoroVoiceOption[]>);

const VOICE_KEY = 'inboxiq:kokoro-voice';
const KOKORO_READY_KEY = 'inboxiq:kokoro-ready';

export function getStoredVoice(): KokoroVoiceId {
  try { return (localStorage.getItem(VOICE_KEY) as KokoroVoiceId) || 'af_bella'; }
  catch { return 'af_bella'; }
}

export function setStoredVoice(v: KokoroVoiceId) {
  try { localStorage.setItem(VOICE_KEY, v); } catch { /* ignore */ }
}

let ttsInstance: any | null = null;
let ttsPromise: Promise<any> | null = null;
let sharedAudioContext: AudioContext | null = null;
const progressListeners = new Set<(pct: number) => void>();

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
    return await ttsPromise;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
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
    const voices = window.speechSynthesis?.getVoices?.() ?? [];
    if (!voices.length) return null;
    const hints = getLanguageHints(voiceId).map((hint) => hint.toLowerCase());
    return voices.find((voice) => hints.some((hint) => voice.lang?.toLowerCase().startsWith(hint)))
      ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith(hints[0].slice(0, 2)))
      ?? voices[0]
      ?? null;
  } catch {
    return null;
  }
}

function createWebSpeechSession(text: string, voiceId: KokoroVoiceId, onEnd: () => void) {
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.lang = getLanguageHints(voiceId)[0] || 'en-US';
  const matchedVoice = pickBrowserVoice(voiceId);
  if (matchedVoice) utterance.voice = matchedVoice;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;

  return {
    start() {
      try {
        if (!synth) {
          onEnd();
          return false;
        }
        synth.cancel();
        synth.speak(utterance);
        return true;
      } catch {
        onEnd();
        return false;
      }
    },
    stop() {
      try { synth?.cancel(); } catch { /* ignore */ }
    },
  };
}

async function ensureAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextCtor();
  }
  if (sharedAudioContext.state === 'suspended') {
    await sharedAudioContext.resume();
  }
  return sharedAudioContext;
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
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fallbackStopRef = useRef<(() => void) | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const warmupNoticeShownRef = useRef(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !ttsInstance && !!ttsPromise);
  const [loadProgress, setLoadProgress] = useState<number>(() => {
    try { return localStorage.getItem(KOKORO_READY_KEY) ? 100 : 0; }
    catch { return 0; }
  });

  const stop = useCallback(() => {
    try {
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      fallbackStopRef.current?.();
      fallbackStopRef.current = null;
      sourceRef.current?.stop();
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      window.speechSynthesis?.cancel();
    } catch { /* ignore */ }
    setSpeakingId(null);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const preload = useCallback(async () => {
    if (ttsInstance) {
      setLoadProgress(100);
      return;
    }
    try {
      setLoading(true);
      await requestPersistentCache();
      await getTTS((pct) => setLoadProgress(pct));
      setLoadProgress(100);
    } catch (err) {
      console.warn('[kokoro] preload failed (instant browser voice will still work):', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const speak = useCallback(async (text: string, id: string) => {
    const clean = cleanForSpeech(text);
    if (!clean) return;

    stop();
    setSpeakingId(id);
    const selectedVoice = getStoredVoice();
    const fallbackSession = createWebSpeechSession(clean, selectedVoice, () => {
      fallbackStopRef.current = null;
      setSpeakingId((current) => (current === id ? null : current));
    });
    fallbackStopRef.current = fallbackSession.stop;

    if (!ttsInstance) {
      void preload();
      if (!warmupNoticeShownRef.current) {
        warmupNoticeShownRef.current = true;
        toast('Playing instantly while the studio voice finishes preparing.', {
          id: 'kokoro-warmup',
          duration: 2600,
        });
      }
      fallbackSession.start();
      return;
    }

    try {
      const audioContext = await ensureAudioContext();
      let fallbackStarted = false;
      fallbackTimerRef.current = window.setTimeout(() => {
        fallbackTimerRef.current = null;
        fallbackStarted = fallbackSession.start();
      }, 450);

      const tts = await getTTS((pct) => setLoadProgress(pct));
      const audio = await tts.generate(clean, { voice: selectedVoice });
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (fallbackStarted || !audioContext) {
        return;
      }
      const blob: Blob = typeof audio.toBlob === 'function'
        ? audio.toBlob()
        : new Blob([audio], { type: 'audio/wav' });
      const audioBuffer = await audioContext.decodeAudioData((await blob.arrayBuffer()).slice(0));
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      sourceRef.current = source;
      source.onended = () => {
        source.disconnect();
        if (sourceRef.current === source) {
          sourceRef.current = null;
        }
        setSpeakingId((current) => (current === id ? null : current));
      };
      source.start(0);
    } catch (err) {
      console.warn('[kokoro] falling back to Web Speech:', err);
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      fallbackSession.start();
    }
  }, [preload, stop]);

  return { speak, stop, speakingId, loading, loadProgress, preload };
}

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
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
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

function createAudioBufferFromRawAudio(
  audioContext: AudioContext,
  rawAudio: { audio?: Float32Array; sampling_rate?: number },
) {
  if (!(rawAudio.audio instanceof Float32Array) || !rawAudio.audio.length) return null;
  const sampleRate = Number(rawAudio.sampling_rate) || 24000;
  const buffer = audioContext.createBuffer(1, rawAudio.audio.length, sampleRate);
  buffer.copyToChannel(new Float32Array(rawAudio.audio), 0, 0);
  return buffer;
}

export function useKokoroTTS() {
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fallbackStopRef = useRef<(() => void) | null>(null);
  const requestNonceRef = useRef(0);
  const warmupNoticeShownRef = useRef(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !ttsInstance && !!ttsPromise);
  const [loadProgress, setLoadProgress] = useState<number>(() => {
    try { return localStorage.getItem(KOKORO_READY_KEY) ? 100 : 0; }
    catch { return 0; }
  });

  const stop = useCallback(() => {
    requestNonceRef.current += 1;
    try {
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

  async function unlockAudioOutput(audioContext: AudioContext) {
    const buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate || 24000);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start(0);
    await new Promise<void>((resolve) => {
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        resolve();
      };
    });
  }

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
      if (!audioContext) {
        fallbackSession.start();
        return;
      }
      await unlockAudioOutput(audioContext);

      const tts = await getTTS((pct) => setLoadProgress(pct));
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
      const audioBuffer = createAudioBufferFromRawAudio(audioContext, audio)
        ?? await (async () => {
          const blob: Blob = typeof audio.toBlob === 'function'
            ? audio.toBlob()
            : new Blob([audio], { type: 'audio/wav' });
          return await audioContext.decodeAudioData((await blob.arrayBuffer()).slice(0));
        })();
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
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      source.start(0);
    } catch (err) {
      if (requestNonce !== requestNonceRef.current) return;
      console.warn('[tts] falling back to browser voice:', err);
      fallbackSession.start();
    }
  }, [preload, stop]);

  return { speak, stop, speakingId, loading, loadProgress, preload };
}

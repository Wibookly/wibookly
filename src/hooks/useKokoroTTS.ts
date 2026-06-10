import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Free, in-browser TTS powered by Kokoro-82M ONNX via kokoro-js / transformers.js.
 * Model (~80 MB quantized) is downloaded once on first use and cached by the
 * browser. Falls back to the Web Speech API if Kokoro fails to load.
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
  // English — United States
  { id: 'af_bella',    label: 'Bella',    gender: 'female', language: 'English — United States' },
  { id: 'af_heart',    label: 'Heart',    gender: 'female', language: 'English — United States' },
  { id: 'af_nova',     label: 'Nova',     gender: 'female', language: 'English — United States' },
  { id: 'af_sarah',    label: 'Sarah',    gender: 'female', language: 'English — United States' },
  { id: 'af_nicole',   label: 'Nicole',   gender: 'female', language: 'English — United States' },
  { id: 'am_adam',     label: 'Adam',     gender: 'male',   language: 'English — United States' },
  { id: 'am_michael',  label: 'Michael',  gender: 'male',   language: 'English — United States' },
  { id: 'am_onyx',     label: 'Onyx',     gender: 'male',   language: 'English — United States' },
  { id: 'am_echo',     label: 'Echo',     gender: 'male',   language: 'English — United States' },
  // English — United Kingdom
  { id: 'bf_emma',     label: 'Emma',     gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella', label: 'Isabella', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_alice',    label: 'Alice',    gender: 'female', language: 'English — United Kingdom' },
  { id: 'bm_george',   label: 'George',   gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_lewis',    label: 'Lewis',    gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_daniel',   label: 'Daniel',   gender: 'male',   language: 'English — United Kingdom' },
  // Other languages (Kokoro v1 multilingual — falls back to browser voice if unavailable)
  { id: 'jf_alpha',    label: 'Alpha',    gender: 'female', language: 'Japanese' },
  { id: 'jm_kumo',     label: 'Kumo',     gender: 'male',   language: 'Japanese' },
  { id: 'zf_xiaobei',  label: 'Xiaobei',  gender: 'female', language: 'Mandarin Chinese' },
  { id: 'zm_yunjian',  label: 'Yunjian',  gender: 'male',   language: 'Mandarin Chinese' },
  { id: 'ef_dora',     label: 'Dora',     gender: 'female', language: 'Spanish' },
  { id: 'em_alex',     label: 'Alex',     gender: 'male',   language: 'Spanish' },
  { id: 'ff_siwis',    label: 'Siwis',    gender: 'female', language: 'French' },
  { id: 'hf_alpha',    label: 'Alpha',    gender: 'female', language: 'Hindi' },
  { id: 'hm_omega',    label: 'Omega',    gender: 'male',   language: 'Hindi' },
  { id: 'if_sara',     label: 'Sara',     gender: 'female', language: 'Italian' },
  { id: 'im_nicola',   label: 'Nicola',   gender: 'male',   language: 'Italian' },
  { id: 'pf_dora',     label: 'Dora',     gender: 'female', language: 'Portuguese (Brazil)' },
  { id: 'pm_alex',     label: 'Alex',     gender: 'male',   language: 'Portuguese (Brazil)' },
];

// Grouped helper for nicer dropdowns: { 'English — US': [...], ... }
export const KOKORO_VOICES_BY_LANGUAGE: Record<string, KokoroVoiceOption[]> =
  KOKORO_VOICES.reduce((acc, v) => {
    (acc[v.language] ||= []).push(v);
    return acc;
  }, {} as Record<string, KokoroVoiceOption[]>);

const VOICE_KEY = 'inboxiq:kokoro-voice';
export function getStoredVoice(): KokoroVoiceId {
  try { return (localStorage.getItem(VOICE_KEY) as KokoroVoiceId) || 'af_bella'; }
  catch { return 'af_bella'; }
}
export function setStoredVoice(v: KokoroVoiceId) {
  try { localStorage.setItem(VOICE_KEY, v); } catch { /* ignore */ }
}

// Lazy singleton — only one model instance per tab.
let ttsPromise: Promise<any> | null = null;
async function getTTS(onProgress?: (pct: number) => void) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && typeof p.progress === 'number') {
            onProgress?.(Math.round(p.progress));
          }
        },
      });
    })();
  }
  return ttsPromise;
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

function webSpeechFallback(text: string, onEnd: () => void) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) { onEnd(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    u.onend = onEnd; u.onerror = onEnd;
    synth.speak(u);
  } catch { onEnd(); }
}

export function useKokoroTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  const stop = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      window.speechSynthesis?.cancel();
    } catch { /* ignore */ }
    setSpeakingId(null);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const speak = useCallback(async (text: string, id: string) => {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    stop();
    setSpeakingId(id);

    try {
      setLoading(true);
      const tts = await getTTS((pct) => setLoadProgress(pct));
      setLoading(false);

      const voice = getStoredVoice();
      const audio = await tts.generate(clean, { voice });
      // kokoro-js RawAudio → wav blob
      const blob: Blob = typeof audio.toBlob === 'function'
        ? audio.toBlob()
        : new Blob([audio], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => { URL.revokeObjectURL(url); setSpeakingId(null); audioRef.current = null; };
      el.onerror = () => { URL.revokeObjectURL(url); setSpeakingId(null); audioRef.current = null; };
      await el.play();
    } catch (err) {
      console.warn('[kokoro] falling back to Web Speech:', err);
      setLoading(false);
      webSpeechFallback(clean, () => setSpeakingId(null));
    }
  }, [stop]);

  // Background preload — kick off the ~80MB model download as soon as the
  // chat surface mounts so the first click on "play" feels instant.
  const preload = useCallback(async () => {
    try {
      setLoading(true);
      await getTTS((pct) => setLoadProgress(pct));
    } catch (err) {
      console.warn('[kokoro] preload failed (will fall back to Web Speech):', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { speak, stop, speakingId, loading, loadProgress, preload };
}

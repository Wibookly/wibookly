import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Free, in-browser TTS powered by Kokoro-82M ONNX via kokoro-js / transformers.js.
 * Model (~80 MB quantized) is downloaded once on first use and cached by the
 * browser. Falls back to the Web Speech API if Kokoro fails to load.
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// Stable, popular voices shipped with Kokoro v1.
export type KokoroVoiceId =
  | 'af_bella' | 'af_heart' | 'af_nova' | 'af_sarah'
  | 'am_adam' | 'am_michael' | 'am_onyx'
  | 'bf_emma' | 'bf_isabella'
  | 'bm_george' | 'bm_lewis';

export const KOKORO_VOICES: { id: KokoroVoiceId; label: string }[] = [
  { id: 'af_bella',     label: 'Bella (US Female)' },
  { id: 'af_heart',     label: 'Heart (US Female)' },
  { id: 'af_nova',      label: 'Nova (US Female)' },
  { id: 'af_sarah',     label: 'Sarah (US Female)' },
  { id: 'am_adam',      label: 'Adam (US Male)' },
  { id: 'am_michael',   label: 'Michael (US Male)' },
  { id: 'am_onyx',      label: 'Onyx (US Male)' },
  { id: 'bf_emma',      label: 'Emma (UK Female)' },
  { id: 'bf_isabella',  label: 'Isabella (UK Female)' },
  { id: 'bm_george',    label: 'George (UK Male)' },
  { id: 'bm_lewis',     label: 'Lewis (UK Male)' },
];

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

  return { speak, stop, speakingId, loading, loadProgress };
}

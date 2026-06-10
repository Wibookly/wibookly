import { useCallback, useEffect, useState } from 'react';
import { ttsService, type TtsState } from '@/lib/ttsService';

/**
 * Read-aloud hook backed by 100% in-browser Kokoro-82M TTS.
 * The actual model runs inside a singleton Web Worker (src/workers/tts.worker.ts).
 * No server, no API key — preloaded once after sign-in and cached by the browser.
 */

export type KokoroVoiceId = string;

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  language: string;
}

// Verified Kokoro voice IDs.
export const KOKORO_VOICES: KokoroVoiceOption[] = [
  // American Female
  { id: 'af_heart',    label: 'Heart (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_bella',    label: 'Bella (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_nicole',   label: 'Nicole (American Female)',  gender: 'female', language: 'English — United States' },
  { id: 'af_sarah',    label: 'Sarah (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_nova',     label: 'Nova (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_sky',      label: 'Sky (American Female)',     gender: 'female', language: 'English — United States' },
  { id: 'af_aoede',    label: 'Aoede (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_kore',     label: 'Kore (American Female)',    gender: 'female', language: 'English — United States' },
  // American Male
  { id: 'am_adam',     label: 'Adam (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_michael',  label: 'Michael (American Male)',   gender: 'male',   language: 'English — United States' },
  { id: 'am_onyx',     label: 'Onyx (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_echo',     label: 'Echo (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_eric',     label: 'Eric (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_liam',     label: 'Liam (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_puck',     label: 'Puck (American Male)',      gender: 'male',   language: 'English — United States' },
  // British Female
  { id: 'bf_emma',     label: 'Emma (British Female)',     gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella', label: 'Isabella (British Female)', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_alice',    label: 'Alice (British Female)',    gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_lily',     label: 'Lily (British Female)',     gender: 'female', language: 'English — United Kingdom' },
  // British Male
  { id: 'bm_george',   label: 'George (British Male)',     gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_lewis',    label: 'Lewis (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_daniel',   label: 'Daniel (British Male)',     gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_fable',    label: 'Fable (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
];

export const KOKORO_VOICES_BY_LANGUAGE: Record<string, KokoroVoiceOption[]> =
  KOKORO_VOICES.reduce((acc, v) => {
    (acc[v.language] ||= []).push(v);
    return acc;
  }, {} as Record<string, KokoroVoiceOption[]>);

const VOICE_KEY = 'inboxiq:kokoro-voice';
const DEFAULT_VOICE_ID: KokoroVoiceId = 'af_heart';
const VALID = new Set(KOKORO_VOICES.map((v) => v.id));

function resolveVoiceId(v: string | null | undefined): KokoroVoiceId {
  return v && VALID.has(v) ? v : DEFAULT_VOICE_ID;
}

export function getStoredVoice(): KokoroVoiceId {
  try { return resolveVoiceId(localStorage.getItem(VOICE_KEY)); }
  catch { return DEFAULT_VOICE_ID; }
}

export function setStoredVoice(v: KokoroVoiceId) {
  try { localStorage.setItem(VOICE_KEY, resolveVoiceId(v)); } catch { /* ignore */ }
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

export function useKokoroTTS() {
  const [snap, setSnap] = useState<TtsState>(() => ttsService.getState());

  useEffect(() => ttsService.subscribe(setSnap), []);

  const speak = useCallback((text: string, id: string) => {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    const voice = resolveVoiceId(getStoredVoice());
    setStoredVoice(voice);
    ttsService.speak(clean, voice, id);
  }, []);

  const stop = useCallback(() => ttsService.stop(), []);
  const preload = useCallback(() => ttsService.preload(), []);

  const speakingId = snap.playingId ?? snap.generatingId;
  const loading = snap.modelState === 'loading' || !!snap.generatingId;
  const loadProgress = snap.modelState === 'ready' ? 100 : snap.modelState === 'loading' ? 50 : 0;

  return { speak, stop, speakingId, loading, loadProgress, preload, modelState: snap.modelState };
}

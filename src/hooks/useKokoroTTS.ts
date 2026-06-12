import { useCallback, useEffect, useState } from 'react';
import { ttsService, type TtsState } from '@/lib/ttsService';

/**
 * Read-aloud hook backed by the server-side `tts` edge function (Kokoro
 * OpenAI-compatible endpoint). No in-browser model — works the same on
 * desktop and iPhone/iPad Safari.
 */

export type KokoroVoiceId = string;

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  language: string;
}

export const KOKORO_VOICES: KokoroVoiceOption[] = [
  { id: 'af_heart',    label: 'Heart (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_bella',    label: 'Bella (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_nicole',   label: 'Nicole (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_sarah',    label: 'Sarah (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'am_adam',     label: 'Adam (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_michael',  label: 'Michael (American Male)',    gender: 'male',   language: 'English — United States' },
  { id: 'am_onyx',     label: 'Onyx (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'bf_emma',     label: 'Emma (British Female)',      gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella', label: 'Isabella (British Female)',  gender: 'female', language: 'English — United Kingdom' },
  { id: 'bm_george',   label: 'George (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_lewis',    label: 'Lewis (British Male)',       gender: 'male',   language: 'English — United Kingdom' },
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
  const resolved = resolveVoiceId(v);
  try { localStorage.setItem(VOICE_KEY, resolved); } catch { /* ignore */ }
}

export function useKokoroTTS() {
  const [snap, setSnap] = useState<TtsState>(() => ttsService.getState());

  useEffect(() => ttsService.subscribe(setSnap), []);

  const speak = useCallback((text: string, id: string) => {
    const voice = resolveVoiceId(getStoredVoice());
    setStoredVoice(voice);
    void ttsService.speak(text, voice, id);
  }, []);

  const stop = useCallback(() => ttsService.stop(), []);
  const preload = useCallback(() => { /* no-op for server-side TTS */ }, []);

  const speakingId = snap.playingId ?? snap.generatingId;
  const loading = !!snap.generatingId;
  const loadProgress = 100;

  return {
    speak,
    stop,
    speakingId,
    loading,
    loadProgress,
    preload,
    modelState: snap.modelState,
    error: snap.error,
  };
}

import { useCallback, useEffect, useState } from 'react';
import { ttsService, type TtsState } from '@/lib/ttsService';

/**
 * Read-aloud hook. The actual TTS now runs on a hosted Kokoro server
 * (see `supabase/functions/tts`). Every device just fetches a small MP3
 * and plays it — no in-browser model, no download.
 */

export type KokoroVoiceId = string;

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  language: string;
}

const SERVER_VOICES: KokoroVoiceOption[] = [
  // American Female
  { id: 'af_heart',   label: 'Heart (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_bella',   label: 'Bella (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_nicole',  label: 'Nicole (American Female)',  gender: 'female', language: 'English — United States' },
  { id: 'af_sarah',   label: 'Sarah (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_nova',    label: 'Nova (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_sky',     label: 'Sky (American Female)',     gender: 'female', language: 'English — United States' },
  { id: 'af_aoede',   label: 'Aoede (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_kore',    label: 'Kore (American Female)',    gender: 'female', language: 'English — United States' },
  // American Male
  { id: 'am_adam',    label: 'Adam (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_michael', label: 'Michael (American Male)',   gender: 'male',   language: 'English — United States' },
  { id: 'am_onyx',    label: 'Onyx (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_echo',    label: 'Echo (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_eric',    label: 'Eric (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_liam',    label: 'Liam (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_puck',    label: 'Puck (American Male)',      gender: 'male',   language: 'English — United States' },
  // British Female
  { id: 'bf_emma',    label: 'Emma (British Female)',     gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella',label: 'Isabella (British Female)', gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_alice',   label: 'Alice (British Female)',    gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_lily',    label: 'Lily (British Female)',     gender: 'female', language: 'English — United Kingdom' },
  // British Male
  { id: 'bm_george',  label: 'George (British Male)',     gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_lewis',   label: 'Lewis (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_daniel',  label: 'Daniel (British Male)',     gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_fable',   label: 'Fable (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
];

const VOICE_KEY = 'inboxiq:kokoro-voice';
const DEFAULT_VOICE_ID: KokoroVoiceId = 'af_heart';

export const KOKORO_VOICES: KokoroVoiceOption[] = SERVER_VOICES;

export const KOKORO_VOICES_BY_LANGUAGE: Record<string, KokoroVoiceOption[]> =
  SERVER_VOICES.reduce((acc, v) => {
    (acc[v.language] ||= []).push(v);
    return acc;
  }, {} as Record<string, KokoroVoiceOption[]>);

export function useVoiceCatalog(): KokoroVoiceOption[] {
  return SERVER_VOICES;
}

function resolveVoiceId(v: string | null | undefined): KokoroVoiceId {
  if (v && SERVER_VOICES.some((x) => x.id === v)) return v;
  return DEFAULT_VOICE_ID;
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
    ttsService.speak(text, getStoredVoice(), id);
  }, []);

  const stop = useCallback(() => ttsService.stop(), []);
  const preload = useCallback(() => { /* no-op — server has no preload */ }, []);

  const speakingId = snap.playingId ?? snap.generatingId;
  const loading = !!snap.generatingId;
  const loadProgress = 100;

  return { speak, stop, speakingId, loading, loadProgress, preload, modelState: snap.modelState, error: snap.error };
}

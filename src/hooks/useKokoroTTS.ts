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
  // One female, one male — American English only. Keeps the browser cache hot
  // and avoids re-generating audio for many rarely-used voices.
  { id: 'af_heart',   label: 'Heart (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'am_michael', label: 'Michael (American Male)',   gender: 'male',   language: 'English — United States' },
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
  const preload = useCallback((text: string, voice?: string) => {
    ttsService.preload(text, voice || getStoredVoice());
  }, []);

  const speakingId = snap.playingId ?? snap.generatingId;
  const loading = !!snap.generatingId;
  const loadProgress = 100;

  return { speak, stop, speakingId, loading, loadProgress, preload, modelState: snap.modelState, error: snap.error };
}

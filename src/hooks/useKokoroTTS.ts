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

// Detect mobile/tablet to serve a trimmed voice list (faster downloads + UI).
function isCompactDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod|Android|Mobile|Tablet/i.test(ua)) return true;
  // iPadOS 13+ reports as desktop Safari but has touch points.
  if ((navigator as any).maxTouchPoints > 1 && /Macintosh/.test(ua)) return true;
  if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1024px)').matches) return true;
  return false;
}

// Compact list — shown on phones & tablets to keep the model download small.
const COMPACT_VOICES: KokoroVoiceOption[] = [
  { id: 'af_heart',    label: 'Heart (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_bella',    label: 'Bella (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'am_adam',     label: 'Adam (American Male)',      gender: 'male',   language: 'English — United States' },
  { id: 'am_michael',  label: 'Michael (American Male)',   gender: 'male',   language: 'English — United States' },
  { id: 'bf_emma',     label: 'Emma (British Female)',     gender: 'female', language: 'English — United Kingdom' },
  { id: 'bm_george',   label: 'George (British Male)',     gender: 'male',   language: 'English — United Kingdom' },
];

// Full Kokoro voice catalog — shown on desktops/laptops.
const FULL_VOICES: KokoroVoiceOption[] = [
  // English — United States, Female
  { id: 'af_heart',    label: 'Heart (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_alloy',    label: 'Alloy (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_aoede',    label: 'Aoede (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_bella',    label: 'Bella (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_jessica',  label: 'Jessica (American Female)',  gender: 'female', language: 'English — United States' },
  { id: 'af_kore',     label: 'Kore (American Female)',     gender: 'female', language: 'English — United States' },
  { id: 'af_nicole',   label: 'Nicole (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_nova',     label: 'Nova (American Female)',     gender: 'female', language: 'English — United States' },
  { id: 'af_river',    label: 'River (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_sarah',    label: 'Sarah (American Female)',    gender: 'female', language: 'English — United States' },
  { id: 'af_sky',      label: 'Sky (American Female)',      gender: 'female', language: 'English — United States' },
  // English — United States, Male
  { id: 'am_adam',     label: 'Adam (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_echo',     label: 'Echo (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_eric',     label: 'Eric (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_fenrir',   label: 'Fenrir (American Male)',     gender: 'male',   language: 'English — United States' },
  { id: 'am_liam',     label: 'Liam (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_michael',  label: 'Michael (American Male)',    gender: 'male',   language: 'English — United States' },
  { id: 'am_onyx',     label: 'Onyx (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_puck',     label: 'Puck (American Male)',       gender: 'male',   language: 'English — United States' },
  // English — United Kingdom, Female
  { id: 'bf_alice',    label: 'Alice (British Female)',     gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_emma',     label: 'Emma (British Female)',      gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella', label: 'Isabella (British Female)',  gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_lily',     label: 'Lily (British Female)',      gender: 'female', language: 'English — United Kingdom' },
  // English — United Kingdom, Male
  { id: 'bm_daniel',   label: 'Daniel (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_fable',    label: 'Fable (British Male)',       gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_george',   label: 'George (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_lewis',    label: 'Lewis (British Male)',       gender: 'male',   language: 'English — United Kingdom' },
];

export const KOKORO_VOICES: KokoroVoiceOption[] =
  isCompactDevice() ? COMPACT_VOICES : FULL_VOICES;

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
  // Pre-warm the new voice so the next play is instant.
  try { ttsService.warm(resolved); } catch { /* ignore */ }
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
  const loadProgress = snap.modelState === 'ready' ? 100 : snap.progress || 0;

  return { speak, stop, speakingId, loading, loadProgress, preload, modelState: snap.modelState, error: snap.error };
}

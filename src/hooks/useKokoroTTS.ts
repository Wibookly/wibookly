import { useCallback, useEffect, useState } from 'react';
import { ttsService, type TtsState } from '@/lib/ttsService';
import { useKokoroEngine, preferredTier } from '@/lib/deviceEngine';

// Tier 2 (KittenTTS) voices — 8 expressive voices, labeled F/M for the UI.
const KITTEN_VOICES_MOBILE = [
  { id: 'Bella',  label: 'Bella (Female)',  gender: 'female' as const, language: 'English (KittenTTS)' },
  { id: 'Luna',   label: 'Luna (Female)',   gender: 'female' as const, language: 'English (KittenTTS)' },
  { id: 'Rosie',  label: 'Rosie (Female)',  gender: 'female' as const, language: 'English (KittenTTS)' },
  { id: 'Kiki',   label: 'Kiki (Female)',   gender: 'female' as const, language: 'English (KittenTTS)' },
  { id: 'Jasper', label: 'Jasper (Male)',   gender: 'male' as const,   language: 'English (KittenTTS)' },
  { id: 'Bruno',  label: 'Bruno (Male)',    gender: 'male' as const,   language: 'English (KittenTTS)' },
  { id: 'Hugo',   label: 'Hugo (Male)',     gender: 'male' as const,   language: 'English (KittenTTS)' },
  { id: 'Leo',    label: 'Leo (Male)',      gender: 'male' as const,   language: 'English (KittenTTS)' },
];

/**
 * Device-aware read-aloud hook.
 *   • Desktop: Kokoro voices (af_/am_/bf_/bm_).
 *   • Mobile/tablet: voices exposed by window.speechSynthesis.
 */

export type KokoroVoiceId = string;

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  language: string;
}

const KOKORO_VOICES_DESKTOP: KokoroVoiceOption[] = [
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
  { id: 'am_adam',     label: 'Adam (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_echo',     label: 'Echo (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_eric',     label: 'Eric (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_fenrir',   label: 'Fenrir (American Male)',     gender: 'male',   language: 'English — United States' },
  { id: 'am_liam',     label: 'Liam (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_michael',  label: 'Michael (American Male)',    gender: 'male',   language: 'English — United States' },
  { id: 'am_onyx',     label: 'Onyx (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'am_puck',     label: 'Puck (American Male)',       gender: 'male',   language: 'English — United States' },
  { id: 'bf_alice',    label: 'Alice (British Female)',     gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_emma',     label: 'Emma (British Female)',      gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_isabella', label: 'Isabella (British Female)',  gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_lily',     label: 'Lily (British Female)',      gender: 'female', language: 'English — United Kingdom' },
  { id: 'bm_daniel',   label: 'Daniel (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_fable',    label: 'Fable (British Male)',       gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_george',   label: 'George (British Male)',      gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_lewis',    label: 'Lewis (British Male)',       gender: 'male',   language: 'English — United Kingdom' },
];

function languageLabelFromTag(lang: string): string {
  if (!lang) return 'Other';
  // e.g. en-US -> English — United States. Keep simple/best-effort.
  try {
    const [base, region] = lang.split('-');
    const dn = new (Intl as any).DisplayNames(['en'], { type: 'language' });
    const rn = region ? new (Intl as any).DisplayNames(['en'], { type: 'region' }) : null;
    const langName = dn.of(base) || base;
    return region ? `${langName} — ${rn?.of(region.toUpperCase()) || region}` : langName;
  } catch {
    return lang;
  }
}

function classifyGender(name: string): 'female' | 'male' {
  const n = name.toLowerCase();
  if (/(female|woman|samantha|victoria|karen|moira|tessa|fiona|alice|allison|ava|susan|kate|serena|kyoko|amélie|amelie|anna|paulina|monica|google.*\bfemale\b)/.test(n)) return 'female';
  if (/(male|man|alex|daniel|fred|tom|nicky|aaron|arthur|gordon|oliver|rishi|google.*\bmale\b)/.test(n)) return 'male';
  return 'female';
}

function getSystemVoices(): KokoroVoiceOption[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const list = window.speechSynthesis.getVoices() || [];
  return list.map((v) => ({
    id: v.name, // use the system voice name as the stable id
    label: v.name + (v.default ? ' (default)' : ''),
    gender: classifyGender(v.name),
    language: languageLabelFromTag(v.lang),
  }));
}

const VOICE_KEY = 'inboxiq:kokoro-voice';
const DEFAULT_VOICE_ID: KokoroVoiceId = 'af_heart';

// Tier-aware base voice list (system voices fetched separately when on Tier 3).
function baseVoices(): KokoroVoiceOption[] {
  if (preferredTier === 1) return KOKORO_VOICES_DESKTOP;
  if (preferredTier === 2) return KITTEN_VOICES_MOBILE;
  return [];
}

/** Reactive voice catalog. Adds system voices once `onvoiceschanged` fires
 *  so users on Tier 3 fallbacks also get a populated dropdown. */
export function useVoiceCatalog(): KokoroVoiceOption[] {
  const [voices, setVoices] = useState<KokoroVoiceOption[]>(() => {
    const base = baseVoices();
    return base.length ? base : getSystemVoices();
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const refresh = () => {
      const base = baseVoices();
      setVoices(base.length ? base : getSystemVoices());
    };
    window.speechSynthesis.onvoiceschanged = refresh;
    refresh();
    return () => { try { window.speechSynthesis.onvoiceschanged = null; } catch { /* ignore */ } };
  }, []);
  return voices;
}

function snapshotVoices(): KokoroVoiceOption[] {
  const base = baseVoices();
  return base.length ? base : getSystemVoices();
}

export const KOKORO_VOICES: KokoroVoiceOption[] = baseVoices();

export const KOKORO_VOICES_BY_LANGUAGE: Record<string, KokoroVoiceOption[]> = (() => {
  const src = snapshotVoices();
  return src.reduce((acc, v) => {
    (acc[v.language] ||= []).push(v);
    return acc;
  }, {} as Record<string, KokoroVoiceOption[]>);
})();

function defaultVoiceId(voices: KokoroVoiceOption[]): KokoroVoiceId {
  if (preferredTier === 1) return DEFAULT_VOICE_ID;
  if (preferredTier === 2) return 'Bella';
  const en = voices.find((v) => /english/i.test(v.language));
  return en?.id || voices[0]?.id || '';
}

function resolveVoiceId(v: string | null | undefined): KokoroVoiceId {
  const voices = snapshotVoices();
  if (v && voices.some((x) => x.id === v)) return v;
  return defaultVoiceId(voices);
}

export function getStoredVoice(): KokoroVoiceId {
  try { return resolveVoiceId(localStorage.getItem(VOICE_KEY)); }
  catch { return defaultVoiceId(snapshotVoices()); }
}

export function setStoredVoice(v: KokoroVoiceId) {
  const resolved = resolveVoiceId(v) || v;
  try { localStorage.setItem(VOICE_KEY, resolved); } catch { /* ignore */ }
  if (preferredTier !== 3 && resolved) {
    try { ttsService.warm(resolved); } catch { /* ignore */ }
  }
}

export function useKokoroTTS() {
  const [snap, setSnap] = useState<TtsState>(() => ttsService.getState());
  useEffect(() => ttsService.subscribe(setSnap), []);

  const speak = useCallback((text: string, id: string) => {
    const voice = getStoredVoice();
    ttsService.speak(text, voice, id);
  }, []);

  const stop = useCallback(() => ttsService.stop(), []);
  const preload = useCallback(() => ttsService.preload(getStoredVoice()), []);

  const speakingId = snap.playingId ?? snap.generatingId;
  const loading = snap.modelState === 'loading' || !!snap.generatingId;
  const loadProgress = snap.modelState === 'ready' ? 100 : snap.progress || 0;

  return { speak, stop, speakingId, loading, loadProgress, preload, modelState: snap.modelState, error: snap.error };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/**
 * Server-side TTS via our `kokoro-tts` Supabase Edge Function.
 * Audio bytes come back as base64 inside JSON (so they can't be corrupted
 * by Supabase's auto JSON-parsing). We decode to a Blob and play via
 * <audio>.play() in the same user-gesture click handler.
 */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kokoro-tts`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export type KokoroVoiceId = string;

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  language: string;
}

export const KOKORO_VOICES: KokoroVoiceOption[] = [
  { id: 'af_heart',   label: 'Heart (American Female)',  gender: 'female', language: 'English — United States' },
  { id: 'af_nova',    label: 'Nova (American Female)',   gender: 'female', language: 'English — United States' },
  { id: 'af_bella',   label: 'Bella (American Female)',  gender: 'female', language: 'English — United States' },
  { id: 'am_adam',    label: 'Adam (American Male)',     gender: 'male',   language: 'English — United States' },
  { id: 'am_echo',    label: 'Echo (American Male)',     gender: 'male',   language: 'English — United States' },
  { id: 'am_onyx',    label: 'Onyx (American Male)',     gender: 'male',   language: 'English — United States' },
  { id: 'bf_emma',    label: 'Emma (British Female)',    gender: 'female', language: 'English — United Kingdom' },
  { id: 'bf_alice',   label: 'Alice (British Female)',   gender: 'female', language: 'English — United Kingdom' },
  { id: 'bm_george',  label: 'George (British Male)',    gender: 'male',   language: 'English — United Kingdom' },
  { id: 'bm_daniel',  label: 'Daniel (British Male)',    gender: 'male',   language: 'English — United Kingdom' },
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

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function useKokoroTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const nonceRef = useRef(0);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const cleanup = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
    } catch { /* ignore */ }
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    nonceRef.current += 1;
    cleanup();
    setSpeakingId(null);
    setLoading(false);
  }, [cleanup]);

  useEffect(() => () => stop(), [stop]);

  const speak = useCallback(async (text: string, id: string) => {
    const clean = cleanForSpeech(text);
    if (!clean) return;

    stop();
    const nonce = ++nonceRef.current;
    setSpeakingId(id);
    setLoading(true);

    const voice = resolveVoiceId(getStoredVoice());
    setStoredVoice(voice);

    // Pre-create the Audio element inside the user-gesture call stack so
    // browsers allow .play() once the bytes arrive.
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audioRef.current = audio;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader = session?.access_token
        ? `Bearer ${session.access_token}`
        : `Bearer ${ANON_KEY}`;

      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ text: clean, voice, format: 'mp3' }),
      });

      if (nonce !== nonceRef.current) return;

      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        console.error('[tts] function error', res.status, detail);
        toast.error(`Audio failed (${res.status}): ${detail.slice(0, 180)}`);
        cleanup();
        setSpeakingId(null);
        return;
      }

      const payload = await res.json();
      const bytes = base64ToBytes(payload.audio);
      console.log(`[tts] decoded blob byte size: ${bytes.length} (provider=${payload.provider}, mime=${payload.mimeType})`);

      if (bytes.length < 200) {
        toast.error('Audio came back empty.');
        cleanup();
        setSpeakingId(null);
        return;
      }

      const blob = new Blob([bytes], { type: payload.mimeType || 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      audio.src = url;

      audio.onended = () => {
        if (nonce !== nonceRef.current) return;
        cleanup();
        setSpeakingId((c) => (c === id ? null : c));
      };
      audio.onerror = () => {
        if (nonce !== nonceRef.current) return;
        console.error('[tts] <audio> error', audio.error);
        toast.error('Audio playback error.');
        cleanup();
        setSpeakingId((c) => (c === id ? null : c));
      };

      await audio.play();
    } catch (err: any) {
      if (nonce !== nonceRef.current) return;
      console.error('[tts] speak failed:', err);
      toast.error(`Audio failed: ${err?.message ?? err}`);
      cleanup();
      setSpeakingId(null);
    } finally {
      if (nonce === nonceRef.current) setLoading(false);
    }
  }, [cleanup, stop]);

  const preload = useCallback(async () => { /* no-op: server-side TTS */ }, []);

  return { speak, stop, speakingId, loading, loadProgress: 100, preload };
}

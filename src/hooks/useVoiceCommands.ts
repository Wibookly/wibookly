import { useEffect, useRef } from 'react';

interface UseVoiceCommandsOptions {
  enabled: boolean;
  onListen?: () => void;
  onStop?: () => void;
  onSend?: () => void;
  onCancel?: () => void;
}

/**
 * Lightweight wake-word listener using the browser SpeechRecognition API.
 * Listens continuously for short commands: "listen", "stop", "send", "cancel".
 *
 * Notes:
 * - Safari support is via webkitSpeechRecognition (works on macOS Safari, iOS 14.5+).
 * - When the main mic recording (Whisper) starts, this also continues so "stop" / "send"
 *   commands can be heard; the two streams coexist since SpeechRecognition uses its own.
 */
export function useVoiceCommands({ enabled, onListen, onStop, onSend, onCancel }: UseVoiceCommandsOptions) {
  const recognitionRef = useRef<any>(null);
  const lastFireRef = useRef<number>(0);
  const stoppedRef = useRef<boolean>(true);
  const handlersRef = useRef({ onListen, onStop, onSend, onCancel });

  useEffect(() => {
    handlersRef.current = { onListen, onStop, onSend, onCancel };
  }, [onListen, onStop, onSend, onCancel]);

  useEffect(() => {
    if (!enabled) return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn('[voice-commands] SpeechRecognition not supported in this browser.');
      return;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recognitionRef.current = rec;
    stoppedRef.current = false;

    const fire = (kind: 'listen' | 'stop' | 'send' | 'cancel') => {
      const now = Date.now();
      if (now - lastFireRef.current < 1200) return;
      lastFireRef.current = now;
      const h = handlersRef.current;
      if (kind === 'listen') h.onListen?.();
      else if (kind === 'stop') h.onStop?.();
      else if (kind === 'send') h.onSend?.();
      else if (kind === 'cancel') h.onCancel?.();
    };

    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (!res.isFinal) continue;
        const transcript: string = (res[0]?.transcript || '').toLowerCase().trim();
        if (!transcript) continue;
        // Last word wins for commands so a stop/send at end of speech triggers.
        const tokens = transcript.replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
        const last = tokens[tokens.length - 1];
        const last2 = tokens.slice(-2).join(' ');
        if (last === 'listen' || last2.endsWith('hey listen') || tokens.includes('listen')) {
          fire('listen');
        } else if (last === 'stop' || tokens.includes('stop')) {
          fire('stop');
        } else if (last === 'send' || tokens.includes('send')) {
          fire('send');
        } else if (last === 'cancel' || tokens.includes('cancel')) {
          fire('cancel');
        }
      }
    };

    rec.onerror = (e: any) => {
      // 'no-speech' / 'aborted' are normal; just let onend restart.
      if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[voice-commands] error:', e.error);
      }
    };

    rec.onend = () => {
      if (stoppedRef.current) return;
      // Auto-restart so we keep listening for wake words.
      try { rec.start(); } catch { /* already started */ }
    };

    try { rec.start(); } catch { /* already started */ }

    return () => {
      stoppedRef.current = true;
      try { rec.onresult = null; rec.onerror = null; rec.onend = null; rec.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    };
  }, [enabled]);
}

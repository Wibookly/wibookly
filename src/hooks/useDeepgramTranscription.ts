import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DiarizedUtterance {
  /** Raw integer speaker id from Deepgram (0,1,2,...). */
  speakerId: number;
  text: string;
  /** seconds since session start */
  startSec: number;
  endSec: number;
}

interface UseDeepgramOpts {
  onInterim?: (text: string, speakerId: number | null) => void;
  onFinalUtterance: (u: DiarizedUtterance) => void;
  onError?: (msg: string) => void;
}

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
}

interface DeepgramResultMsg {
  type: 'Results';
  channel: {
    alternatives: Array<{
      transcript: string;
      words: DeepgramWord[];
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
}

/**
 * Streams the user's microphone to Deepgram Nova-3 with speaker diarization
 * enabled. Emits a finalized utterance whenever Deepgram marks `speech_final`,
 * grouped by speaker so each transcript line gets a single speaker id.
 */
export function useDeepgramTranscription({ onInterim, onFinalUtterance, onError }: UseDeepgramOpts) {
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keepAliveRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    setListening(false);
    setConnected(false);
    if (keepAliveRef.current) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); } catch { /* ignore */ }
    recorderRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'CloseStream' }));
        }
        wsRef.current.close();
      } catch { /* ignore */ }
      wsRef.current = null;
    }
  }, []);

  const start = useCallback(async (existingStream?: MediaStream | null) => {
    stoppingRef.current = false;
    try {
      // 1) Mint a short-lived token from our edge function.
      const { data, error } = await supabase.functions.invoke('deepgram-token', { body: {} });
      if (error) throw new Error(error.message || 'token_error');
      const token: string | undefined = data?.access_token;
      if (!token) throw new Error('No Deepgram token returned');

      // 2) Get the microphone (reuse a stream from the existing mic check if provided).
      const stream = existingStream && existingStream.getAudioTracks().length
        ? existingStream
        : await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
      streamRef.current = stream;

      // 3) Open WebSocket. `diarize=true` enables speaker labels. We use webm/opus
      //    which Deepgram auto-detects, so no encoding/sample_rate params are needed.
      const params = new URLSearchParams({
        model: 'nova-3',
        diarize: 'true',
        smart_format: 'true',
        punctuate: 'true',
        interim_results: 'true',
        utterance_end_ms: '1000',
        vad_events: 'true',
        language: 'en',
      });
      const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      const ws = new WebSocket(url, ['token', token]);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setListening(true);

        // Start MediaRecorder once the socket is open, sending small chunks.
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(ev.data);
          }
        };
        recorder.start(250);

        // KeepAlive every 8s.
        keepAliveRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 8000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as DeepgramResultMsg;
          if (msg.type !== 'Results') return;
          const alt = msg.channel?.alternatives?.[0];
          if (!alt) return;
          const transcript = alt.transcript?.trim() || '';
          if (!transcript) return;

          const words = alt.words || [];
          const firstSpeaker = words.find((w) => typeof w.speaker === 'number')?.speaker;
          const interimSpeaker = typeof firstSpeaker === 'number' ? firstSpeaker : null;

          if (!msg.is_final) {
            onInterim?.(transcript, interimSpeaker);
            return;
          }

          // Final: group consecutive words by speaker so each transcript line
          // has exactly one speaker. Emit one utterance per group.
          if (!words.length) {
            onFinalUtterance({
              speakerId: interimSpeaker ?? 0,
              text: transcript,
              startSec: msg.start ?? 0,
              endSec: (msg.start ?? 0) + (msg.duration ?? 0),
            });
            return;
          }

          let currentSpeaker = words[0].speaker ?? 0;
          let bucket: DeepgramWord[] = [];
          const flush = () => {
            if (!bucket.length) return;
            const text = bucket.map((w) => w.punctuated_word || w.word).join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
            if (text) {
              onFinalUtterance({
                speakerId: currentSpeaker,
                text,
                startSec: bucket[0].start,
                endSec: bucket[bucket.length - 1].end,
              });
            }
            bucket = [];
          };

          for (const w of words) {
            const sp = w.speaker ?? currentSpeaker;
            if (sp !== currentSpeaker && bucket.length) {
              flush();
              currentSpeaker = sp;
            } else if (sp !== currentSpeaker) {
              currentSpeaker = sp;
            }
            bucket.push(w);
          }
          flush();
        } catch (err) {
          console.warn('[deepgram] parse error', err);
        }
      };

      ws.onerror = (err) => {
        console.warn('[deepgram] ws error', err);
        if (!stoppingRef.current) onError?.('Live transcription connection error.');
      };

      ws.onclose = () => {
        setConnected(false);
        setListening(false);
        if (keepAliveRef.current) {
          window.clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
      };
    } catch (e) {
      stop();
      const msg = e instanceof Error ? e.message : 'Could not start live transcription';
      onError?.(msg);
      throw e;
    }
  }, [onInterim, onFinalUtterance, onError, stop]);

  useEffect(() => () => stop(), [stop]);

  return { start, stop, listening, connected };
}

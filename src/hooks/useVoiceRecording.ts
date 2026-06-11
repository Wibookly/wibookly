import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UseVoiceRecordingOptions {
  onTranscription: (text: string) => void;
  /** Auto-stop after this many ms of silence. Defaults to 2000. Set to 0 to disable. */
  silenceTimeoutMs?: number;
  /** Preferred audio input device id (from enumerateDevices). */
  deviceId?: string | null;
}

export function useVoiceRecording({ onTranscription, silenceTimeoutMs = 2000, deviceId }: UseVoiceRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const hasSpokenRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);
  const permissionCheckedRef = useRef(false);
  const getAnalyser = useCallback(() => analyserRef.current, []);

  const cleanupSilenceDetection = useCallback(() => {
    if (silenceRafRef.current !== null) {
      cancelAnimationFrame(silenceRafRef.current);
      silenceRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {/* ignore */});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    cleanupSilenceDetection();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [cleanupSilenceDetection]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    stopRecording();
  }, [stopRecording]);

  const releaseStream = useCallback(() => {
    try { streamRef.current?.getTracks().forEach((track) => track.stop()); } catch { /* ignore */ }
    streamRef.current = null;
  }, []);

  const ensureMicrophoneStream = useCallback(async () => {
    if (streamRef.current?.active && streamRef.current.getAudioTracks().some((track) => track.readyState === 'live')) {
      return streamRef.current;
    }

    if (!permissionCheckedRef.current) {
      permissionCheckedRef.current = true;
      try {
        if (navigator.permissions?.query) {
          const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (status.state === 'denied') {
            const err = new Error('Microphone blocked');
            (err as Error & { name: string }).name = 'NotAllowedError';
            throw err;
          }
        }
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') throw err;
      }
    }

    const audioConstraints: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (e: any) {
      if (deviceId && (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError' || e?.name === 'NotReadableError')) {
        console.warn('Preferred mic unavailable, falling back to default:', e?.name);
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } else {
        throw e;
      }
    }

    return streamRef.current;
  }, [deviceId]);

  const startRecording = useCallback(async () => {
    let stream: MediaStream | null = null;
    try {
      stream = await ensureMicrophoneStream();


      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        cleanupSilenceDetection();
        const audioBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        setIsRecording(false);

        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }

        // Skip transcription only for truly empty recordings (no audio captured).
        if (audioBlob.size < 500) {
          return;
        }

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          await transcribeAudio(base64Audio);
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Always create an analyser so the UI can render a live waveform.
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new AudioCtx();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyserRef.current = analyser;

        if (silenceTimeoutMs > 0) {
          const buf = new Uint8Array(analyser.fftSize);
          hasSpokenRef.current = false;
          lastVoiceAtRef.current = Date.now();
          const VOICE_RMS_THRESHOLD = 0.015;

          const tick = () => {
            analyser.getByteTimeDomainData(buf);
            let sumSq = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sumSq += v * v;
            }
            const rms = Math.sqrt(sumSq / buf.length);
            const now = Date.now();
            if (rms > VOICE_RMS_THRESHOLD) {
              lastVoiceAtRef.current = now;
              hasSpokenRef.current = true;
            }
            if (hasSpokenRef.current && now - lastVoiceAtRef.current >= silenceTimeoutMs) {
              toast.info('Voice captured — converting it to text…', { position: 'top-center', duration: 2500 });
              stopRecording();
              return;
            }
            silenceRafRef.current = requestAnimationFrame(tick);
          };
          silenceRafRef.current = requestAnimationFrame(tick);
        }
      } catch (err) {
        console.warn('Audio analyser unavailable:', err);
      }
    } catch (error: any) {
      console.error('Error starting recording:', error);
      const name = error?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        releaseStream();
        toast.error('Microphone blocked. Allow mic access in your browser settings.');
      } else if (name === 'NotFoundError') {
        releaseStream();
        toast.error('No microphone detected. Plug one in and try again.');
      } else if (name === 'NotReadableError') {
        releaseStream();
        toast.error('Microphone is in use by another app. Close it and try again.');
      } else {
        toast.error(`Could not start recording${error?.message ? `: ${error.message}` : ''}`);
      }
    }
  }, [silenceTimeoutMs, stopRecording, cleanupSilenceDetection, ensureMicrophoneStream, releaseStream]);

  const transcribeAudio = async (base64Audio: string) => {
    setIsTranscribing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sign in again — your session expired.');
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-to-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ audio: base64Audio }),
      });

      // The edge function returns 200 with `{ error, text: "" }` on failure
      // so the browser never throws here; inspect the body for a real error.
      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok || payload?.error) {
        const msg = payload?.error || `Transcription failed (${response.status})`;
        throw new Error(msg);
      }
      const text = payload?.text || '';
      if (text) {
        onTranscription(text);
      } else {
        toast.message("Didn't catch that — try speaking again.");
      }
    } catch (error) {
      console.error('Transcription error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to transcribe audio');
    } finally {
      setIsTranscribing(false);
    }
  };

  useEffect(() => () => {
    cleanupSilenceDetection();
    releaseStream();
  }, [cleanupSilenceDetection, releaseStream]);


  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelRecording,
    getAnalyser,
  };
}

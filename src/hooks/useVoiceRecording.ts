import { useState, useRef, useCallback } from 'react';
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
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const hasSpokenRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);
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

  const startRecording = useCallback(async () => {
    let stream: MediaStream | null = null;
    try {
      // Try the user's preferred mic first. If the saved device id is no
      // longer plugged in (or the browser refuses `exact`), gracefully fall
      // back to the default mic instead of throwing a red error.
      const tryGetStream = async (constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints);
      try {
        const audioConstraints: MediaTrackConstraints = deviceId
          ? { deviceId: { exact: deviceId } }
          : {};
        stream = await tryGetStream({ audio: audioConstraints });
      } catch (e: any) {
        if (deviceId && (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError' || e?.name === 'NotReadableError')) {
          console.warn('Preferred mic unavailable, falling back to default:', e?.name);
          stream = await tryGetStream({ audio: true });
        } else {
          throw e;
        }
      }


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
        stream.getTracks().forEach(track => track.stop());

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
    } catch (error) {
      console.error('Error starting recording:', error);
      toast.error('Could not access microphone. Please check permissions.');
    }
  }, [silenceTimeoutMs, stopRecording, cleanupSilenceDetection, deviceId]);

  const transcribeAudio = async (base64Audio: string) => {
    setIsTranscribing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-to-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ audio: base64Audio }),
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const { text } = await response.json();
      if (text) {
        onTranscription(text);
      }
    } catch (error) {
      console.error('Transcription error:', error);
      toast.error('Failed to transcribe audio');
    } finally {
      setIsTranscribing(false);
    }
  };

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelRecording,
    getAnalyser,
  };
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Square, Send, Sparkles, Loader2, FileText, MessageSquareQuote, HelpCircle, Reply, Copy, Radio, BadgeCheck, Mic, MicOff, Volume2, Waves, AudioLines, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  meeting: {
    id: string;
    title: string;
  };
  onClose: () => void;
  autoStart?: boolean;
}


interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  time: string;
  color: string;
}

interface Suggestion {
  id: string;
  label: string;
  content: string;
  kind?: string;
}

interface RealtimeTranscriptRow {
  id: string;
  speaker: string | null;
  text: string;
  spoken_at: string | null;
  created_at: string | null;
}

interface RealtimeSuggestionRow {
  id: string;
  suggestion_type: string | null;
  type?: string | null;
  content: string | null;
  text?: string | null;
}

interface SuggestionResponse {
  id?: string;
  type?: string;
  kind?: string;
  content?: string;
  text?: string;
}

type ReadyState = 'preflight' | 'ready' | 'listening';

interface SummaryActionItem {
  title?: string;
  task?: string;
  owner?: string;
}

interface MeetingSummary {
  summary?: string;
  keyDecisions?: string[];
  actionItems?: Array<string | SummaryActionItem>;
  draftEmail?: string;
}

type CopilotPromptMode = 'answer' | 'ask' | 'say';

const SPEAKER_COLORS = ['#22C55E', '#A855F7', '#06B6D4', '#F97316', '#EC4899'];
const MIC_VISUAL_BARS = 20;

export default function LiveCopilotSession({ meeting, onClose, autoStart = false }: Props) {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState('');
  const [speaker, setSpeaker] = useState('Other');
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [promptBusy, setPromptBusy] = useState<CopilotPromptMode | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // In-browser mic listening (works without the Chrome extension)
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [micCheckBusy, setMicCheckBusy] = useState(false);
  const [micCheckMessage, setMicCheckMessage] = useState<string | null>(null);
  const [readyState, setReadyState] = useState<ReadyState>('preflight');
  const [autoJoin, setAutoJoin] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [speakerLevel, setSpeakerLevel] = useState(0);
  const [heardPreview, setHeardPreview] = useState<string | null>(null);
  const [extensionCaptureState, setExtensionCaptureState] = useState<'checking' | 'available' | 'missing' | 'active' | 'error'>('checking');
  const [audioSetupOpen, setAudioSetupOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const proactiveBusyRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const shouldListenRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const lastInsertRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const extensionPollRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const speakerAnalyserRef = useRef<AnalyserNode | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user?.id]);

  const transcriptContext = useMemo(
    () => transcript.slice(-10).map((line) => `${line.speaker}: ${line.text}`).join('\n'),
    [transcript],
  );
  const suggestionContext = useMemo(
    () => transcriptContext.trim() || draft.trim(),
    [draft, transcriptContext],
  );
  const latestSuggestions = useMemo(() => suggestions.slice(0, 6), [suggestions]);
  const micBars = useMemo(
    () => Array.from({ length: MIC_VISUAL_BARS }, (_, index) => {
      const distance = Math.abs(index - (MIC_VISUAL_BARS - 1) / 2);
      const weight = 1 - distance / ((MIC_VISUAL_BARS - 1) / 2);
      const amplified = Math.min(1, micLevel * 2.4);
      return Math.max(0.04, amplified * (0.35 + weight * 1.1));
    }),
    [micLevel],
  );
  const speakerBars = useMemo(
    () => Array.from({ length: 12 }, (_, index) => {
      const phase = (index % 4) / 3;
      return Math.max(0.06, speakerLevel * (0.5 + phase));
    }),
    [speakerLevel],
  );

  // Create session on mount
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: existing } = await supabase
        .from('meeting_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('meeting_external_id', meeting.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        if (!cancelled) setSessionId(existing.id);
        return;
      }

      const { data, error } = await supabase
        .from('meeting_sessions')
        .insert({
          user_id: user.id,
          meeting_external_id: meeting.id,
          meeting_title: meeting.title,
          status: 'active',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error) {
        toast.error('Could not start Copilot session');
        return;
      }
      if (cancelled) return;
      setSessionId(data.id);
    })();
    return () => { cancelled = true; };
  }, [user, meeting.id, meeting.title]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      const [{ data: transcriptRows }, { data: suggestionRows }] = await Promise.all([
        supabase
          .from('meeting_transcripts')
          .select('id, speaker, text, spoken_at, created_at')
          .eq('session_id', sessionId)
          .order('spoken_at', { ascending: true }),
        supabase
          .from('meeting_suggestions')
          .select('id, suggestion_type, content')
          .eq('session_id', sessionId)
          .order('generated_at', { ascending: false })
          .limit(12),
      ]);

      if (cancelled) return;

      setTranscript(((transcriptRows || []) as RealtimeTranscriptRow[]).map((r) => {
        const d = new Date(r.spoken_at || r.created_at || new Date().toISOString());
        const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const speakerName = r.speaker || 'Other';
        const color = speakerName === 'You'
          ? '#A855F7'
          : SPEAKER_COLORS[Math.abs(hashCode(speakerName)) % SPEAKER_COLORS.length];
        return { id: r.id, speaker: speakerName, text: r.text, time, color };
      }));

      setSuggestions(((suggestionRows || []) as RealtimeSuggestionRow[]).map((r) => ({
        id: r.id,
        label: (r.suggestion_type || 'Suggestion').toUpperCase(),
        content: r.content || '',
        kind: r.suggestion_type || undefined,
      })));
    })();

    return () => { cancelled = true; };
  }, [sessionId]);

  // Realtime: listen for transcript + suggestion inserts (pushed by the Chrome extension)
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`copilot-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'meeting_transcripts',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const r = payload.new as RealtimeTranscriptRow;
        let inserted = false;
        setTranscript((cur) => {
          if (cur.some((l) => l.id === r.id)) return cur;
          inserted = true;
          const d = new Date(r.spoken_at || r.created_at);
          const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          const color = r.speaker === 'You'
            ? '#A855F7'
            : SPEAKER_COLORS[Math.abs(hashCode(String(r.speaker || 'Other'))) % SPEAKER_COLORS.length];
          return [...cur, { id: r.id, speaker: r.speaker || 'Other', text: r.text, time, color }];
        });

        // Proactive: when someone other than "You" speaks (especially a question),
        // automatically pull the best answer/next move so the user doesn't have to click.
        if (inserted && r.speaker && r.speaker !== 'You' && !proactiveBusyRef.current) {
          const txt = (r.text || '').trim();
          const isQuestion = /\?\s*$/.test(txt) || /\b(what|why|how|when|where|who|which|can you|could you|would you|do you|did you|are you|is there|should)\b/i.test(txt);
          const intent: CopilotPromptMode = isQuestion ? 'answer' : 'say';
          proactiveBusyRef.current = true;
          setTimeout(() => { proactiveBusyRef.current = false; }, 9000);
          void requestFocusedSuggestion(intent, { silent: true });
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'meeting_suggestions',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const r = payload.new as RealtimeSuggestionRow;
        setSuggestions((cur) => {
          if (cur.some((s) => s.id === r.id)) return cur;
          return [{
            id: r.id,
            label: (r.suggestion_type || r.type || 'Suggestion').toUpperCase(),
            content: r.content || r.text || '',
            kind: r.suggestion_type,
          }, ...cur].slice(0, 6);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  // Transcript auto-scroll disabled — newest items now appear at the top.

  useEffect(() => {
    const extensionId = localStorage.getItem('inboxiq_extension_id');
    if (!extensionId) {
      setExtensionCaptureState('missing');
      return;
    }

    const checkExtensionCapture = async () => {
      try {
        const w = window as Window & {
          chrome?: {
            runtime?: {
              lastError?: { message?: string };
              sendMessage?: (id: string, message: unknown, callback?: (response: unknown) => void) => void;
            };
          };
        };

        if (!w.chrome?.runtime?.sendMessage) {
          setExtensionCaptureState('missing');
          return;
        }

        const runtime = w.chrome?.runtime;
        if (!runtime?.sendMessage) {
          setExtensionCaptureState('missing');
          return;
        }

        await new Promise<void>((resolve, reject) => {
          runtime.sendMessage(
            extensionId,
            { type: 'IQ_GET_CAPTURE_STATE' },
            (response: unknown) => {
              const lastError = runtime.lastError;
              if (lastError) {
                reject(new Error(lastError.message));
                return;
              }
              const payload = response as { active?: boolean } | undefined;
              setExtensionCaptureState(payload?.active ? 'active' : 'available');
              resolve();
            },
          );
        });
      } catch {
        setExtensionCaptureState('error');
      }
    };

    void checkExtensionCapture();
    extensionPollRef.current = window.setInterval(() => {
      void checkExtensionCapture();
    }, 4000);

    return () => {
      if (extensionPollRef.current) {
        window.clearInterval(extensionPollRef.current);
        extensionPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (listening) {
      setReadyState('listening');
      return;
    }
    if (micReady || extensionCaptureState === 'active' || extensionCaptureState === 'available') {
      setReadyState('ready');
      return;
    }
    setReadyState('preflight');
  }, [extensionCaptureState, listening, micReady]);

  const stopAudioMeters = () => {
    if (analyserFrameRef.current !== null) {
      cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    try {
      audioContextRef.current?.close();
    } catch {
      // ignore
    }
    audioContextRef.current = null;
    micAnalyserRef.current = null;
    speakerAnalyserRef.current = null;
    setMicLevel(0);
    setSpeakerLevel(0);
  };

  const sampleAnalyserLevel = (analyser: AnalyserNode | null) => {
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / Math.max(1, data.length);
    return Math.min(1, average / 128);
  };

  const startAudioMeters = async (stream: MediaStream) => {
    stopAudioMeters();
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const context = new AudioCtx();
    audioContextRef.current = context;
    const micSource = context.createMediaStreamSource(stream);
    const micAnalyser = context.createAnalyser();
    micAnalyser.fftSize = 256;
    micSource.connect(micAnalyser);
    micAnalyserRef.current = micAnalyser;

    const speakerAnalyser = context.createAnalyser();
    speakerAnalyser.fftSize = 256;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 220;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(speakerAnalyser);
    gain.connect(context.destination);
    oscillator.start();
    speakerAnalyserRef.current = speakerAnalyser;

    const animate = () => {
      setMicLevel(sampleAnalyserLevel(micAnalyserRef.current));
      setSpeakerLevel((current) => {
        const next = sampleAnalyserLevel(speakerAnalyserRef.current);
        return next > 0.02 ? next : Math.max(0.08, current * 0.85);
      });
      analyserFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
    window.setTimeout(() => {
      try {
        oscillator.stop();
      } catch {
        // ignore
      }
    }, 900);
  };

  // --- In-browser microphone capture via Web Speech API ---
  const pushHeardLine = async (text: string) => {
    const sid = sessionIdRef.current;
    const uid = userIdRef.current;
    if (!sid || !uid) return;
    const clean = text.trim();
    if (!clean) return;
    // de-dupe rapid duplicates
    const now = Date.now();
    if (clean === lastInsertRef.current.text && now - lastInsertRef.current.at < 4000) return;
    lastInsertRef.current = { text: clean, at: now };

    await supabase.from('meeting_transcripts').insert({
      session_id: sid,
      user_id: uid,
      speaker: 'You',
      text: clean,
      spoken_at: new Date().toISOString(),
    });

    // fire suggestion in the background
    try {
      const recent = [...transcript.slice(-5), { speaker: 'You', text: clean }]
        .map((l) => `${l.speaker}: ${l.text}`).join('\n');
      supabase.functions.invoke('meeting-copilot-suggestion', {
        body: { sessionId: sid, recentTranscript: recent },
      }).catch(() => {});
    } catch { /* ignore */ }
  };

  const releaseMicCheck = () => {
    try { micStreamRef.current?.getTracks().forEach((track) => track.stop()); } catch { /* ignore */ }
    micStreamRef.current = null;
    stopAudioMeters();
  };

  const runMicCheck = async () => {
    setMicCheckBusy(true);
    setMicError(null);
    setMicCheckMessage(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot test the microphone. Use Chrome, Edge, or Brave.');
      }
      try {
        if (navigator.permissions?.query) {
          const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (status.state === 'denied') {
            throw new Error('Microphone access is blocked. Re-enable it in your browser site settings, then test again.');
          }
        }
      } catch {
        // ignore unsupported permissions API
      }

      releaseMicCheck();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      setMicReady(true);
      await startAudioMeters(stream);
      setMicCheckMessage('Microphone and speaker check passed. Watch the bars move while you talk, then start listening.');
      toast.success('Microphone and speaker check passed.');
    } catch (e: any) {
      setMicReady(false);
      const message = e?.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in the browser prompt or site settings, then test again.'
        : e?.name === 'NotFoundError'
          ? 'No microphone was detected on this device.'
          : e?.name === 'NotReadableError'
            ? 'The microphone is busy in another app or browser tab.'
            : (e?.message || 'Could not access the microphone.');
      setMicError(message);
      toast.error(message);
    } finally {
      setMicCheckBusy(false);
    }
  };

  const startListening = async () => {
    setMicError(null);
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError('Live mic transcription needs Chrome, Edge, or Brave. Use the extension for tab audio.');
      toast.error('This browser does not support live speech recognition. Try Chrome.');
      return;
    }
    if (!sessionId) {
      toast.info('Session is still starting — try again in a second.');
      return;
    }

    if (!micReady) {
      await runMicCheck();
    }

    if (!micStreamRef.current) {
      setMicError('Test the microphone first so InboxIQ can confirm your device is ready.');
      return;
    }

    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          const txt = (r[0]?.transcript || '').trim();
          if (!txt) continue;
          setHeardPreview(txt);
          if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
          previewTimerRef.current = window.setTimeout(() => setHeardPreview(null), 1800);
          if (r.isFinal) {
            void pushHeardLine(txt);
          }
        }
      };

      rec.onerror = (e: any) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          setMicError('Microphone blocked. Allow microphone access in your browser settings.');
          shouldListenRef.current = false;
          setListening(false);
        } else if (e?.error === 'no-speech' || e?.error === 'aborted') {
          // benign — onend will restart
        } else {
          console.warn('SpeechRecognition error', e?.error);
        }
      };

      rec.onend = () => {
        if (shouldListenRef.current) {
          try { rec.start(); } catch { /* will retry */ }
        } else {
          setListening(false);
        }
      };

      shouldListenRef.current = true;
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
      toast.success('Listening — speak normally. Your voice is being transcribed live.');
    } catch (e: any) {
      console.error(e);
      setMicError(e?.message || 'Could not start microphone.');
    }
  };

  const stopListening = () => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    try { recognitionRef.current?.abort?.(); } catch { /* ignore */ }
    recognitionRef.current = null;
    setListening(false);
    setHeardPreview(null);
    // Fully release the microphone tracks so the browser indicator goes away.
    releaseMicCheck();
    setMicReady(false);
  };

  const handleClose = () => {
    stopListening();
    onClose();
  };

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      try { recognitionRef.current?.abort?.(); } catch { /* ignore */ }
      recognitionRef.current = null;
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      releaseMicCheck();
    };
  }, []);

  // Auto-start listening when the user opened this session via "Join" (a real
  // user gesture). getUserMedia still works for a brief window after the click
  // because the gesture context is preserved across the parent's setState.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    if (!sessionId || !user) return;
    autoStartedRef.current = true;
    void startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, sessionId, user]);




  const addLine = async () => {
    if (!draft.trim() || !sessionId || !user) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const color = speaker === 'You'
      ? '#A855F7'
      : SPEAKER_COLORS[Math.abs(hashCode(speaker)) % SPEAKER_COLORS.length];

    const newLine: TranscriptLine = {
      id: crypto.randomUUID(),
      speaker,
      text: draft.trim(),
      time,
      color,
    };
    setDraft('');

    // Persist
    await supabase.from('meeting_transcripts').insert({
      session_id: sessionId,
      user_id: user.id,
      speaker,
      text: newLine.text,
      spoken_at: now.toISOString(),
    });

    // Trigger AI suggestion using last 6 lines
    const recent = [...transcript, newLine].slice(-6)
      .map((l) => `${l.speaker}: ${l.text}`)
      .join('\n');

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('meeting-copilot-suggestion', {
        body: { sessionId, recentTranscript: recent },
      });
      if (error) throw error;
    } catch (e: unknown) {
      console.error('suggestion error', e);
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    if (!sessionId) return;
    // Release the microphone the moment the user ends the meeting so the
    // browser tab indicator disappears immediately.
    stopListening();
    setEnding(true);
    try {
      const { data, error } = await supabase.functions.invoke('meeting-copilot-summary', {
        body: { sessionId },
      });
      if (error) throw error;
      setSummary((data ?? null) as MeetingSummary | null);
      toast.success('Session ended — summary ready');
    } catch (e: unknown) {
      console.error(e);
      toast.error('Could not generate summary');
    } finally {
      setEnding(false);
    }
  };

  const requestFocusedSuggestion = async (mode: CopilotPromptMode, opts?: { silent?: boolean }) => {
    if (!sessionId) {
      if (!opts?.silent) toast.info('Session is still starting — try again in a second.');
      return;
    }

    const promptLabels: Record<CopilotPromptMode, string> = {
      answer: 'best answer',
      ask: 'best question',
      say: 'best thing to say next',
    };

    if (!opts?.silent) setPromptBusy(mode);
    try {
      const { data, error } = await supabase.functions.invoke('meeting-copilot-suggestion', {
        body: {
          sessionId,
          recentTranscript: suggestionContext.trim() || `Meeting title: ${meeting.title}`,
          intent: mode,
        },
      });
      if (error) throw error;

      const mapped: Suggestion[] = ((data?.suggestions || []) as SuggestionResponse[]).map((s) => ({
        id: String(s.id || ''),
        label: (s.type || mode).toUpperCase(),
        content: s.content || s.text || '',
        kind: s.type || mode,
      }));

      if (mapped.length === 0) {
        if (!opts?.silent) toast.info(`No ${promptLabels[mode]} available yet from the current conversation.`);
        return;
      }

      setSuggestions((cur) => {
        const next = [...mapped, ...cur].filter((item, index, arr) => index === arr.findIndex((x) => x.id === item.id || (x.label === item.label && x.content === item.content)));
        return next.slice(0, 8);
      });
    } catch (e) {
      console.error('focused suggestion error', e);
      if (!opts?.silent) toast.error(`Could not generate a ${promptLabels[mode]} right now.`);
    } finally {
      if (!opts?.silent) setPromptBusy(null);
    }
  };

  const copySuggestion = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('Copied suggestion');
    } catch {
      toast.error('Could not copy suggestion');
    }
  };

  return (
    <div className="rounded-2xl p-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ background: '#EF4444', boxShadow: '0 0 8px #EF4444' }} />
          <h3 className="text-h5" style={{ color: 'var(--text-1)' }}>
            Live Copilot — {meeting.title}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {!summary && (
            listening ? (
              <Button size="sm" variant="outline" onClick={stopListening}
                style={{ borderColor: '#EF4444', color: '#EF4444' }}>
                <MicOff className="w-3.5 h-3.5 mr-1.5" />
                Stop listening
              </Button>
            ) : (
              <Button size="sm" onClick={startListening} disabled={!sessionId}
                style={{ background: 'linear-gradient(135deg,#A855F7,#06B6D4)', color: '#fff' }}>
                <Mic className="w-3.5 h-3.5 mr-1.5" />
                Start listening
              </Button>
            )
          )}
          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{
              background: listening
                ? 'color-mix(in srgb, #22C55E 18%, transparent)'
                : 'color-mix(in srgb, #EF4444 18%, transparent)',
              color: listening ? '#22C55E' : '#EF4444',
            }}>
            ● {listening ? 'MIC ON' : 'LIVE'}
          </span>

          {summary ? (
            <Button size="sm" variant="outline" onClick={handleClose}>Close</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={endSession} disabled={ending}>
              {ending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Square className="w-3.5 h-3.5 mr-1.5" />}
              End & Summarize
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        {/* Compact header — always visible */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setAudioSetupOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md hover:opacity-80"
            style={{ color: 'var(--text-1)', background: 'color-mix(in srgb, var(--background) 60%, transparent)' }}
            aria-expanded={audioSetupOpen}
          >
            {audioSetupOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Audio setup
          </button>

          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: readyState === 'listening'
                ? 'color-mix(in srgb, var(--c-green) 18%, transparent)'
                : readyState === 'ready'
                  ? 'color-mix(in srgb, var(--c-cyan) 18%, transparent)'
                  : 'color-mix(in srgb, var(--c-orange) 18%, transparent)',
              color: readyState === 'listening' ? 'var(--c-green)' : readyState === 'ready' ? 'var(--c-cyan)' : 'var(--c-orange)',
            }}>
            {readyState === 'listening' ? 'Listening live' : readyState === 'ready' ? 'Ready' : 'Run checks'}
          </span>

          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: extensionCaptureState === 'active'
                ? 'color-mix(in srgb, var(--c-green) 16%, transparent)'
                : extensionCaptureState === 'missing' || extensionCaptureState === 'error'
                  ? 'color-mix(in srgb, var(--c-orange) 14%, transparent)'
                  : 'color-mix(in srgb, var(--c-cyan) 14%, transparent)',
              color: extensionCaptureState === 'active'
                ? 'var(--c-green)'
                : extensionCaptureState === 'missing' || extensionCaptureState === 'error'
                  ? 'var(--c-orange)'
                  : 'var(--c-cyan)',
            }}>
            {extensionCaptureState === 'active' ? 'Tab audio on' : extensionCaptureState === 'missing' ? 'No extension' : extensionCaptureState === 'error' ? 'Ext error' : 'Checking ext'}
          </span>

          {/* Compact live mic meter (always visible) */}
          <div className="flex items-end gap-[2px] h-4 ml-1" title="Live mic level">
            {micBars.slice(0, 14).map((value, index) => (
              <div
                key={`mini-mic-${index}`}
                className="w-[3px] rounded-full transition-all duration-75"
                style={{
                  height: `${Math.max(10, value * 100)}%`,
                  background: value > 0.55 ? 'var(--c-green)' : value > 0.25 ? 'var(--c-cyan)' : 'color-mix(in srgb, var(--c-purple) 45%, transparent)',
                }}
              />
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { setAudioSetupOpen(true); void runMicCheck(); }} disabled={micCheckBusy || !!summary}>
              {micCheckBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <AudioLines className="w-3.5 h-3.5 mr-1.5" />}
              Test mic & speaker
            </Button>
            {!summary && (
              listening ? (
                <Button size="sm" variant="outline" onClick={stopListening}
                  style={{ borderColor: '#EF4444', color: '#EF4444' }}>
                  <MicOff className="w-3.5 h-3.5 mr-1.5" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" onClick={startListening} disabled={!sessionId || micCheckBusy}
                  style={{ background: 'linear-gradient(135deg,#A855F7,#06B6D4)', color: '#fff' }}>
                  <Mic className="w-3.5 h-3.5 mr-1.5" />
                  Start listening
                </Button>
              )
            )}
            <div className="flex items-center gap-2 pl-1">
              <Switch checked={autoJoin} onCheckedChange={setAutoJoin} disabled={!!summary} />
              <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>Auto-join</span>
            </div>
          </div>
        </div>

        {/* Expandable test panel */}
        {audioSetupOpen && (
          <div className="px-3 pb-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--background) 55%, transparent)' }}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-2)' }}>
                    <Waves className="w-3.5 h-3.5" /> Mic activity
                  </div>
                  <span className="text-[11px]" style={{ color: micReady ? 'var(--c-green)' : 'var(--text-2)' }}>{micReady ? 'Mic detected' : 'Waiting for test'}</span>
                </div>
                <div className="flex h-10 items-end gap-1">
                  {micBars.map((value, index) => (
                    <div
                      key={`mic-bar-${index}`}
                      className="flex-1 rounded-full transition-all duration-75"
                      style={{
                        minHeight: 3,
                        height: `${Math.max(6, value * 100)}%`,
                        background: value > 0.6 ? '#22C55E' : value > 0.3 ? '#06B6D4' : 'color-mix(in srgb, var(--c-purple) 50%, transparent)',
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--background) 55%, transparent)' }}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-2)' }}>
                    <Volume2 className="w-3.5 h-3.5" /> Speaker test
                  </div>
                  <span className="text-[11px]" style={{ color: speakerLevel > 0.08 ? 'var(--c-cyan)' : 'var(--text-2)' }}>{speakerLevel > 0.08 ? 'Tone playing' : 'Run audio test'}</span>
                </div>
                <div className="flex h-10 items-end gap-1.5">
                  {speakerBars.map((value, index) => (
                    <div
                      key={`speaker-bar-${index}`}
                      className="flex-1 rounded-full transition-all duration-75"
                      style={{
                        minHeight: 3,
                        height: `${Math.max(6, value * 100)}%`,
                        background: value > 0.55 ? '#06B6D4' : 'color-mix(in srgb, var(--c-cyan) 40%, transparent)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {micCheckMessage && (
              <div className="mt-2 text-[11px]" style={{ color: 'var(--c-green)' }}>{micCheckMessage}</div>
            )}
          </div>
        )}
      </div>


      <div className="mb-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[
          {
            key: 'answer' as const,
            title: 'I need an answer',
            desc: 'Get the strongest answer you can give right now.',
            Icon: Reply,
          },
          {
            key: 'ask' as const,
            title: 'What should I ask?',
            desc: 'Pull a smart next question from the latest context.',
            Icon: HelpCircle,
          },
          {
            key: 'say' as const,
            title: 'What should I say?',
            desc: 'Get the best next statement to move the meeting forward.',
            Icon: MessageSquareQuote,
          },
        ].map(({ key, title, desc, Icon }) => (
          <button
            key={key}
            onClick={() => requestFocusedSuggestion(key)}
            disabled={!sessionId || !suggestionContext.trim() || !!promptBusy || !!summary}
            className="rounded-xl p-4 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-purple) 16%, transparent)' }}>
                {promptBusy === key ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--c-purple)' }} /> : <Icon className="w-4 h-4" style={{ color: 'var(--c-purple)' }} />}
              </div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</div>
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</div>
          </button>
        ))}
      </div>

      {!summary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* WHAT TO ASK */}
          <div className="rounded-2xl p-4"
            style={{ background: 'color-mix(in srgb, var(--c-purple) 6%, var(--surface-2))', border: '1px solid color-mix(in srgb, var(--c-purple) 25%, var(--border))' }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4" style={{ color: 'var(--c-purple)' }} />
                <div className="text-overline" style={{ color: 'var(--text-2)' }}>WHAT TO ASK</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => requestFocusedSuggestion('ask')} disabled={!sessionId || !!promptBusy}>
                {promptBusy === 'ask' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <div className="space-y-2.5 max-h-[24rem] overflow-y-auto pr-1">
              {latestSuggestions.filter((s) => (s.kind || '').toLowerCase() === 'ask').length === 0 && (
                <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                  Listening for moments to ask a sharp follow-up. The Copilot will surface them here automatically.
                </div>
              )}
              {latestSuggestions.filter((s) => (s.kind || '').toLowerCase() === 'ask').map((s) => (
                <SuggestionCard key={s.id} s={s} onCopy={() => copySuggestion(s.content)} accent="var(--c-purple)" />
              ))}
            </div>
          </div>

          {/* WHAT TO ANSWER */}
          <div className="rounded-2xl p-4"
            style={{ background: 'color-mix(in srgb, var(--c-green) 6%, var(--surface-2))', border: '1px solid color-mix(in srgb, var(--c-green) 25%, var(--border))' }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Reply className="w-4 h-4" style={{ color: 'var(--c-green)' }} />
                <div className="text-overline" style={{ color: 'var(--text-2)' }}>WHAT TO ANSWER</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => requestFocusedSuggestion('answer')} disabled={!sessionId || !!promptBusy}>
                {promptBusy === 'answer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <div className="space-y-2.5 max-h-[24rem] overflow-y-auto pr-1">
              {latestSuggestions.filter((s) => ['answer','say','fact'].includes((s.kind || '').toLowerCase())).length === 0 && (
                <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                  When someone asks you a question, the suggested answer pops in here. The Copilot is listening silently.
                </div>
              )}
              {latestSuggestions.filter((s) => ['answer','say','fact'].includes((s.kind || '').toLowerCase())).map((s) => (
                <SuggestionCard key={s.id} s={s} onCopy={() => copySuggestion(s.content)} accent="var(--c-green)" />
              ))}
            </div>
          </div>

          {/* Transcript drawer trigger */}
          <div className="md:col-span-2 flex items-center justify-between gap-3 mt-1">
            <button onClick={() => setTranscriptOpen((v) => !v)}
              className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
              {transcriptOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {transcriptOpen ? 'Hide live transcript' : `Show live transcript (${transcript.length})`}
            </button>
            {listening && (
              <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--c-purple)' }} />
                Listening…
              </span>
            )}
          </div>

          {transcriptOpen && (
            <div className="md:col-span-2 rounded-2xl p-4"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4" style={{ color: 'var(--c-cyan)' }} />
                  <div className="text-overline" style={{ color: 'var(--text-2)' }}>LIVE TRANSCRIPT</div>
                </div>
                {listening && heardPreview && (
                  <div className="text-xs truncate max-w-md" style={{ color: 'var(--text-2)' }}>
                    <span style={{ color: 'var(--c-purple)' }}>● Hearing:</span> {heardPreview}
                  </div>
                )}
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {micError && (
                  <div className="rounded-xl p-3 text-xs" style={{ background: 'color-mix(in srgb, #EF4444 12%, transparent)', color: '#EF4444' }}>{micError}</div>
                )}
                {transcript.length === 0 && (
                  <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                    Waiting for transcript lines…
                  </div>
                )}
                {(() => {
                  // Group consecutive lines from the same speaker into one bubble
                  // so the transcript reads like a conversation, not a stream of
                  // 3-word fragments. Newest group first.
                  const groups: Array<{ id: string; speaker: string; color: string; time: string; text: string }> = [];
                  for (const t of transcript) {
                    const last = groups[groups.length - 1];
                    if (last && last.speaker === t.speaker) {
                      last.text = `${last.text} ${t.text}`.replace(/\s+/g, ' ').trim();
                      last.time = t.time;
                    } else {
                      groups.push({ id: t.id, speaker: t.speaker, color: t.color, time: t.time, text: t.text });
                    }
                  }
                  return [...groups].reverse().map((g) => {
                    const initials = g.speaker
                      .split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
                    return (
                      <div key={g.id} className="rounded-lg p-2.5 flex gap-2.5" style={{ background: 'var(--surface)' }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ background: `color-mix(in srgb, ${g.color} 22%, transparent)`, color: g.color }}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[11px] font-semibold" style={{ color: g.color }}>{g.speaker}</span>
                            <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{g.time}</span>
                          </div>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-1)' }}>{g.text}</p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="mt-3 flex gap-2">
                <select
                  value={speaker}
                  onChange={(e) => setSpeaker(e.target.value)}
                  className="rounded-lg px-2 py-2 text-xs"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                >
                  <option>You</option><option>Other</option><option>Speaker 2</option><option>Speaker 3</option>
                </select>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addLine(); }}
                  placeholder="Type a line manually…"
                  className="flex-1 rounded-lg px-3 py-2 text-xs"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                />
                <Button size="sm" onClick={addLine} disabled={!draft.trim() || !sessionId}>
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="text-overline mb-3 flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            <FileText className="w-3 h-3" /> MEETING SUMMARY
          </div>
          <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
            {summary.summary && (
              <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)' }}>
                <div className="text-overline mb-1.5" style={{ color: 'var(--text-2)' }}>OVERVIEW</div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{summary.summary}</p>
              </div>
            )}
            {Array.isArray(summary.keyDecisions) && summary.keyDecisions.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)' }}>
                <div className="text-overline mb-1.5" style={{ color: 'var(--text-2)' }}>KEY DECISIONS</div>
                <ul className="text-sm space-y-1.5 list-disc pl-4" style={{ color: 'var(--text-1)' }}>
                  {summary.keyDecisions.map((d: string, i: number) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            {Array.isArray(summary.actionItems) && summary.actionItems.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)' }}>
                <div className="text-overline mb-1.5" style={{ color: 'var(--text-2)' }}>ACTION ITEMS</div>
                <ul className="text-sm space-y-1.5 list-disc pl-4" style={{ color: 'var(--text-1)' }}>
                  {summary.actionItems.map((a: string | SummaryActionItem, i: number) => (
                    <li key={i}>{typeof a === 'string' ? a : `${a.title || a.task}${a.owner ? ` — ${a.owner}` : ''}`}</li>
                  ))}
                </ul>
              </div>
            )}
            {summary.draftEmail && (
              <div className="rounded-xl p-4"
                style={{
                  background: 'linear-gradient(135deg, color-mix(in srgb, var(--c-cyan) 14%, transparent), color-mix(in srgb, var(--c-purple) 10%, transparent))',
                  border: '1px solid color-mix(in srgb, var(--c-cyan) 30%, transparent)',
                }}>
                <div className="text-overline mb-1.5" style={{ color: 'var(--text-2)' }}>FOLLOW-UP DRAFT</div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{summary.draftEmail}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s, onCopy, accent }: { s: { id: string; label: string; content: string }; onCopy: () => void; accent: string }) {
  return (
    <div className="rounded-xl p-3"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 14%, transparent), color-mix(in srgb, ${accent} 4%, transparent))`,
        border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
      }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: accent, color: '#fff' }}>{s.label}</span>
        <button onClick={onCopy} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
          style={{ background: 'color-mix(in srgb, var(--background) 75%, transparent)', color: 'var(--text-1)' }}>
          <Copy className="w-3 h-3" /> Copy
        </button>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{s.content}</p>
    </div>
  );
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return h;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Square, Send, Sparkles, Loader2, FileText, MessageSquareQuote, HelpCircle, Reply, Copy, Radio, BadgeCheck, Mic, MicOff, Volume2, Waves, PlugZap, AudioLines } from 'lucide-react';

interface Props {
  meeting: {
    id: string;
    title: string;
  };
  onClose: () => void;
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
const EXTENSION_CHECK_INTERVAL_MS = 4000;
const MIC_VISUAL_BARS = 20;

export default function LiveCopilotSession({ meeting, onClose }: Props) {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState('');
  const [speaker, setSpeaker] = useState('Other');
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'transcript'>('suggestions');
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
  const latestSuggestions = useMemo(
    () => suggestions.filter((item) => item.kind === activeTab || activeTab === 'suggestions').slice(0, 6),
    [activeTab, suggestions],
  );
  const micBars = useMemo(
    () => Array.from({ length: MIC_VISUAL_BARS }, (_, index) => {
      const distance = Math.abs(index - (MIC_VISUAL_BARS - 1) / 2);
      const weight = 1 - distance / ((MIC_VISUAL_BARS - 1) / 2);
      return Math.max(0.18, micLevel * (0.45 + weight * 0.9));
    }),
    [micLevel],
  );
  const speakerBars = useMemo(
    () => Array.from({ length: 12 }, (_, index) => {
      const phase = (index % 4) / 3;
      return Math.max(0.14, speakerLevel * (0.5 + phase));
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
        setTranscript((cur) => {
          if (cur.some((l) => l.id === r.id)) return cur;
          const d = new Date(r.spoken_at || r.created_at);
          const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          const color = r.speaker === 'You'
            ? '#A855F7'
            : SPEAKER_COLORS[Math.abs(hashCode(String(r.speaker || 'Other'))) % SPEAKER_COLORS.length];
          return [...cur, { id: r.id, speaker: r.speaker || 'Other', text: r.text, time, color }];
        });
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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length]);

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
      setActiveTab('suggestions');
      toast.success('Listening — speak normally. Your voice is being transcribed live.');
    } catch (e: any) {
      console.error(e);
      setMicError(e?.message || 'Could not start microphone.');
    }
  };

  const stopListening = () => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
    setHeardPreview(null);
  };

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      releaseMicCheck();
    };
  }, []);



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
    setActiveTab('transcript');
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
      if (data?.suggestions?.length) {
        setActiveTab('suggestions');
      }
    } catch (e: unknown) {
      console.error('suggestion error', e);
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    if (!sessionId) return;
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

  const requestFocusedSuggestion = async (mode: CopilotPromptMode) => {
    if (!sessionId || !suggestionContext.trim()) {
      toast.info('Say something, test the mic, or type a transcript line first so Copilot has context.');
      return;
    }

    const promptLabels: Record<CopilotPromptMode, string> = {
      answer: 'best answer',
      ask: 'best question',
      say: 'best thing to say next',
    };

    setPromptBusy(mode);
    try {
      const { data, error } = await supabase.functions.invoke('meeting-copilot-suggestion', {
        body: {
          sessionId,
            recentTranscript: suggestionContext,
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
        toast.info(`No ${promptLabels[mode]} available yet from the current conversation.`);
        return;
      }

      if (mapped.length > 0) {
        setSuggestions((cur) => {
          const next = [...mapped, ...cur].filter((item, index, arr) => index === arr.findIndex((x) => x.id === item.id || (x.label === item.label && x.content === item.content)));
          return next.slice(0, 8);
        });
      }

      setActiveTab('suggestions');
    } catch (e) {
      console.error('focused suggestion error', e);
      toast.error(`Could not generate a ${promptLabels[mode]} right now.`);
    } finally {
      setPromptBusy(null);
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
            <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={endSession} disabled={ending}>
              {ending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Square className="w-3.5 h-3.5 mr-1.5" />}
              End & Summarize
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Mic setup</div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Test the mic here before joining the meeting. This confirms permission and device access so Copilot can listen.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={runMicCheck} disabled={micCheckBusy || !!summary}>
              {micCheckBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mic className="w-3.5 h-3.5 mr-1.5" />}
              Test mic
            </Button>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{
                background: micReady
                  ? 'color-mix(in srgb, var(--c-green) 16%, transparent)'
                  : 'color-mix(in srgb, var(--c-orange) 14%, transparent)',
                color: micReady ? 'var(--c-green)' : 'var(--c-orange)',
              }}>
              {micReady ? 'Mic ready' : 'Mic not tested'}
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{
                background: extensionCaptureState === 'active'
                  ? 'color-mix(in srgb, var(--c-green) 16%, transparent)'
                  : 'color-mix(in srgb, var(--c-cyan) 14%, transparent)',
                color: extensionCaptureState === 'active' ? 'var(--c-green)' : 'var(--c-cyan)',
              }}>
              {extensionCaptureState === 'active'
                ? 'Tab audio live'
                : extensionCaptureState === 'missing'
                  ? 'Extension not detected'
                  : extensionCaptureState === 'error'
                    ? 'Extension check failed'
                    : extensionCaptureState === 'checking'
                      ? 'Checking extension'
                      : 'Extension ready'}
            </span>
          </div>
        </div>
        {micCheckMessage && (
          <div className="mt-3 text-xs" style={{ color: 'var(--c-green)' }}>{micCheckMessage}</div>
        )}
        <div className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {extensionCaptureState === 'active'
            ? 'Meeting tab audio is actively streaming from the extension.'
            : 'Your microphone test only verifies your own voice. To hear everyone in the meeting, start capture from the InboxIQ browser extension on the meeting tab.'}
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* TRANSCRIPT */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-overline" style={{ color: 'var(--text-2)' }}>LIVE TRANSCRIPT</div>
              <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <Radio className="w-3.5 h-3.5" />
                {transcript.length === 0 ? 'Waiting for microphone or extension transcript lines.' : `${transcript.length} live line${transcript.length === 1 ? '' : 's'} captured.`}
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: 'color-mix(in srgb, var(--c-green) 12%, transparent)', color: 'var(--c-green)' }}>
              <BadgeCheck className="w-3.5 h-3.5" />
              {sessionId ? 'Session live' : 'Starting session...'}
            </div>
          </div>
          <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
            {transcript.length === 0 && (
              <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                Click <strong style={{ color: 'var(--text-1)' }}>Test mic</strong>, then <strong style={{ color: 'var(--text-1)' }}>Start listening</strong> to confirm this page hears you before the meeting begins. For other participants' audio, also start capture in the InboxIQ Chrome extension on the meeting tab.
              </div>
            )}
            {micError && (
              <div className="rounded-xl p-3 text-xs" style={{ background: 'color-mix(in srgb, #EF4444 12%, transparent)', color: '#EF4444', border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)' }}>
                {micError}
              </div>
            )}
            {transcript.map((t) => (
              <div key={t.id} className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold" style={{ color: t.color }}>● {t.speaker}</span>
                  <span className="text-xs" style={{ color: 'var(--text-2)' }}>{t.time}</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{t.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>

          {!summary && (
            <div className="mt-3 flex gap-2">
              <select
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value)}
                className="rounded-xl px-2 py-2 text-sm"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              >
                <option>You</option>
                <option>Other</option>
                <option>Speaker 2</option>
                <option>Speaker 3</option>
              </select>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addLine(); }}
                placeholder="Add a line to the transcript…"
                className="flex-1 rounded-xl px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              />
              <Button size="sm" onClick={addLine} disabled={!draft.trim() || !sessionId}>
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* SUGGESTIONS / SUMMARY */}
        <div>
          {!summary ? (
            <>
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'suggestions' | 'transcript')}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-overline flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                    COPILOT PANEL
                    {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                  </div>
                  <TabsList>
                    <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
                    <TabsTrigger value="transcript">Transcript</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="suggestions" className="mt-0">
                  <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                    {suggestions.length === 0 && (
                      <div className="rounded-xl p-4 text-sm flex items-start gap-2"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                        <Sparkles className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--c-purple)' }} />
                        Suggestions will show up here from the live conversation. You can also use the quick actions above any time you need an answer or a question.
                      </div>
                    )}
                    {suggestions.map((s) => (
                      <div key={s.id} className="rounded-xl p-4"
                        style={{
                          background: 'linear-gradient(135deg, color-mix(in srgb, var(--c-purple) 18%, transparent), color-mix(in srgb, var(--c-cyan) 12%, transparent))',
                          border: '1px solid color-mix(in srgb, var(--c-purple) 30%, transparent)',
                        }}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-bold px-2 py-0.5 rounded-md"
                            style={{ background: 'var(--c-purple)', color: '#FFFFFF' }}>{s.label}</span>
                          <button
                            onClick={() => copySuggestion(s.content)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                            style={{ background: 'color-mix(in srgb, var(--background) 75%, transparent)', color: 'var(--text-1)' }}
                          >
                            <Copy className="w-3 h-3" /> Copy
                          </button>
                        </div>
                        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{s.content}</p>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="transcript" className="mt-0">
                  <div className="rounded-xl p-4 text-sm max-h-[28rem] overflow-y-auto" style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>
                    {transcript.length === 0 ? (
                      <span style={{ color: 'var(--text-2)' }}>No live transcript yet.</span>
                    ) : (
                      <div className="space-y-3">
                        {transcript.map((t) => (
                          <div key={`mirror-${t.id}`}>
                            <div className="text-xs font-semibold mb-1" style={{ color: t.color }}>{t.speaker} · {t.time}</div>
                            <div className="text-sm leading-relaxed">{t.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <>
              <div className="text-overline mb-3 flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                <FileText className="w-3 h-3" /> MEETING SUMMARY
              </div>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return h;
}

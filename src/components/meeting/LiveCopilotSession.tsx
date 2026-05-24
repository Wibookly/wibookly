import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Square, Send, Sparkles, Loader2, FileText, MessageSquareQuote, HelpCircle, Reply, Copy, Radio, BadgeCheck, Mic, MicOff, Volume2, Waves, AudioLines, ChevronDown, ChevronUp, Users, Pencil } from 'lucide-react';
import { useDeepgramTranscription, type DiarizedUtterance } from '@/hooks/useDeepgramTranscription';


interface Props {
  meeting: {
    id: string;
    title: string;
  };
  onClose: () => void;
  autoStart?: boolean;
  /** Optional scheduled duration in minutes — drives the live countdown. */
  durationMinutes?: number;
  /** Optional fixed start time (ISO); defaults to when the session row is created. */
  scheduledStartIso?: string;
  /** Optional attendee names — pre-populates the speaker chips so the transcript can label lines. */
  initialAttendees?: string[];
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
  followup_email?: {
    subject?: string;
    body_html?: string;
    body_text?: string;
  };
  recapEmailStatus?: 'sent' | 'failed' | 'skipped';
  recapEmailSentAt?: string | null;
}

type CopilotPromptMode = 'answer' | 'ask' | 'say';

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal?: boolean;
    0?: { transcript?: string };
  }>;
};

type BrowserSpeechRecognitionErrorEvent = {
  error?: string;
  message?: string;
  name?: string;
};

type BrowserSpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionInstance;

type WindowWithSpeechRecognition = Window & typeof globalThis & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

const SPEAKER_COLORS = ['#22C55E', '#A855F7', '#06B6D4', '#F97316', '#EC4899'];
const MIC_VISUAL_BARS = 20;

export default function LiveCopilotSession({ meeting, onClose, autoStart = false, durationMinutes, scheduledStartIso, initialAttendees }: Props) {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState('');
  const initialSpeaker = (initialAttendees && initialAttendees[0]) || 'You';
  const initialChips = useMemo(() => {
    const names = (initialAttendees || []).map((n) => n.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const n of [...names, 'You']) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(n);
    }
    return unique.slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [speaker, setSpeaker] = useState(initialSpeaker);
  const [recentSpeakers, setRecentSpeakers] = useState<string[]>(initialChips);
  const speakerRef = useRef(initialSpeaker);
  useEffect(() => { speakerRef.current = speaker; }, [speaker]);
  const pickSpeaker = useCallback((name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setSpeaker(clean);
    setRecentSpeakers((cur) => {
      const next = [clean, ...cur.filter((s) => s.toLowerCase() !== clean.toLowerCase())];
      return next.slice(0, 6);
    });
  }, []);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [promptBusy, setPromptBusy] = useState<CopilotPromptMode | null>(null);
  const [focusedSuggestions, setFocusedSuggestions] = useState<Record<CopilotPromptMode, Suggestion[]>>({ answer: [], ask: [], say: [] });
  const [autoDraftFollowup, setAutoDraftFollowup] = useState(true);

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
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [focusMode, setFocusMode] = useState<CopilotPromptMode | null>(null);

  // Diarization: maps Deepgram speaker id (0,1,2,...) → display name.
  // Defaults to "Speaker N" until the user renames it. Pre-seed from attendees.
  const [speakerNames, setSpeakerNames] = useState<Record<number, string>>(() => {
    const seed: Record<number, string> = {};
    (initialAttendees || []).forEach((name, i) => { if (name?.trim()) seed[i] = name.trim(); });
    return seed;
  });
  const speakerNamesRef = useRef(speakerNames);
  useEffect(() => { speakerNamesRef.current = speakerNames; }, [speakerNames]);
  const [detectedSpeakers, setDetectedSpeakers] = useState<number[]>([]);
  const [interimLine, setInterimLine] = useState<{ text: string; speakerId: number | null } | null>(null);
  const interimTimerRef = useRef<number | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognitionInstance | null>(null);
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
  const lastSpeechAtRef = useRef<number>(0);
  const watchdogRef = useRef<number | null>(null);
  const transcriptFlushTimerRef = useRef<number | null>(null);
  const transcriptBufferRef = useRef('');

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('meeting_copilot_settings')
        .select('auto_draft_followup')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!cancelled && data) {
        setAutoDraftFollowup(data.auto_draft_followup ?? true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const transcriptContext = useMemo(
    () => transcript.slice(-10).map((line) => `${line.speaker}: ${line.text}`).join('\n'),
    [transcript],
  );
  const suggestionContext = useMemo(
    () => transcriptContext.trim() || draft.trim(),
    [draft, transcriptContext],
  );
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

  // Track meeting start time for elapsed / remaining clock.
  const [startedAtMs, setStartedAtMs] = useState<number | null>(() => {
    if (scheduledStartIso) {
      const t = Date.parse(scheduledStartIso);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Create session on mount
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: existing } = await supabase
        .from('meeting_sessions')
        .select('id, started_at')
        .eq('user_id', user.id)
        .eq('meeting_external_id', meeting.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        if (!cancelled) {
          setSessionId(existing.id);
          if (existing.started_at) {
            const t = Date.parse(existing.started_at as string);
            if (Number.isFinite(t)) setStartedAtMs(t);
          }
        }
        return;
      }

      const startIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('meeting_sessions')
        .insert({
          user_id: user.id,
          meeting_external_id: meeting.id,
          meeting_title: meeting.title,
          status: 'active',
          started_at: startIso,
        })
        .select('id, started_at')
        .single();
      if (error) {
        toast.error('Could not start Copilot session');
        return;
      }
      if (cancelled) return;
      setSessionId(data.id);
      const t = Date.parse((data.started_at as string) || startIso);
      if (Number.isFinite(t)) setStartedAtMs(t);
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

  // --- Persist a heard / typed line. `overrideSpeaker` is used by Deepgram
  // diarization so each line gets its detected speaker, not the manual one.
  const pushHeardLine = async (text: string, overrideSpeaker?: string) => {
    const sid = sessionIdRef.current;
    const uid = userIdRef.current;
    if (!sid || !uid) return;
    const clean = text.trim();
    if (!clean) return;
    // de-dupe rapid duplicates
    const now = Date.now();
    if (clean === lastInsertRef.current.text && now - lastInsertRef.current.at < 4000) return;
    lastInsertRef.current = { text: clean, at: now };

    const currentSpeaker = (overrideSpeaker ?? speakerRef.current ?? 'You').trim() || 'You';
    await supabase.from('meeting_transcripts').insert({
      session_id: sid,
      user_id: uid,
      speaker: currentSpeaker,
      text: clean,
      spoken_at: new Date().toISOString(),
    });

    // fire suggestion in the background
    try {
      const recent = [...transcript.slice(-5), { speaker: currentSpeaker, text: clean }]
        .map((l) => `${l.speaker}: ${l.text}`).join('\n');
      supabase.functions.invoke('meeting-copilot-suggestion', {
        body: { sessionId: sid, recentTranscript: recent },
      }).catch(() => {});
    } catch { /* ignore */ }
  };

  // Map a diarized speaker id to a display name. Defaults to "Speaker N".
  const speakerLabelFor = useCallback((id: number) => {
    const named = speakerNamesRef.current[id];
    if (named && named.trim()) return named.trim();
    return `Speaker ${id + 1}`;
  }, []);

  // Deepgram emits one of these for every committed utterance, already
  // grouped by speaker (so two people interrupting each other yield two lines).
  const handleDiarizedUtterance = useCallback((u: DiarizedUtterance) => {
    setDetectedSpeakers((cur) => (cur.includes(u.speakerId) ? cur : [...cur, u.speakerId].sort((a, b) => a - b)));
    setInterimLine(null);
    if (interimTimerRef.current) { window.clearTimeout(interimTimerRef.current); interimTimerRef.current = null; }
    void pushHeardLine(u.text, speakerLabelFor(u.speakerId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakerLabelFor]);

  const handleInterim = useCallback((text: string, speakerId: number | null) => {
    setInterimLine({ text, speakerId });
    setHeardPreview(text);
    if (interimTimerRef.current) window.clearTimeout(interimTimerRef.current);
    interimTimerRef.current = window.setTimeout(() => setInterimLine(null), 2500);
  }, []);

  const handleDeepgramError = useCallback((msg: string) => {
    setMicError(msg);
    toast.error(msg);
  }, []);

  const deepgram = useDeepgramTranscription({
    onFinalUtterance: handleDiarizedUtterance,
    onInterim: handleInterim,
    onError: handleDeepgramError,
  });


  const clearTranscriptFlushTimer = () => {
    if (transcriptFlushTimerRef.current) {
      window.clearTimeout(transcriptFlushTimerRef.current);
      transcriptFlushTimerRef.current = null;
    }
  };

  const flushTranscriptBuffer = async (forceText?: string) => {
    const candidate = (forceText ?? transcriptBufferRef.current).replace(/\s+/g, ' ').trim();
    clearTranscriptFlushTimer();
    if (!candidate) return;
    transcriptBufferRef.current = '';
    await pushHeardLine(candidate);
  };

  const queueTranscriptChunk = (text: string, isFinal = false) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    transcriptBufferRef.current = normalized;
    setHeardPreview(normalized);
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => setHeardPreview(null), 1800);

    clearTranscriptFlushTimer();
    transcriptFlushTimerRef.current = window.setTimeout(() => {
      void flushTranscriptBuffer();
    }, isFinal ? 250 : 1200);
  };

  const releaseMicCheck = useCallback(() => {
    try { micStreamRef.current?.getTracks().forEach((track) => track.stop()); } catch { /* ignore */ }
    micStreamRef.current = null;
    stopAudioMeters();
  }, []);

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
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setMicReady(false);
      const message = err?.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in the browser prompt or site settings, then test again.'
        : err?.name === 'NotFoundError'
          ? 'No microphone was detected on this device.'
          : err?.name === 'NotReadableError'
            ? 'The microphone is busy in another app or browser tab.'
            : (err?.message || 'Could not access the microphone.');
      setMicError(message);
      toast.error(message);
    } finally {
      setMicCheckBusy(false);
    }
  };

  const startListening = async () => {
    setMicError(null);
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
      shouldListenRef.current = true;
      await deepgram.start(micStreamRef.current);
      setListening(true);
      lastSpeechAtRef.current = Date.now();

      // If mic track ends (device unplugged, OS revoke), stop cleanly.
      const track = micStreamRef.current?.getAudioTracks?.()[0];
      if (track) {
        track.onended = () => {
          if (shouldListenRef.current) {
            setMicError('Microphone was disconnected. Click Start listening to resume.');
            stopListening();
          }
        };
      }

      toast.success('Listening with speaker detection — Deepgram Nova-3.');
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setMicError(err?.message || 'Could not start microphone.');
    }
  };

  const stopListening = () => {
    shouldListenRef.current = false;
    if (watchdogRef.current) {
      window.clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    deepgram.stop();
    setListening(false);
    setHeardPreview(null);
    setInterimLine(null);
    if (interimTimerRef.current) { window.clearTimeout(interimTimerRef.current); interimTimerRef.current = null; }
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
      if (watchdogRef.current) {
        window.clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
      clearTranscriptFlushTimer();
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      try { recognitionRef.current?.abort?.(); } catch { /* ignore */ }
      recognitionRef.current = null;
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      releaseMicCheck();
    };
  }, [releaseMicCheck]);


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
      setSummary((data
        ? {
            ...(data as MeetingSummary),
            draftEmail: (data as MeetingSummary).followup_email?.body_text
              || (data as MeetingSummary).followup_email?.body_html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              || (data as MeetingSummary).draftEmail,
            recapEmailStatus: (data as any).recapEmailStatus,
            recapEmailSentAt: (data as any).recapEmailSentAt,
          }
        : null) as MeetingSummary | null);
      const status = (data as any)?.recapEmailStatus;
      if (status === 'sent') toast.success('Recap emailed to you with the full transcript attached');
      else if (status === 'failed') toast.warning('Summary ready — but emailing the recap failed. Check your Outlook connection.');
      else toast.success('Session ended — summary ready');
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

      const best = mapped[0];
      if (best) {
        setFocusedSuggestions((cur) => {
          const prev = cur[mode] || [];
          // Avoid duplicate consecutive content
          if (prev.length && prev[0].content === best.content) return cur;
          return { ...cur, [mode]: [best, ...prev].slice(0, 10) };
        });
      }

      setSuggestions((cur) => {
        const filtered = cur.filter((item) => (item.kind || '').toLowerCase() !== mode);
        const next = [...mapped, ...filtered].filter((item, index, arr) => index === arr.findIndex((x) => x.id === item.id || (x.label === item.label && x.content === item.content)));
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

  // Live clock derivations
  const elapsedSec = startedAtMs ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)) : 0;
  const totalSec = durationMinutes && durationMinutes > 0 ? durationMinutes * 60 : null;
  const remainingSec = totalSec !== null ? Math.max(0, totalSec - elapsedSec) : null;
  const fmtClock = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return `${m}:${String(ss).padStart(2, '0')}`;
  };
  const overtime = totalSec !== null && elapsedSec > totalSec;

  return (
    <div className="rounded-2xl p-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ background: '#EF4444', boxShadow: '0 0 8px #EF4444' }} />
          <h3 className="text-h5 truncate" style={{ color: 'var(--text-1)' }}>
            Live Copilot — {meeting.title}
          </h3>
        </div>

        {/* Meeting timer */}
        {startedAtMs && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-1.5"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>
              Elapsed
            </span>
            <span className="font-mono text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
              {fmtClock(elapsedSec)}
            </span>
            {remainingSec !== null && (
              <>
                <span className="mx-1 opacity-40">·</span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>
                  {overtime ? 'Over' : 'Left'}
                </span>
                <span
                  className="font-mono text-sm font-bold tabular-nums"
                  style={{
                    color: overtime ? '#EF4444' : remainingSec <= 300 ? '#F59E0B' : '#22C55E',
                  }}
                >
                  {fmtClock(overtime ? elapsedSec - (totalSec || 0) : remainingSec)}
                </span>
              </>
            )}
          </div>
        )}

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
              background: summary
                ? 'color-mix(in srgb, #6B7280 18%, transparent)'
                : listening
                  ? 'color-mix(in srgb, #22C55E 18%, transparent)'
                  : 'color-mix(in srgb, #EF4444 18%, transparent)',
              color: summary ? '#6B7280' : listening ? '#22C55E' : '#EF4444',
            }}>
            ● {summary ? 'ENDED' : listening ? 'MIC ON' : 'LIVE'}
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
        ].map(({ key, title, desc, Icon }) => {
          const active = focusMode === key;
          return (
            <button
              key={key}
              onClick={() => { setFocusMode(key); void requestFocusedSuggestion(key); }}
              disabled={!sessionId || !!promptBusy || !!summary}
              className="rounded-xl p-4 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: active
                  ? 'color-mix(in srgb, var(--c-purple) 14%, var(--surface-2))'
                  : 'var(--surface-2)',
                border: active
                  ? '1px solid color-mix(in srgb, var(--c-purple) 55%, var(--border))'
                  : '1px solid var(--border)',
                boxShadow: active ? '0 0 0 3px color-mix(in srgb, var(--c-purple) 18%, transparent)' : 'none',
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-purple) 16%, transparent)' }}>
                  {promptBusy === key ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--c-purple)' }} /> : <Icon className="w-4 h-4" style={{ color: 'var(--c-purple)' }} />}
                </div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</div>
              </div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</div>
            </button>
          );
        })}
      </div>

      {!summary ? (
        <div className="grid grid-cols-1 gap-4">
          {/* Single Copilot panel driven by the top button selection */}
          {(() => {
            const meta: Record<CopilotPromptMode, { label: string; Icon: typeof Reply; accent: string; filter: (kind: string) => boolean; empty: string }> = {
              answer: {
                label: 'SUGGESTED ANSWER',
                Icon: Reply,
                accent: 'var(--c-green)',
                filter: (k) => ['answer','say','fact'].includes(k),
                empty: 'Click “I need an answer” to get the strongest answer you can give right now.',
              },
              ask: {
                label: 'SUGGESTED QUESTION',
                Icon: HelpCircle,
                accent: 'var(--c-purple)',
                filter: (k) => k === 'ask',
                empty: 'Click “What should I ask?” to pull a smart next question from the latest context.',
              },
              say: {
                label: 'WHAT TO SAY NEXT',
                Icon: MessageSquareQuote,
                accent: 'var(--c-cyan)',
                filter: (k) => ['say','answer','fact'].includes(k),
                empty: 'Click “What should I say?” to get the best next statement to move the meeting forward.',
              },
            };
            const idle = !focusMode;
            const cfg = focusMode ? meta[focusMode] : null;
            const history = focusMode ? (focusedSuggestions[focusMode] || []) : [];
            const items = cfg
              ? history.filter((s) => cfg.filter((s.kind || '').toLowerCase()))
              : [];
            const accent = cfg?.accent ?? 'var(--c-purple)';
            return (
              <div className="rounded-2xl p-4"
                style={{
                  background: `color-mix(in srgb, ${accent} 6%, var(--surface-2))`,
                  border: `1px solid color-mix(in srgb, ${accent} 25%, var(--border))`,
                  minHeight: '14rem',
                }}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {cfg ? <cfg.Icon className="w-4 h-4" style={{ color: accent }} /> : <Sparkles className="w-4 h-4" style={{ color: 'var(--text-2)' }} />}
                    <div className="text-overline" style={{ color: 'var(--text-2)' }}>
                      {cfg ? `${cfg.label}${items.length > 1 ? ` · ${items.length} saved` : ''}` : 'PICK A COPILOT ACTION ABOVE'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {focusMode && items.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setFocusedSuggestions((cur) => ({ ...cur, [focusMode]: [] }))}>
                        Clear
                      </Button>
                    )}
                    {focusMode && (
                      <Button size="sm" variant="outline" onClick={() => requestFocusedSuggestion(focusMode)} disabled={!sessionId || !!promptBusy}>
                        {promptBusy === focusMode ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                        {items.length > 0 ? 'Get another' : 'Regenerate'}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2.5 max-h-[36rem] overflow-y-auto pr-1">
                  {idle && (
                    <div className="rounded-xl p-4 text-xs text-center" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                      The Copilot is listening in the background. Tap one of the three actions above whenever you need help — the answer, question, or talking point will appear here.
                    </div>
                  )}
                  {!idle && promptBusy === focusMode && items.length === 0 && (
                    <div className="rounded-xl p-4 text-xs flex items-center gap-2" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating the best response from the latest context…
                    </div>
                  )}
                  {!idle && promptBusy !== focusMode && items.length === 0 && cfg && (
                    <div className="rounded-xl p-4 text-xs" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                      {cfg.empty}
                    </div>
                  )}
                  {items.map((s, idx) => (
                    <div key={s.id || idx} style={{ opacity: idx === 0 ? 1 : 0.85 }}>
                      {idx > 0 && (
                        <div className="text-[10px] uppercase tracking-wider mb-1 px-1" style={{ color: 'var(--text-2)' }}>
                          Previous #{items.length - idx}
                        </div>
                      )}
                      <SuggestionCard s={s} onCopy={() => copySuggestion(s.content)} accent={accent} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}


          {/* Attendees manager — feeds the SPEAKING NOW chips so the live transcript can attribute lines per person. */}
          <div className="rounded-2xl p-3"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-overline" style={{ color: 'var(--text-2)' }}>ATTENDEES</span>
              <input
                defaultValue={recentSpeakers.filter((n) => n.toLowerCase() !== 'you').join(', ')}
                onBlur={(e) => {
                  const names = e.target.value.split(',').map((n) => n.trim()).filter(Boolean);
                  const seen = new Set<string>();
                  const merged: string[] = [];
                  for (const n of [...names, 'You']) {
                    const k = n.toLowerCase();
                    if (seen.has(k)) continue;
                    seen.add(k);
                    merged.push(n);
                  }
                  setRecentSpeakers(merged.slice(0, 6));
                  if (names[0]) setSpeaker(names[0]);
                }}
                placeholder="Add attendee names separated by commas (e.g. Ali, Nikki, Sara)"
                className="flex-1 min-w-[220px] rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              />
              <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                Press Tab to save.
              </span>
            </div>
            {recentSpeakers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recentSpeakers.map((name) => (
                  <span key={`att-${name}`} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      background: name.toLowerCase() === 'you' ? 'color-mix(in srgb, var(--c-purple) 16%, transparent)' : 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-1)',
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: name.toLowerCase() === 'you' ? 'var(--c-purple)' : SPEAKER_COLORS[Math.abs(hashCode(name)) % SPEAKER_COLORS.length] }} />
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Detected speakers — auto-populated by Deepgram diarization.
              Rename "Speaker N" to a real name; the rename retroactively
              updates lines already attributed to that speaker. */}
          <div className="md:col-span-2 rounded-2xl p-3"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-3.5 h-3.5" style={{ color: 'var(--c-purple)' }} />
              <span className="text-overline" style={{ color: 'var(--text-2)' }}>DETECTED SPEAKERS</span>
              <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                Auto-separated by voice — rename to real names.
              </span>
            </div>
            {detectedSpeakers.length === 0 ? (
              <div className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                {listening ? 'Listening — speaker labels will appear after the first few sentences.' : 'Start listening to detect speakers.'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detectedSpeakers.map((id) => {
                  const color = SPEAKER_COLORS[id % SPEAKER_COLORS.length];
                  const current = speakerNames[id] ?? '';
                  return (
                    <div key={`spk-${id}`} className="flex items-center gap-1.5 rounded-full pl-1.5 pr-2 py-1"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      <span className="text-[11px] font-semibold" style={{ color }}>S{id + 1}</span>
                      <Pencil className="w-3 h-3 opacity-50" />
                      <input
                        value={current}
                        data-prev={current || `Speaker ${id + 1}`}
                        onFocus={(e) => { e.currentTarget.dataset.prev = current || `Speaker ${id + 1}`; }}
                        onChange={(e) => setSpeakerNames((cur) => ({ ...cur, [id]: e.target.value }))}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const oldLabel = e.currentTarget.dataset.prev || `Speaker ${id + 1}`;
                          if (!v || v === oldLabel) return;
                          // Update local UI immediately…
                          setTranscript((cur) => cur.map((l) => l.speaker === oldLabel ? { ...l, speaker: v } : l));
                          // …and persist so the recap/summary uses the real name.
                          const sid = sessionIdRef.current;
                          if (sid) {
                            supabase.from('meeting_transcripts')
                              .update({ speaker: v })
                              .eq('session_id', sid)
                              .eq('speaker', oldLabel)
                              .then(({ error }) => { if (error) console.warn('rename speaker failed', error); });
                          }
                        }}
                        placeholder={`Speaker ${id + 1}`}
                        className="bg-transparent text-[11px] outline-none w-24"
                        style={{ color: 'var(--text-1)' }}
                      />

                    </div>
                  );
                })}
              </div>
            )}
            {interimLine && (
              <div className="mt-2 text-[11px] italic" style={{ color: 'var(--text-2)' }}>
                <span style={{ color: 'var(--c-purple)' }}>
                  {interimLine.speakerId !== null ? speakerLabelFor(interimLine.speakerId) : 'Listening'}:
                </span>{' '}
                {interimLine.text}…
              </div>
            )}
          </div>

          {/* Speaker name used for manually typed lines only. */}
          <div className="md:col-span-2 rounded-2xl p-3 flex flex-wrap items-center gap-2"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <span className="text-overline" style={{ color: 'var(--text-2)' }}>TYPED-LINE SPEAKER</span>
            <input
              value={speaker}
              onChange={(e) => setSpeaker(e.target.value)}
              onBlur={(e) => pickSpeaker(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickSpeaker((e.target as HTMLInputElement).value); } }}
              placeholder="Name used for manually typed lines (default: You)"
              className="flex-1 min-w-[180px] rounded-lg px-3 py-1.5 text-xs"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
            <div className="flex flex-wrap gap-1.5">
              {recentSpeakers.map((name) => {
                const active = name.toLowerCase() === speaker.trim().toLowerCase();
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => pickSpeaker(name)}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      background: active ? 'var(--c-purple)' : 'var(--surface)',
                      color: active ? '#fff' : 'var(--text-1)',
                      border: '1px solid var(--border)',
                    }}
                  >{name}</button>
                );
              })}
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
                Listening as <strong style={{ color: 'var(--text-1)' }}>{speaker || 'You'}</strong>…
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
              </div>

              <div className="space-y-2 max-h-[60vh] min-h-[20rem] overflow-y-auto pr-1">
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
                <input
                  value={speaker}
                  onChange={(e) => setSpeaker(e.target.value)}
                  onBlur={(e) => pickSpeaker(e.target.value)}
                  placeholder="Speaker"
                  className="w-28 rounded-lg px-2 py-2 text-xs"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                />
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
          <div className="text-overline mb-3 flex items-center justify-between gap-2" style={{ color: 'var(--text-2)' }}>
            <span className="flex items-center gap-2"><FileText className="w-3 h-3" /> MEETING SUMMARY</span>
            {summary.recapEmailStatus === 'sent' && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'color-mix(in srgb, #22C55E 18%, transparent)', color: '#22C55E' }}>
                <Send className="w-3 h-3" /> Sent to your email
              </span>
            )}
            {summary.recapEmailStatus === 'failed' && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'color-mix(in srgb, #EF4444 18%, transparent)', color: '#EF4444' }}>
                Email send failed — check Outlook connection
              </span>
            )}
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

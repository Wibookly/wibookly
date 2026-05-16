import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Mic, Square, Send, Sparkles, Loader2, FileText } from 'lucide-react';

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

const SPEAKER_COLORS = ['#22C55E', '#A855F7', '#06B6D4', '#F97316', '#EC4899'];

export default function LiveCopilotSession({ meeting, onClose }: Props) {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState('');
  const [speaker, setSpeaker] = useState('Other');
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Create session on mount
  useEffect(() => {
    if (!user) return;
    (async () => {
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
      setSessionId(data.id);
    })();
  }, [user, meeting.id, meeting.title]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length]);

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
    setTranscript((t) => [...t, newLine]);
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
        const mapped: Suggestion[] = data.suggestions.map((s: any, i: number) => ({
          id: `${Date.now()}-${i}`,
          label: (s.type || s.kind || 'Suggestion').toUpperCase(),
          content: s.content || s.text || '',
          kind: s.type,
        }));
        setSuggestions((cur) => [...mapped, ...cur].slice(0, 6));
      }
    } catch (e: any) {
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
      setSummary(data);
      toast.success('Session ended — summary ready');
    } catch (e: any) {
      console.error(e);
      toast.error('Could not generate summary');
    } finally {
      setEnding(false);
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
          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: 'color-mix(in srgb, #EF4444 18%, transparent)', color: '#EF4444' }}>
            ● LIVE
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* TRANSCRIPT */}
        <div>
          <div className="text-overline mb-3" style={{ color: 'var(--text-2)' }}>LIVE TRANSCRIPT</div>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {transcript.length === 0 && (
              <div className="text-sm" style={{ color: 'var(--text-2)' }}>
                Type or paste what's being said below. The Chrome extension will populate this automatically once installed.
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
              <div className="text-overline mb-3 flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                AI SUGGESTIONS
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              </div>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {suggestions.length === 0 && (
                  <div className="rounded-xl p-4 text-sm flex items-start gap-2"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                    <Sparkles className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--c-purple)' }} />
                    Suggestions will appear here as the conversation develops.
                  </div>
                )}
                {suggestions.map((s) => (
                  <div key={s.id} className="rounded-xl p-4"
                    style={{
                      background: 'linear-gradient(135deg, color-mix(in srgb, var(--c-purple) 18%, transparent), color-mix(in srgb, var(--c-cyan) 12%, transparent))',
                      border: '1px solid color-mix(in srgb, var(--c-purple) 30%, transparent)',
                    }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md"
                        style={{ background: 'var(--c-purple)', color: '#FFFFFF' }}>{s.label}</span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{s.content}</p>
                  </div>
                ))}
              </div>
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
                      {summary.actionItems.map((a: any, i: number) => (
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

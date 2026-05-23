import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import {
  ArrowLeft, Calendar, Clock, Users, CheckCircle, FileText, Sparkles,
  Download, Printer, Mail, Copy, ListChecks, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Session {
  id: string;
  meeting_title: string;
  platform: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  attendees: unknown;
  status: string;
  summary: string | null;
  key_decisions: unknown;
  followup_subject: string | null;
  followup_body_html: string | null;
  summary_generated_at: string | null;
}
interface Transcript { id: string; speaker: string | null; text: string; spoken_at: string; }
interface ActionItem { id: string; description: string; assigned_to: string | null; due_date: string | null; completed: boolean; }
interface Suggestion { id: string; content: string; suggestion_type: string | null; generated_at: string; }

const fmtDate = (iso: string) => new Date(iso).toLocaleString([], {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const fmtDuration = (secs: number | null) => {
  if (!secs) return '—';
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const stripHtmlToText = (html: string) => html
  .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|ul|ol)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<li>/gi, '• ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const groupTranscript = (items: Transcript[]) => {
  return items.reduce<Array<Transcript & { count: number }>>((acc, item) => {
    const speaker = item.speaker || 'Speaker';
    const text = item.text.replace(/\s+/g, ' ').trim();
    if (!text) return acc;
    const last = acc[acc.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`.replace(/\s+/g, ' ').trim();
      last.spoken_at = item.spoken_at;
      last.count += 1;
      return acc;
    }
    acc.push({ ...item, speaker, text, count: 1 });
    return acc;
  }, []);
};

export default function MeetingSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    const [{ data: s }, { data: t }, { data: a }, { data: g }] = await Promise.all([
      supabase.from('meeting_sessions').select('*').eq('id', id).maybeSingle(),
      supabase.from('meeting_transcripts').select('id, speaker, text, spoken_at').eq('session_id', id).order('spoken_at'),
      supabase.from('meeting_action_items').select('id, description, assigned_to, due_date, completed').eq('session_id', id).order('created_at'),
      supabase.from('meeting_suggestions').select('id, content, suggestion_type, generated_at').eq('session_id', id).order('generated_at'),
    ]);
    setSession((s as Session) || null);
    setTranscripts((t as Transcript[]) || []);
    setActions((a as ActionItem[]) || []);
    setSuggestions((g as Suggestion[]) || []);
    setLoading(false);
  }, [id, user]);

  useEffect(() => { void load(); }, [load]);

  const decisions: string[] = useMemo(() => {
    const k = session?.key_decisions;
    return Array.isArray(k) ? (k as unknown[]).map((x) => String(x)) : [];
  }, [session]);

  const attendeeList: string[] = useMemo(() => {
    const a = session?.attendees;
    return Array.isArray(a) ? (a as unknown[]).map((x) => String(x)) : [];
  }, [session]);

  const groupedTranscript = useMemo(() => groupTranscript(transcripts), [transcripts]);

  const toggleAction = async (aid: string, next: boolean) => {
    setActions((cur) => cur.map((x) => x.id === aid ? { ...x, completed: next } : x));
    await supabase.from('meeting_action_items').update({ completed: next }).eq('id', aid);
  };

  const regenerateSummary = async () => {
    if (!id) return;
    setRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('meeting-copilot-summary', { body: { sessionId: id } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success('Summary refreshed');
      await load();
    } catch (e) {
      toast.error(`Could not regenerate: ${(e as Error).message}`);
    } finally {
      setRegenerating(false);
    }
  };

  const buildMarkdown = () => {
    if (!session) return '';
    const lines: string[] = [];
    lines.push(`# ${session.meeting_title}`);
    lines.push('');
    lines.push(`**Date:** ${fmtDate(session.started_at)}`);
    if (session.ended_at) lines.push(`**Ended:** ${fmtDate(session.ended_at)}`);
    lines.push(`**Duration:** ${fmtDuration(session.duration_seconds)}`);
    if (session.platform) lines.push(`**Platform:** ${session.platform}`);
    if (attendeeList.length) lines.push(`**Attendees:** ${attendeeList.join(', ')}`);
    lines.push('');
    if (session.summary) { lines.push('## Summary'); lines.push(session.summary); lines.push(''); }
    if (decisions.length) { lines.push('## Key Decisions'); decisions.forEach((d) => lines.push(`- ${d}`)); lines.push(''); }
    if (actions.length) {
      lines.push('## Action Items');
      actions.forEach((a) => {
        const owner = a.assigned_to ? ` _(owner: ${a.assigned_to})_` : '';
        const due = a.due_date ? ` _(due: ${a.due_date})_` : '';
        lines.push(`- [${a.completed ? 'x' : ' '}] ${a.description}${owner}${due}`);
      });
      lines.push('');
    }
    if (session.followup_subject || session.followup_body_html) {
      lines.push('## Suggested Follow-up Email');
      if (session.followup_subject) lines.push(`**Subject:** ${session.followup_subject}`);
      if (session.followup_body_html) {
        lines.push('');
        lines.push(stripHtmlToText(session.followup_body_html));
      }
      lines.push('');
    }
    if (transcripts.length) {
      lines.push('## Full Transcript');
      groupedTranscript.forEach((t) => lines.push(`- **${t.speaker || 'Speaker'}:** ${t.text}`));
      lines.push('');
    }
    return lines.join('\n');
  };

  const downloadMd = () => {
    const md = buildMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = (session?.meeting_title || 'meeting').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    a.href = url; a.download = `${safe}-${session?.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySummary = async () => {
    await navigator.clipboard.writeText(buildMarkdown());
    toast.success('Copied recap to clipboard');
  };

  if (loading) {
    return <div className="page-shell"><div className="page-shell-content"><div className="rounded-2xl p-10 text-center text-sm" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>Loading session…</div></div></div>;
  }
  if (!session) {
    return (
      <div className="page-shell">
        <div className="page-shell-content">
          <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
            Session not found.
            <div className="mt-4"><Button variant="outline" onClick={() => navigate('/meeting-copilot')}>Back to Meeting Copilot</Button></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-shell-sticky space-y-4 print:hidden">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/meeting-copilot')}
            className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-2)' }}>
            <ArrowLeft className="w-4 h-4" /> Back to Meeting Copilot
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copySummary}><Copy className="w-4 h-4 mr-1.5" /> Copy</Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1.5" /> Print</Button>
            <Button variant="outline" size="sm" onClick={downloadMd}><Download className="w-4 h-4 mr-1.5" /> Download</Button>
            <Button size="sm" onClick={regenerateSummary} disabled={regenerating}>
              <Sparkles className="w-4 h-4 mr-1.5" /> {regenerating ? 'Regenerating…' : 'Regenerate summary'}
            </Button>
          </div>
        </div>

        {/* Hero (compact, sticky) */}
        <div className="rounded-2xl px-6 py-4 shadow-glow relative overflow-hidden"
          style={{ background: 'var(--grad-feature)', color: '#FFFFFF' }}>
          <div className="flex items-center gap-2 mb-1 text-overline" style={{ opacity: 0.85, fontSize: 10 }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#22C55E', boxShadow: '0 0 6px #22C55E' }} />
            MEETING RECAP · {session.status?.toUpperCase()}
          </div>
          <h1 className="text-h4 mb-1.5 truncate" style={{ color: '#FFFFFF' }}>{session.meeting_title || 'Untitled meeting'}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ opacity: 0.92 }}>
            <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {fmtDate(session.started_at)}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {fmtDuration(session.duration_seconds)}</span>
            {attendeeList.length > 0 && (
              <span className="inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {attendeeList.length} attendee{attendeeList.length === 1 ? '' : 's'}</span>
            )}
            {session.platform && <span className="inline-flex items-center gap-1.5 uppercase tracking-wide">{session.platform}</span>}
          </div>
        </div>
      </div>

      <div className="page-shell-content space-y-6 print:space-y-4">
        {/* Summary */}
        <Section icon={<Sparkles className="w-4 h-4" />} title="Executive Summary" accent="var(--c-purple)">
          {session.summary ? (
            <p className="text-base leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-1)' }}>{session.summary}</p>
          ) : (
            <Empty>
              No summary yet. {transcripts.length === 0 ? 'No transcript was captured during this session.' : 'Click "Regenerate summary" to create one.'}
            </Empty>
          )}
        </Section>

        {/* Key Decisions */}
        <Section icon={<ListChecks className="w-4 h-4" />} title="Key Decisions" accent="var(--c-cyan)">
          {decisions.length ? (
            <ul className="space-y-2">
              {decisions.map((d, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--c-cyan)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-1)' }}>{d}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No decisions captured.</Empty>}
        </Section>

        {/* Action items */}
        <Section icon={<CheckCircle className="w-4 h-4" />} title={`Action Items (${actions.length})`} accent="var(--c-green)">
          {actions.length ? (
            <div className="space-y-2">
              {actions.map((a) => (
                <label key={a.id} className="flex items-start gap-3 rounded-xl p-3 cursor-pointer"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <input type="checkbox" checked={a.completed} onChange={(e) => toggleAction(a.id, e.target.checked)} className="mt-1" />
                  <div className="flex-1">
                    <div className="text-sm" style={{ color: 'var(--text-1)', textDecoration: a.completed ? 'line-through' : 'none' }}>{a.description}</div>
                    <div className="flex gap-3 mt-1 text-xs" style={{ color: 'var(--text-2)' }}>
                      {a.assigned_to && <span>Owner: {a.assigned_to}</span>}
                      {a.due_date && <span>Due: {a.due_date}</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          ) : <Empty>No action items captured.</Empty>}
        </Section>

        {/* Follow-up email */}
        <Section icon={<Mail className="w-4 h-4" />} title="Suggested Follow-up Email" accent="var(--c-orange)">
          {session.followup_subject || session.followup_body_html ? (
            <div className="space-y-3">
              {session.followup_subject && (
                <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-overline mb-1" style={{ color: 'var(--text-2)' }}>SUBJECT</div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{session.followup_subject}</div>
                </div>
              )}
              {session.followup_body_html && (
                <div className="rounded-xl p-4 prose prose-sm max-w-none"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
                  dangerouslySetInnerHTML={{ __html: session.followup_body_html }} />
              )}
            </div>
          ) : <Empty>No follow-up email drafted.</Empty>}
        </Section>

        {/* Transcript */}
        <Section icon={<FileText className="w-4 h-4" />} title={`Full Transcript (${transcripts.length})`} accent="var(--c-purple)">
          {groupedTranscript.length ? (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {groupedTranscript.map((t) => (
                <div key={t.id} className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold" style={{ color: 'var(--c-purple)' }}>● {t.speaker || 'Speaker'}</span>
                    <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                      {new Date(t.spoken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{t.text}</p>
                </div>
              ))}
            </div>
          ) : <Empty>No transcript saved.</Empty>}
        </Section>

        {/* Live suggestions log */}
        {suggestions.length > 0 && (
          <Section icon={<MessageSquare className="w-4 h-4" />} title={`Live Copilot Suggestions (${suggestions.length})`} accent="var(--c-pink)">
            <div className="space-y-2">
              {suggestions.map((s) => (
                <div key={s.id} className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                  {s.suggestion_type && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md mr-2"
                      style={{ background: 'var(--c-purple)', color: '#fff' }}>{s.suggestion_type.toUpperCase()}</span>
                  )}
                  <span className="text-sm" style={{ color: 'var(--text-1)' }}>{s.content}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: string; children: React.ReactNode; }) {
  return (
    <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }}>
          {icon}
        </div>
        <h3 className="text-h5" style={{ color: 'var(--text-1)' }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-6 text-sm text-center" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
      {children}
    </div>
  );
}

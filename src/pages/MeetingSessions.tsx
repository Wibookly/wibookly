import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, CheckCircle, FileText, ExternalLink, Mail, Search, Calendar, Clock, Users,
} from 'lucide-react';
import SessionDetailDialog from '@/components/meeting/SessionDetailDialog';

interface SessionRow {
  id: string;
  title: string;
  when: string;
  date: Date;
  duration: string;
  actions: number;
  summary: string | null;
  hasFollowup: boolean;
  attendees: string[];
}

export default function MeetingSessions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewSession, setViewSession] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: sessions } = await supabase
        .from('meeting_sessions')
        .select('id, meeting_title, started_at, duration_seconds, summary, followup_subject, attendees')
        .eq('user_id', user.id)
        .in('status', ['completed', 'ended'])
        .order('started_at', { ascending: false })
        .limit(200);
      const ids = (sessions || []).map((s) => s.id);
      const { data: items } = ids.length
        ? await supabase.from('meeting_action_items').select('session_id').in('session_id', ids)
        : { data: [] as { session_id: string }[] };
      const counts = (items || []).reduce<Record<string, number>>((acc, r) => {
        acc[r.session_id] = (acc[r.session_id] || 0) + 1; return acc;
      }, {});
      setRows((sessions || []).map((s) => {
        const d = new Date(s.started_at as string);
        const today = new Date(); today.setHours(0,0,0,0);
        const sDay = new Date(d); sDay.setHours(0,0,0,0);
        const diff = Math.round((today.getTime() - sDay.getTime()) / 86400000);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const when = diff === 0 ? `Today, ${time}` : diff === 1 ? `Yesterday, ${time}` : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const mins = s.duration_seconds ? Math.round((s.duration_seconds as number) / 60) : 0;
        return {
          id: s.id,
          title: (s.meeting_title as string) || 'Untitled meeting',
          when,
          date: d,
          duration: mins ? `${mins} min` : '—',
          actions: counts[s.id] || 0,
          summary: (s.summary as string | null) || null,
          hasFollowup: !!s.followup_subject,
          attendees: Array.isArray(s.attendees) ? (s.attendees as string[]) : [],
        };
      }));
      setLoading(false);
    })();
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      (r.summary || '').toLowerCase().includes(q) ||
      r.attendees.some((a) => a.toLowerCase().includes(q))
    );
  }, [rows, search]);

  return (
    <div className="page-shell">
      <div className="page-shell-content space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/meeting-copilot')}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <h1 className="text-h4" style={{ color: 'var(--text-1)' }}>Meeting history</h1>
          <span className="text-sm" style={{ color: 'var(--text-2)' }}>· {rows.length} session{rows.length === 1 ? '' : 's'}</span>
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-2)' }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, summary, attendee…"
            className="pl-9"
          />
        </div>

        {loading && (
          <div className="rounded-2xl p-8 text-center text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
            Loading sessions…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="rounded-2xl p-8 text-center text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
            {rows.length === 0 ? 'No completed sessions yet. End a Live Copilot session to see it here.' : 'No sessions match your search.'}
          </div>
        )}

        <div className="space-y-3">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-2xl p-5"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg,#22C55E,#06B6D4)' }}>
                  <CheckCircle className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{s.title}</h3>
                    <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                      <Calendar className="w-3 h-3" /> {s.when}
                    </span>
                    <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                      <Clock className="w-3 h-3" /> {s.duration}
                    </span>
                    {s.attendees.length > 0 && (
                      <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                        <Users className="w-3 h-3" /> {s.attendees.length} attendee{s.attendees.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {s.summary && (
                    <p className="text-xs leading-relaxed line-clamp-2 mt-2" style={{ color: 'var(--text-2)' }}>{s.summary}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-md"
                      style={{ background: 'color-mix(in srgb, var(--c-green) 14%, transparent)', color: 'var(--c-green)' }}>
                      {s.actions} action{s.actions === 1 ? '' : 's'}
                    </span>
                    {s.hasFollowup && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md inline-flex items-center gap-1"
                        style={{ background: 'color-mix(in srgb, var(--c-orange) 14%, transparent)', color: 'var(--c-orange)' }}>
                        <Mail className="w-3 h-3" /> Follow-up
                      </span>
                    )}
                    <div className="ml-auto flex gap-1.5">
                      <button onClick={() => setViewSession({ id: s.id, title: s.title })}
                        title="Open a compact preview of the summary and action items"
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md font-medium hover:opacity-80"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
                        <FileText className="w-3 h-3" /> Quick view
                      </button>
                      <button onClick={() => navigate(`/meeting-copilot/sessions/${s.id}`)}
                        title="Open the full meeting recap: transcript, decisions, action items, follow-up draft"
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md font-semibold text-white hover:opacity-90"
                        style={{ background: 'var(--c-purple)' }}>
                        <ExternalLink className="w-3 h-3" /> Open recap
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {viewSession && (
          <SessionDetailDialog sessionId={viewSession.id} title={viewSession.title} onClose={() => setViewSession(null)} />
        )}
      </div>
    </div>
  );
}

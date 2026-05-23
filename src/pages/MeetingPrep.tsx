import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles, HelpCircle, MessageSquareQuote, Target, AlertTriangle, Calendar, Users, Loader2, Play, ExternalLink, RefreshCw } from 'lucide-react';
import LiveCopilotSession from '@/components/meeting/LiveCopilotSession';
import { toast } from 'sonner';

interface PrepData {
  context?: string;
  objectives?: string[];
  questions_to_ask?: string[];
  likely_questions?: Array<{ question: string; suggested_answer: string }>;
  talking_points?: string[];
  risks?: string[];
}

interface MeetingInfo {
  id: string;
  title: string;
  start?: string;
  end?: string;
  attendees?: string[];
  joinUrl?: string | null;
  location?: string | null;
  attachmentNames?: string[];
}

export default function MeetingPrep() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<PrepData | null>(null);
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);

  const fallbackTitle = (location.state as { title?: string } | null)?.title || 'Meeting';

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke('meeting-copilot-prep', {
        body: { meetingId: id },
      });
      if (invErr) throw invErr;
      if (data?.error) {
        setError(
          data.error === 'no_outlook_connection'
            ? 'Connect Microsoft 365 to load this meeting.'
            : data.error === 'rate_limited'
              ? 'AI is rate-limited — try again in a minute.'
              : data.error === 'credits_exhausted'
                ? 'AI credits exhausted. Add credits in Settings → Workspace → Usage.'
                : `Could not load prep: ${data.error}`
        );
      }
      if (data?.meeting) setMeeting(data.meeting);
      if (data?.prep) setPrep(data.prep);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prep');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);

  const handleJoin = () => {
    if (meeting?.joinUrl) {
      window.open(meeting.joinUrl, '_blank', 'noopener,noreferrer');
    }
    setSessionOpen(true);
    toast.success('Copilot is live. Speak normally — InboxIQ will surface what to ask and answer.');
  };

  const startTime = meeting?.start ? new Date(meeting.start) : null;

  return (
    <div className="page-shell">
      <div className="page-shell-content space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/meeting-copilot')}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh prep
          </Button>
        </div>

        {/* Header */}
        <div className="rounded-2xl p-6"
          style={{ background: 'linear-gradient(135deg, #6D28D9, #EC4899)', color: '#fff' }}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="min-w-0">
              <div className="text-overline mb-2 opacity-90 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> MEETING PREP
              </div>
              <h1 className="text-h3 mb-2 truncate">{meeting?.title || fallbackTitle}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm opacity-90">
                {startTime && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {startTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                {meeting?.attendees && meeting.attendees.length > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-4 h-4" /> {meeting.attendees.length} attendee{meeting.attendees.length === 1 ? '' : 's'}
                  </span>
                )}
                {meeting?.location && <span className="opacity-80">· {meeting.location}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Button onClick={handleJoin} disabled={sessionOpen}
                className="bg-white text-purple-700 hover:bg-white/90">
                <Play className="w-4 h-4 mr-1.5" /> {sessionOpen ? 'Copilot live' : 'Join meeting + start Copilot'}
              </Button>
              {meeting?.joinUrl && (
                <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-white/30 hover:bg-white/10">
                  <ExternalLink className="w-3 h-3" /> Open meeting link
                </a>
              )}
            </div>
          </div>
        </div>

        {loading && (
          <div className="rounded-2xl p-10 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" style={{ color: 'var(--c-purple)' }} />
            <div className="text-sm" style={{ color: 'var(--text-2)' }}>
              Reading meeting details, prior emails, and attachments…
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl p-4 text-sm"
            style={{ background: 'color-mix(in srgb, var(--c-rose) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--c-rose) 35%, transparent)',
              color: 'var(--text-1)' }}>
            {error}
          </div>
        )}

        {!loading && prep && (
          <>
            {prep.context && (
              <PrepCard title="Context" Icon={Sparkles} accent="var(--c-purple)">
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{prep.context}</p>
              </PrepCard>
            )}

            {prep.objectives && prep.objectives.length > 0 && (
              <PrepCard title="Likely objectives" Icon={Target} accent="var(--c-cyan)">
                <ul className="text-sm space-y-2 list-disc pl-5" style={{ color: 'var(--text-1)' }}>
                  {prep.objectives.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </PrepCard>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {prep.questions_to_ask && prep.questions_to_ask.length > 0 && (
                <PrepCard title="Questions you should ask" Icon={HelpCircle} accent="var(--c-purple)">
                  <ul className="space-y-2.5">
                    {prep.questions_to_ask.map((q, i) => (
                      <li key={i} className="rounded-lg p-3 text-sm"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>{q}</li>
                    ))}
                  </ul>
                </PrepCard>
              )}

              {prep.likely_questions && prep.likely_questions.length > 0 && (
                <PrepCard title="Likely questions you'll be asked" Icon={MessageSquareQuote} accent="var(--c-green)">
                  <ul className="space-y-3">
                    {prep.likely_questions.map((qa, i) => (
                      <li key={i} className="rounded-lg p-3"
                        style={{ background: 'var(--surface-2)' }}>
                        <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{qa.question}</div>
                        <div className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                          <span className="font-semibold" style={{ color: 'var(--c-green)' }}>Suggested answer: </span>
                          {qa.suggested_answer}
                        </div>
                      </li>
                    ))}
                  </ul>
                </PrepCard>
              )}
            </div>

            {prep.talking_points && prep.talking_points.length > 0 && (
              <PrepCard title="Key talking points" Icon={Sparkles} accent="var(--c-cyan)">
                <ul className="text-sm space-y-2 list-disc pl-5" style={{ color: 'var(--text-1)' }}>
                  {prep.talking_points.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </PrepCard>
            )}

            {prep.risks && prep.risks.length > 0 && (
              <PrepCard title="Watch-outs" Icon={AlertTriangle} accent="var(--c-orange)">
                <ul className="text-sm space-y-2 list-disc pl-5" style={{ color: 'var(--text-1)' }}>
                  {prep.risks.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </PrepCard>
            )}

            {meeting?.attachmentNames && meeting.attachmentNames.length > 0 && (
              <PrepCard title="Attachments on this invite" Icon={Calendar} accent="var(--c-purple)">
                <ul className="text-sm space-y-1 list-disc pl-5" style={{ color: 'var(--text-2)' }}>
                  {meeting.attachmentNames.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </PrepCard>
            )}
          </>
        )}

        {sessionOpen && meeting && (
          <LiveCopilotSession
            meeting={{ id: meeting.id, title: meeting.title }}
            autoStart
            onClose={() => setSessionOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function PrepCard({ title, Icon, accent, children }: { title: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}>
          <Icon className="w-4 h-4" style={{ color: accent }} />
        </div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

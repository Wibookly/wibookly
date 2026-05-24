import { useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import LiveCopilotSession from '@/components/meeting/LiveCopilotSession';

interface LocationState {
  title?: string;
  durationMinutes?: number;
  attendees?: string[];
  startTime?: string;
}

export default function MeetingLive() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as LocationState;

  const meetingId = useMemo(() => decodeURIComponent(id || ''), [id]);
  const title = state.title || (meetingId.startsWith('practice-') ? 'Practice Session' : 'Live Meeting');

  useEffect(() => {
    document.title = `Live · ${title}`;
  }, [title]);

  if (!meetingId) {
    return (
      <div className="page-shell">
        <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>Missing meeting id.</p>
          <Link to="/meeting-copilot" className="text-sm font-semibold underline" style={{ color: 'var(--c-purple)' }}>
            Back to Meeting Copilot
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <div className="rounded-2xl p-4 flex items-center justify-between gap-3"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/meeting-copilot')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-overline" style={{ color: 'var(--c-purple)' }}>
                <Sparkles className="w-3 h-3" /> LIVE COPILOT WORKSPACE
              </div>
              <h1 className="text-h5 truncate" style={{ color: 'var(--text-1)' }}>{title}</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="page-shell-content">
        <LiveCopilotSession
          meeting={{ id: meetingId, title }}
          durationMinutes={state.durationMinutes}
          scheduledStartIso={state.startTime}
          initialAttendees={state.attendees}
          autoStart
          onClose={() => navigate('/meeting-copilot')}
        />
      </div>
    </div>
  );
}

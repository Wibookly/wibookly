import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Calendar, Clock, Users, CheckCircle, Mic, Play,
  Headphones, ExternalLink, Settings as SettingsIcon, Zap,
  MessageSquare, Target, FileText, Download, Mail, ChevronDown, ChevronUp,
  Bell, Volume2, Keyboard, User as UserIcon,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import LiveCopilotSession from '@/components/meeting/LiveCopilotSession';
import SessionDetailDialog from '@/components/meeting/SessionDetailDialog';
import { Link } from 'react-router-dom';

type SuggestionStyle = 'concise' | 'conversational' | 'strategic';

interface CopilotSettings {
  auto_join_all: boolean;
  show_live_suggestions: boolean;
  auto_draft_followup: boolean;
  suggestion_style: SuggestionStyle;
  notify_scheduled: boolean;
  notify_detected: boolean;
  microphone_device_id: string | null;
  shortcuts: Record<string, string>;
}

const DEFAULT_SHORTCUTS: Record<string, string> = {
  ask: 'Ctrl+Shift+A',
  answer: 'Ctrl+Shift+R',
  say: 'Ctrl+Shift+S',
  end: 'Ctrl+Shift+E',
};

// Note: per-user identity (role, responsibilities, communication style) is
// now centralized in `user_profiles` and rendered by <ProfileContextCard />.

// Upcoming meeting shape (always sourced from Microsoft Graph — no mock data).
type UpcomingMeeting = {
  id: string;
  title: string;
  timeLabel: string;
  period: string;
  platform: 'teams' | 'zoom' | 'meet';
  attendees: number;
  duration: string;
  isLive: boolean;
  joinUrl?: string | null;
};

// ---------- PAGE ----------
export default function MeetingCopilot() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const liveSessionAnchorRef = useRef<HTMLDivElement | null>(null);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const [settings, setSettings] = useState<CopilotSettings>({
    auto_join_all: true,
    show_live_suggestions: true,
    auto_draft_followup: true,
    suggestion_style: 'concise',
    notify_scheduled: true,
    notify_detected: true,
    microphone_device_id: null,
    shortcuts: DEFAULT_SHORTCUTS,
  });
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [perMeeting, setPerMeeting] = useState<Record<string, boolean>>({});
  const [upcoming, setUpcoming] = useState<UpcomingMeeting[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<
    { state: 'loading' } | { state: 'connected'; count: number } | { state: 'not_connected' } | { state: 'error'; detail: string }
  >({ state: 'loading' });
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [openSession, setOpenSession] = useState<{ id: string; title: string } | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; title: string; when: string; duration: string; actions: number; summary: string | null; hasFollowup: boolean }>>([]);
  const [viewSession, setViewSession] = useState<{ id: string; title: string } | null>(null);

  // Load recent (completed) sessions
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: sessions } = await supabase
        .from('meeting_sessions')
        .select('id, meeting_title, started_at, ended_at, duration_seconds, summary, followup_subject')
        .eq('user_id', user.id)
        .in('status', ['completed', 'ended'])
        .order('started_at', { ascending: false })
        .limit(8);
      if (!sessions?.length) { setRecent([]); return; }
      const ids = sessions.map((s) => s.id);
      const { data: items } = await supabase
        .from('meeting_action_items')
        .select('session_id')
        .in('session_id', ids);
      const counts = (items || []).reduce<Record<string, number>>((acc, r: { session_id: string }) => {
        acc[r.session_id] = (acc[r.session_id] || 0) + 1; return acc;
      }, {});
      setRecent(sessions.map((s) => {
        const d = new Date(s.started_at as string);
        const today = new Date(); today.setHours(0,0,0,0);
        const sDay = new Date(d); sDay.setHours(0,0,0,0);
        const diffDays = Math.round((today.getTime() - sDay.getTime()) / 86400000);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const when = diffDays === 0 ? `Today, ${time}` : diffDays === 1 ? `Yesterday, ${time}` : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const mins = s.duration_seconds ? Math.round((s.duration_seconds as number) / 60) : 0;
        return {
          id: s.id,
          title: (s.meeting_title as string) || 'Untitled meeting',
          when,
          duration: mins ? `${mins} min` : '—',
          actions: counts[s.id] || 0,
          summary: (s.summary as string | null) || null,
          hasFollowup: !!s.followup_subject,
        };
      }));
    })();
  }, [user, openSession]);

  // Load copilot settings
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: s } = await supabase
        .from('meeting_copilot_settings').select('*').eq('user_id', user.id).maybeSingle();
      if (s) setSettings({
        auto_join_all: s.auto_join_all ?? true,
        show_live_suggestions: s.show_live_suggestions,
        auto_draft_followup: s.auto_draft_followup,
        suggestion_style: s.suggestion_style as SuggestionStyle,
        notify_scheduled: (s as any).notify_scheduled ?? true,
        notify_detected: (s as any).notify_detected ?? true,
        microphone_device_id: (s as any).microphone_device_id ?? null,
        shortcuts: { ...DEFAULT_SHORTCUTS, ...((s as any).shortcuts || {}) },
      });
    })();
  }, [user]);

  // Enumerate microphones (label only available after a getUserMedia grant)
  useEffect(() => {
    const list = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter((d) => d.kind === 'audioinput'));
      } catch { /* ignore */ }
    };
    void list();
    navigator.mediaDevices?.addEventListener?.('devicechange', list);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', list);
  }, []);

  const loadUpcomingMeetings = useCallback(async () => {
    if (!user) return;
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const { data, error } = await supabase.functions.invoke('meeting-copilot-upcoming', {
        body: { timezone },
      });
      if (error) {
        setCalendarStatus({ state: 'error', detail: error.message || 'Calendar request failed' });
        return;
      }
      if (data?.error === 'no_outlook_connection') {
        setCalendarStatus({ state: 'not_connected' });
        setUpcoming([]);
        return;
      }
      if (data?.error) {
        setCalendarStatus({ state: 'error', detail: data.detail || data.error });
        return;
      }
      const list: any[] = Array.isArray(data?.meetings) ? data.meetings : [];
      setCalendarStatus({ state: 'connected', count: list.length });
      if (list.length === 0) { setUpcoming([]); return; }
      const fmt = (date: Date) => {
        let h = date.getHours();
        const m = date.getMinutes();
        const period = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return { timeLabel: `${h}:${String(m).padStart(2, '0')}`, period };
      };
      const parseMeetingDate = (iso: string) => {
        if (!iso) return new Date('');
        if (iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
        return new Date(iso);
      };
      const mapped = list.map((m: any) => {
        const startDate = parseMeetingDate(m.startTime);
        const endDate = parseMeetingDate(m.endTime);
        const isLive = Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime())
          ? Date.now() >= startDate.getTime() && Date.now() <= endDate.getTime()
          : !!m.isLive;
        const { timeLabel, period } = fmt(startDate);
        return {
          id: m.id,
          title: m.title,
          timeLabel: isLive ? 'Now' : timeLabel,
          period: isLive ? 'LIVE' : period,
          platform: (['teams','zoom','meet'].includes(m.platform) ? m.platform : 'teams') as 'teams' | 'zoom' | 'meet',
          attendees: m.attendeeCount,
          duration: isLive ? 'In progress' : `${m.durationMin} min`,
          isLive,
          joinUrl: m.joinUrl || null,
        };
      });
      const prefs: Record<string, boolean> = {};
      list.forEach((m: any) => { prefs[m.id] = m.copilotEnabled !== false; });
      setUpcoming(mapped);
      setPerMeeting(prefs);
    } catch (e) {
      setCalendarStatus({ state: 'error', detail: e instanceof Error ? e.message : 'Unknown error' });
    }
  }, [user]);

  // Load upcoming meetings from Microsoft Graph
  useEffect(() => {
    if (!user) return;
    loadUpcomingMeetings();
    if (liveRefreshTimerRef.current) window.clearInterval(liveRefreshTimerRef.current);
    liveRefreshTimerRef.current = window.setInterval(() => {
      loadUpcomingMeetings();
    }, 30000);

    return () => {
      if (liveRefreshTimerRef.current) {
        window.clearInterval(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
    };
  }, [user, loadUpcomingMeetings]);

  const handleOpenSession = (meeting: UpcomingMeeting) => {
    if (!meeting.isLive && meeting.joinUrl) {
      window.open(meeting.joinUrl, '_blank', 'noopener,noreferrer');
    }
    setOpenSession({ id: meeting.id, title: meeting.title });
    if (!meeting.isLive) {
      void loadUpcomingMeetings();
    }
    window.requestAnimationFrame(() => {
      setTimeout(() => {
        liveSessionAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    });
    toast.success(meeting.isLive
      ? `Copilot opened for ${meeting.title}`
      : `Copilot is ready for ${meeting.title}. Test your mic before the meeting starts.`);
  };

  // Set this once the extension is approved on the Microsoft Edge Add-ons store.
  const EDGE_STORE_URL: string | null = null; // e.g. 'https://microsoftedge.microsoft.com/addons/detail/<id>'

  const downloadExtension = async (target: 'edge' | 'chrome' = 'edge') => {
    try {
      const res = await fetch('/inboxiq-meeting-copilot-edge.zip');
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'inboxiq-meeting-copilot.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      const url = target === 'edge' ? 'edge://extensions' : 'chrome://extensions';
      toast.success(`Downloaded. Unzip it, open ${url}, enable Developer mode, then "Load unpacked".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const openEdgeStore = () => {
    if (EDGE_STORE_URL) window.open(EDGE_STORE_URL, '_blank');
    else toast.info('Edge Add-ons listing is in review. Use "Sideload for testing" below in the meantime.');
  };

  const updateSettings = async (patch: Partial<CopilotSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (!user) return;
    await supabase.from('meeting_copilot_settings').upsert({
      user_id: user.id,
      ...next,
    }, { onConflict: 'user_id' });
  };

  const toggleMeeting = (id: string, enabled: boolean) => {
    setPerMeeting((m) => ({ ...m, [id]: enabled }));
    if (!user) return;
    supabase.from('meeting_copilot_preferences').upsert({
      user_id: user.id,
      meeting_external_id: id,
      copilot_enabled: enabled,
    }, { onConflict: 'user_id,meeting_external_id' });
  };

  const initials = useMemo(() => {
    const name = (user?.user_metadata as any)?.full_name || user?.email || 'AR';
    const parts = String(name).split(/[\s@.]+/).filter(Boolean);
    return ((parts[0]?.[0] || 'A') + (parts[1]?.[0] || '')).toUpperCase();
  }, [user]);

  const [stats, setStats] = useState({ meetings: 0, sessions: 0, hours: '0h', actions: 0 });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = new Date(); since.setDate(since.getDate() - 7);
      const sinceIso = since.toISOString();
      const [{ count: meetings }, { data: sessRows, count: sessions }, { count: actions }] = await Promise.all([
        supabase.from('meeting_copilot_preferences').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('meeting_sessions').select('duration_seconds', { count: 'exact' }).eq('user_id', user.id).gte('started_at', sinceIso),
        supabase.from('meeting_action_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ]);
      const totalSec = (sessRows || []).reduce((a, r: any) => a + (r.duration_seconds || 0), 0);
      const hours = totalSec >= 3600 ? `${(totalSec / 3600).toFixed(1)}h` : `${Math.round(totalSec / 60)}m`;
      setStats({
        meetings: upcoming.length || meetings || 0,
        sessions: sessions || 0,
        hours,
        actions: actions || 0,
      });
    })();
  }, [user, upcoming.length, openSession, recent.length]);

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
      <div className="relative overflow-hidden rounded-2xl p-8 shadow-glow"
        style={{ background: 'var(--grad-feature)', color: '#FFFFFF' }}>
        <div aria-hidden className="absolute -top-32 -right-32 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(192,38,211,0.55) 0%, transparent 70%)', filter: 'blur(50px)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-3 text-overline" style={{ opacity: 0.85 }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22C55E', boxShadow: '0 0 8px #22C55E' }} />
              MEETING COPILOT · ACTIVE
            </div>
            <h1 className="text-h2 mb-3" style={{ color: '#FFFFFF' }}>
              Your AI meeting partner. <span style={{ color: '#A7F3D0' }}>Live and invisible.</span>
            </h1>
            <p className="text-body-2 leading-relaxed" style={{ opacity: 0.92 }}>
              InboxIQ listens to your meetings in real time, transcribes the conversation, and feeds you what to say next — without any bot joining the call. Other attendees never know it's there.
            </p>
          </div>
          <div className="flex flex-col gap-3 shrink-0">
            <button onClick={() => setPrivacyOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-transform hover:scale-[1.02]"
              style={{ background: '#FFFFFF', color: '#5B21B6' }}>
              <Zap className="w-4 h-4" /> Try with next meeting
            </button>
            <button onClick={openEdgeStore}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-transform hover:scale-[1.02]"
              style={{ background: '#0078D4', color: '#FFFFFF', boxShadow: '0 6px 24px -8px rgba(0,120,212,0.6)' }}>
              <ExternalLink className="w-4 h-4" /> Add to Microsoft Edge
            </button>
            <button onClick={() => downloadExtension('edge')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs font-medium border"
              style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.25)', color: '#FFFFFF' }}
              title="For testing before the Edge Add-ons listing goes live">
              Sideload for testing (.zip)
            </button>
          </div>
        </div>
      </div>
      </div>

      <div className="page-shell-content space-y-6">
      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Upcoming this week', value: String(stats.meetings), Icon: Calendar, grad: 'linear-gradient(135deg, #6D28D9, #8B5CF6)' },
          { label: 'Copilot sessions (7d)', value: String(stats.sessions), Icon: Mic, grad: 'linear-gradient(135deg, #EC4899, #C026D3)' },
          { label: 'Hours transcribed (7d)', value: stats.hours, Icon: Clock, grad: 'linear-gradient(135deg, #06B6D4, #3B82F6)' },
          { label: 'Action items captured', value: String(stats.actions), Icon: CheckCircle, grad: 'linear-gradient(135deg, #22C55E, #10B981)' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between mb-3">
              <div className="text-caption" style={{ color: 'var(--text-2)' }}>{s.label}</div>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: s.grad }}>
                <s.Icon className="w-4 h-4 text-white" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-h3" style={{ color: 'var(--text-1)' }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* AI PROFILE — centralized from Settings → Profile */}
      <ProfileContextCard surface="meeting_copilot" />

      {/* COPILOT BEHAVIOR */}
      <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--c-purple) 18%, transparent)' }}>
            <SettingsIcon className="w-4 h-4" style={{ color: 'var(--c-purple)' }} />
          </div>
          <h3 className="text-h5" style={{ color: 'var(--text-1)' }}>Copilot Behavior</h3>
        </div>

        <ToggleRow
          title="Auto-join all my meetings"
          desc="Copilot listens to every calendar meeting automatically. You can still toggle individual meetings off."
          checked={settings.auto_join_all}
          onChange={(v) => updateSettings({ auto_join_all: v })}
        />
        <ToggleRow
          title="Live suggestions during the call"
          desc='Show "what to say" and "follow-up questions" in real time. No audio is ever stored.'
          checked={settings.show_live_suggestions}
          onChange={(v) => updateSettings({ show_live_suggestions: v })}
        />
        <ToggleRow
          title="Auto-draft follow-up email after each call"
          desc="Generate a summary and action items, push as a draft into Outlook (review before sending)."
          checked={settings.auto_draft_followup}
          onChange={(v) => updateSettings({ auto_draft_followup: v })}
        />

        <div className="pt-5 mt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-3">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Suggestion style</div>
            <div className="text-caption" style={{ color: 'var(--text-2)' }}>How the Copilot phrases live suggestions</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StyleCard Icon={Zap} title="Concise" desc="Short bullet points. Best for quick reference during fast conversations."
              active={settings.suggestion_style === 'concise'} onClick={() => updateSettings({ suggestion_style: 'concise' })} />
            <StyleCard Icon={MessageSquare} title="Conversational" desc="Full sentences ready to say. Best for tough discussions and sales calls."
              active={settings.suggestion_style === 'conversational'} onClick={() => updateSettings({ suggestion_style: 'conversational' })} />
            <StyleCard Icon={Target} title="Strategic" desc="Surfaces angles, risks, opportunities. Best for executive meetings."
              active={settings.suggestion_style === 'strategic'} onClick={() => updateSettings({ suggestion_style: 'strategic' })} />
          </div>
        </div>
      </div>

      {/* UPCOMING + RECENT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--c-cyan) 18%, transparent)' }}>
                <Calendar className="w-4 h-4" style={{ color: 'var(--c-cyan)' }} />
              </div>
              <h3 className="text-h5" style={{ color: 'var(--text-1)' }}>Upcoming Meetings</h3>
            </div>
            <a className="text-sm font-medium" style={{ color: 'var(--c-cyan)' }} href="/integrations?tab=settings">View calendar →</a>
          </div>
          {/* Honest status banner — replaces silent mock fallback */}
          {calendarStatus.state === 'loading' && (
            <div className="mb-3 rounded-xl p-3 text-xs flex items-center gap-2"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
              <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Checking your Microsoft 365 calendar…
            </div>
          )}
          {calendarStatus.state === 'not_connected' && (
            <div className="mb-3 rounded-xl p-3 text-xs"
              style={{ background: 'color-mix(in srgb, var(--c-orange) 12%, transparent)',
                       border: '1px solid color-mix(in srgb, var(--c-orange) 35%, transparent)',
                       color: 'var(--text-1)' }}>
              <strong>Calendar not connected.</strong> The meetings below are sample data. <a href="/integrations" className="underline font-semibold">Connect Microsoft 365</a> to see your real calendar and use Copilot on your meetings & emails.
            </div>
          )}
          {calendarStatus.state === 'error' && (
            <div className="mb-3 rounded-xl p-3 text-xs"
              style={{ background: 'color-mix(in srgb, var(--c-rose) 12%, transparent)',
                       border: '1px solid color-mix(in srgb, var(--c-rose) 35%, transparent)',
                       color: 'var(--text-1)' }}>
              <strong>Couldn't load your calendar.</strong> {calendarStatus.detail.slice(0, 200)} — try <a href="/integrations" className="underline font-semibold">reconnecting Microsoft 365</a>.
            </div>
          )}
          {calendarStatus.state === 'connected' && calendarStatus.count === 0 && (
            <div className="mb-3 rounded-xl p-3 text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
              Calendar connected — no meetings in the next 7 days.
            </div>
          )}
          {calendarStatus.state === 'connected' && calendarStatus.count > 0 && (
            <div className="mb-3 rounded-xl p-3 text-xs"
              style={{ background: 'color-mix(in srgb, var(--c-green) 10%, transparent)',
                       border: '1px solid color-mix(in srgb, var(--c-green) 30%, transparent)',
                       color: 'var(--text-1)' }}>
              <strong>Calendar connected.</strong> Showing {calendarStatus.count} real meeting{calendarStatus.count === 1 ? '' : 's'} from your Microsoft 365 calendar.
            </div>
          )}
          <div className="space-y-3">
            {upcoming.length === 0 && calendarStatus.state !== 'loading' && (
              <div className="rounded-xl p-6 text-center text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                No upcoming meetings to show. Once your calendar has events in the next 7 days they'll appear here automatically.
              </div>
            )}
              {upcoming.map((m) => (
              <MeetingCard key={m.id} meeting={m} enabled={perMeeting[m.id] ?? true}
                onToggle={(v) => toggleMeeting(m.id, v)}
                onOpen={() => handleOpenSession(m)} />
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--c-green) 18%, transparent)' }}>
                <CheckCircle className="w-4 h-4" style={{ color: 'var(--c-green)' }} />
              </div>
              <h3 className="text-h5" style={{ color: 'var(--text-1)' }}>Recent Sessions</h3>
            </div>
            <a className="text-sm font-medium" style={{ color: 'var(--c-green)' }} href="#">View all →</a>
          </div>
          <div className="space-y-3">
            {recent.length === 0 && (
              <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                No completed sessions yet. End a Live Copilot session to see it here.
              </div>
            )}
            {recent.map((s) => (
              <div key={s.id}
                className="rounded-xl p-4 transition-colors"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, #22C55E, #06B6D4)' }}>
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{s.title}</div>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>{s.when} · {s.duration}</div>
                    {s.summary && (
                      <p className="text-xs leading-relaxed line-clamp-2 mb-3" style={{ color: 'var(--text-2)' }}>{s.summary}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
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
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-medium hover:opacity-80"
                          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
                          <FileText className="w-3 h-3" /> Quick view
                        </button>
                        <button onClick={() => navigate(`/meeting-copilot/sessions/${s.id}`)}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-semibold hover:opacity-90"
                          style={{ background: 'var(--c-purple)', color: '#fff' }}>
                          <ExternalLink className="w-3 h-3" /> Open recap
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div ref={liveSessionAnchorRef}>
        {openSession && (
          <LiveCopilotSession meeting={openSession} autoStart onClose={() => setOpenSession(null)} />
        )}
      </div>

      {viewSession && (
        <SessionDetailDialog sessionId={viewSession.id} title={viewSession.title} onClose={() => setViewSession(null)} />
      )}

      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      </div>
    </div>
  );
}

// ---------- Sub-components ----------
function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <div className="text-overline mb-2" style={{ color: 'var(--text-2)' }}>{label}</div>
      <div className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{value}</div>
    </div>
  );
}

function ToggleRow({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <div className="flex-1">
        <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-1)' }}>{title}</div>
        <div className="text-caption" style={{ color: 'var(--text-2)' }}>{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StyleCard({ Icon, title, desc, active, onClick }: { Icon: any; title: string; desc: string; active: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className="text-left rounded-xl p-4 transition-all"
      style={{
        background: active ? 'color-mix(in srgb, var(--c-purple) 12%, var(--surface-2))' : 'var(--surface-2)',
        border: `1px solid ${active ? 'color-mix(in srgb, var(--c-purple) 50%, transparent)' : 'var(--border)'}`,
      }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4" style={{ color: active ? 'var(--c-purple)' : 'var(--text-2)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</p>
    </button>
  );
}

function MeetingCard({ meeting, enabled, onToggle, onOpen }: { meeting: UpcomingMeeting; enabled: boolean; onToggle: (v: boolean) => void; onOpen?: () => void; }) {
  const platformStyles: Record<string, { bg: string; color: string; label: string }> = {
    teams: { bg: 'rgba(98,100,167,0.18)', color: '#8E91D8', label: 'TEAMS' },
    zoom:  { bg: 'rgba(45,140,255,0.16)', color: '#60A5FA', label: 'ZOOM' },
    meet:  { bg: 'rgba(52,168,83,0.16)',  color: '#34D399', label: 'MEET' },
  };
  const p = platformStyles[meeting.platform] || platformStyles.teams;
  return (
    <div className="rounded-xl p-4 flex flex-wrap items-center gap-x-4 gap-y-3"
      style={{
        background: meeting.isLive ? 'color-mix(in srgb, var(--c-rose) 6%, var(--surface-2))' : 'var(--surface-2)',
        border: `1px solid ${meeting.isLive ? 'color-mix(in srgb, var(--c-rose) 35%, transparent)' : 'var(--border)'}`,
      }}>
      <div className="text-center min-w-[52px] shrink-0">
        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{meeting.timeLabel}</div>
        <div className="text-[10px] font-semibold tracking-wider"
          style={{ color: meeting.isLive ? '#EF4444' : 'var(--text-2)' }}>{meeting.period}</div>
      </div>
      <div className="flex-1 min-w-0 basis-[200px]">
        <div className="text-sm font-semibold truncate mb-1" style={{ color: 'var(--text-1)' }}>{meeting.title}</div>
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--text-2)' }}>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider"
            style={{ background: p.bg, color: p.color }}>{p.label}</span>
          <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {meeting.attendees} attendees</span>
          <span>·</span>
          <span className="whitespace-nowrap">{meeting.duration}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <button onClick={() => onToggle(!enabled)}
          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all border shrink-0 whitespace-nowrap"
          style={{
            background: enabled ? 'color-mix(in srgb, var(--c-purple) 12%, transparent)' : 'var(--surface-3)',
            borderColor: enabled ? 'color-mix(in srgb, var(--c-purple) 45%, transparent)' : 'var(--border)',
            color: enabled ? 'var(--c-purple)' : 'var(--text-2)',
          }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: enabled ? 'var(--c-purple)' : 'var(--text-3)' }} />
          Copilot {enabled ? 'ON' : 'OFF'}
        </button>
        <button onClick={onOpen}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white shrink-0 whitespace-nowrap"
          style={{ background: meeting.isLive ? 'linear-gradient(135deg,#EC4899,#F97316)' : 'linear-gradient(135deg,#3B82F6,#6366F1)' }}>
          {meeting.isLive ? <><Headphones className="w-3 h-3" /> Open Copilot</> : <><Play className="w-3 h-3" /> Join</>}
        </button>
      </div>
    </div>
  );
}

function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #6D28D9, #EC4899)' }}>
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-h5 mb-1" style={{ color: 'var(--text-1)' }}>Your privacy comes first</h3>
            <p className="text-caption" style={{ color: 'var(--text-2)' }}>Here's exactly what happens when you enable Meeting Copilot.</p>
          </div>
        </div>

        <ul className="space-y-3 mb-5">
          {[
            ['No audio is ever recorded.', 'Audio is transcribed live, in real time. The raw audio is never saved — not on your device, not on our servers.'],
            ['Only text persists.', 'The transcript is stored in your private InboxIQ account, encrypted at rest. You control retention (default: 30 days).'],
            ['No bot joins the meeting.', 'Audio is captured locally by the Chrome extension on your own machine. Other attendees never see an extra participant.'],
            ['You decide per-meeting.', 'Even with auto-join enabled, you can toggle the Copilot off for any individual meeting.'],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-3">
              <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--c-green)' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{t}</div>
                <div className="text-caption" style={{ color: 'var(--text-2)' }}>{d}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-xl p-3 mb-5 text-caption"
          style={{ background: 'color-mix(in srgb, var(--c-orange) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--c-orange) 30%, transparent)',
            color: 'var(--text-2)' }}>
          <strong style={{ color: 'var(--text-1)' }}>Heads up:</strong> Recording laws vary by jurisdiction. We recommend adding a line to your email signature like: <em>"AI may transcribe this call for my private note-taking. No audio is recorded."</em>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onClose}>I understand — Install Extension</Button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import {
  Sparkles, Calendar, Clock, Users, CheckCircle, Mic, Play,
  Headphones, ExternalLink, Pencil, Settings as SettingsIcon, Zap,
  MessageSquare, Target,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type SuggestionStyle = 'concise' | 'conversational' | 'strategic';

interface CopilotSettings {
  auto_join_all: boolean;
  show_live_suggestions: boolean;
  auto_draft_followup: boolean;
  suggestion_style: SuggestionStyle;
}

interface AIProfile {
  role: string;
  responsibilities: string;
  communication_style: string;
}

// ---------- MOCK DATA (replaced with Graph + Supabase in Sprint 2) ----------
const MOCK_UPCOMING = [
  {
    id: 'm1',
    title: 'Q2 Roadmap Sync — Engineering Leadership',
    timeLabel: 'Now',
    period: 'LIVE',
    platform: 'teams' as const,
    attendees: 6,
    duration: 'Started 12 min ago',
    isLive: true,
  },
  {
    id: 'm2',
    title: 'Customer call — Acme Corp implementation',
    timeLabel: '2:00',
    period: 'PM',
    platform: 'zoom' as const,
    attendees: 4,
    duration: '45 min',
    isLive: false,
  },
  {
    id: 'm3',
    title: '1:1 with Dustin — Sprint planning',
    timeLabel: '3:30',
    period: 'PM',
    platform: 'teams' as const,
    attendees: 2,
    duration: '30 min',
    isLive: false,
  },
  {
    id: 'm4',
    title: 'Vendor demo — CRM integration options',
    timeLabel: '4:30',
    period: 'PM',
    platform: 'meet' as const,
    attendees: 5,
    duration: '60 min',
    isLive: false,
  },
];

const MOCK_RECENT = [
  { id: 's1', title: 'Energytrux insurance review', when: 'Today, 10:00 AM', duration: '42 min', actions: 8, initials: ['MM','RH','SH'] },
  { id: 's2', title: 'EnergyForward advisor agreement', when: 'Yesterday, 3:30 PM', duration: '28 min', actions: 5, initials: ['CN','JV'] },
  { id: 's3', title: 'Sprint retro — Q1 wrap-up', when: 'Yesterday, 2:00 PM', duration: '61 min', actions: 12, initials: ['KT','DF','+3'] },
  { id: 's4', title: 'Microsoft 365 license review', when: 'Monday, 11:00 AM', duration: '35 min', actions: 7, initials: ['JV','SH'] },
];

const MOCK_TRANSCRIPT = [
  { speaker: 'Dustin Rosepink', color: '#22C55E', time: '12:42', text: "So we're looking at three engineering hires this quarter — one senior structural, two intermediate. Budget is approved but I'm a bit worried about the timeline." },
  { speaker: 'You', color: '#A855F7', time: '12:43', text: "Yeah, the M365 licenses and access provisioning is on me. I can have that ready within a day of offer." },
];

const MOCK_SUGGESTIONS = [
  { type: 'say' as const, label: 'WHAT TO SAY', content: '"I already opened a procurement request last week anticipating this. We have a dedicated Autodesk reseller who can turn Revit licenses around in 48 hours now. I\'ll send the SKUs to your team today so we can pre-provision."' },
];

// ---------- PAGE ----------
export default function MeetingCopilot() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<AIProfile>({
    role: 'IT Systems Administrator at 4 S.T.E.L. Engineering',
    responsibilities: 'M365 administration, network infrastructure, structural engineering systems support',
    communication_style: 'Technical and direct. Prefers concrete examples and step-by-step explanations.',
  });
  const [settings, setSettings] = useState<CopilotSettings>({
    auto_join_all: false,
    show_live_suggestions: true,
    auto_draft_followup: true,
    suggestion_style: 'concise',
  });
  const [perMeeting, setPerMeeting] = useState<Record<string, boolean>>({});
  const [upcoming, setUpcoming] = useState<typeof MOCK_UPCOMING>(MOCK_UPCOMING);
  const [usingMockMeetings, setUsingMockMeetings] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftProfile, setDraftProfile] = useState(profile);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Load settings + profile
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: s }, { data: p }] = await Promise.all([
        supabase.from('meeting_copilot_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_ai_profiles').select('*').eq('user_id', user.id).maybeSingle(),
      ]);
      if (s) setSettings({
        auto_join_all: s.auto_join_all,
        show_live_suggestions: s.show_live_suggestions,
        auto_draft_followup: s.auto_draft_followup,
        suggestion_style: s.suggestion_style as SuggestionStyle,
      });
      if (p) {
        const loaded = {
          role: p.role || profile.role,
          responsibilities: p.responsibilities || profile.responsibilities,
          communication_style: p.communication_style || profile.communication_style,
        };
        setProfile(loaded);
        setDraftProfile(loaded);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Load upcoming meetings from Microsoft Graph
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('meeting-copilot-upcoming', { body: {} });
        if (error || !data || data.error || !Array.isArray(data.meetings) || data.meetings.length === 0) return;
        const fmt = (iso: string) => {
          const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
          let h = d.getHours();
          const m = d.getMinutes();
          const period = h >= 12 ? 'PM' : 'AM';
          h = h % 12 || 12;
          return { timeLabel: `${h}:${String(m).padStart(2, '0')}`, period };
        };
        const mapped = data.meetings.map((m: any) => {
          const { timeLabel, period } = fmt(m.startTime);
          return {
            id: m.id,
            title: m.title,
            timeLabel: m.isLive ? 'Now' : timeLabel,
            period: m.isLive ? 'LIVE' : period,
            platform: (['teams','zoom','meet'].includes(m.platform) ? m.platform : 'teams') as 'teams' | 'zoom' | 'meet',
            attendees: m.attendeeCount,
            duration: m.isLive ? 'In progress' : `${m.durationMin} min`,
            isLive: m.isLive,
          };
        });
        const prefs: Record<string, boolean> = {};
        data.meetings.forEach((m: any) => { prefs[m.id] = m.copilotEnabled !== false; });
        setUpcoming(mapped);
        setPerMeeting(prefs);
        setUsingMockMeetings(false);
      } catch { /* keep mock */ }
    })();
  }, [user]);

  const updateSettings = async (patch: Partial<CopilotSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (!user) return;
    await supabase.from('meeting_copilot_settings').upsert({
      user_id: user.id,
      ...next,
    }, { onConflict: 'user_id' });
  };

  const saveProfile = async () => {
    setProfile(draftProfile);
    setEditingProfile(false);
    if (!user) return;
    const { error } = await supabase.from('user_ai_profiles').upsert({
      user_id: user.id,
      ...draftProfile,
    }, { onConflict: 'user_id' });
    if (error) toast.error('Could not save profile');
    else toast.success('AI profile saved');
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

  const activeMeeting = upcoming.find((m) => m.isLive);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* HERO */}
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
            <a href="#" onClick={(e) => { e.preventDefault(); setPrivacyOpen(true); }}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold border"
              style={{ background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.3)', color: '#FFFFFF' }}>
              <ExternalLink className="w-4 h-4" /> Install Chrome Extension
            </a>
          </div>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Meetings this week', value: '12', trend: '+3', Icon: Calendar, grad: 'linear-gradient(135deg, #6D28D9, #8B5CF6)' },
          { label: 'Copilot sessions',   value: '8',  trend: '+2', Icon: Mic,      grad: 'linear-gradient(135deg, #EC4899, #C026D3)' },
          { label: 'Hours transcribed',  value: '14.2h',           Icon: Clock,    grad: 'linear-gradient(135deg, #06B6D4, #3B82F6)' },
          { label: 'Action items captured', value: '47', trend: '+18', Icon: CheckCircle, grad: 'linear-gradient(135deg, #22C55E, #10B981)' },
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
              {s.trend && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold"
                  style={{ background: 'color-mix(in srgb, var(--c-green) 18%, transparent)', color: 'var(--c-green)' }}>
                  {s.trend}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* AI PROFILE */}
      <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-semibold"
            style={{ background: 'linear-gradient(135deg, #6D28D9, #EC4899)' }}>{initials}</div>
          <div className="flex-1">
            <h3 className="text-h5" style={{ color: 'var(--text-1)' }}>Your AI Profile</h3>
            <p className="text-caption" style={{ color: 'var(--text-2)' }}>What the Copilot knows about you to give better suggestions</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setDraftProfile(profile); setEditingProfile((v) => !v); }}>
            <Pencil className="w-3.5 h-3.5 mr-1.5" /> {editingProfile ? 'Cancel' : 'Edit Profile'}
          </Button>
        </div>
        {editingProfile ? (
          <div className="space-y-3">
            {(['role','responsibilities','communication_style'] as const).map((key) => (
              <div key={key}>
                <div className="text-overline mb-1.5" style={{ color: 'var(--text-2)' }}>{key.replace('_',' ')}</div>
                <textarea
                  className="w-full rounded-xl p-3 text-sm resize-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                  rows={2}
                  value={draftProfile[key]}
                  onChange={(e) => setDraftProfile({ ...draftProfile, [key]: e.target.value })}
                />
              </div>
            ))}
            <Button onClick={saveProfile} size="sm">Save Profile</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ProfileField label="Role" value={profile.role} />
            <ProfileField label="Responsibilities" value={profile.responsibilities} />
            <ProfileField label="Communication style" value={profile.communication_style} />
          </div>
        )}
      </div>

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
          <div className="space-y-3">
            {upcoming.map((m) => (
              <MeetingCard key={m.id} meeting={m} enabled={perMeeting[m.id] ?? true} onToggle={(v) => toggleMeeting(m.id, v)} />
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
            {MOCK_RECENT.map((s) => (
              <div key={s.id} className="rounded-xl p-4 flex items-center gap-3"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="flex -space-x-2">
                  {s.initials.map((ini, idx) => (
                    <div key={idx} className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold text-white border-2"
                      style={{ background: ['#EC4899','#F97316','#22C55E','#06B6D4','#A855F7'][idx % 5], borderColor: 'var(--surface)' }}>{ini}</div>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{s.title}</div>
                  <div className="text-xs" style={{ color: 'var(--text-2)' }}>{s.when} · {s.duration}</div>
                </div>
                <div className="text-xs px-2 py-1 rounded-md shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--c-green) 14%, transparent)', color: 'var(--c-green)' }}>
                  {s.actions} actions
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* LIVE PREVIEW */}
      {activeMeeting && (
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: '#EF4444', boxShadow: '0 0 8px #EF4444' }} />
              <h3 className="text-h5" style={{ color: 'var(--text-1)' }}>Live Copilot — {activeMeeting.title}</h3>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'color-mix(in srgb, #EF4444 18%, transparent)', color: '#EF4444' }}>● LIVE</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-overline mb-3" style={{ color: 'var(--text-2)' }}>LIVE TRANSCRIPT</div>
              <div className="space-y-3">
                {MOCK_TRANSCRIPT.map((t, i) => (
                  <div key={i} className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold" style={{ color: t.color }}>● {t.speaker}</span>
                      <span className="text-xs" style={{ color: 'var(--text-2)' }}>{t.time}</span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{t.text}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-overline mb-3" style={{ color: 'var(--text-2)' }}>AI SUGGESTIONS</div>
              <div className="space-y-3">
                {MOCK_SUGGESTIONS.map((s, i) => (
                  <div key={i} className="rounded-xl p-4"
                    style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--c-purple) 18%, transparent), color-mix(in srgb, var(--c-cyan) 12%, transparent))',
                      border: '1px solid color-mix(in srgb, var(--c-purple) 30%, transparent)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md"
                        style={{ background: 'var(--c-purple)', color: '#FFFFFF' }}>{s.label}</span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{s.content}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
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

function MeetingCard({ meeting, enabled, onToggle }: { meeting: typeof MOCK_UPCOMING[0]; enabled: boolean; onToggle: (v: boolean) => void; }) {
  const platformStyles: Record<string, { bg: string; color: string; label: string }> = {
    teams: { bg: 'rgba(98,100,167,0.18)', color: '#8E91D8', label: 'TEAMS' },
    zoom:  { bg: 'rgba(45,140,255,0.16)', color: '#60A5FA', label: 'ZOOM' },
    meet:  { bg: 'rgba(52,168,83,0.16)',  color: '#34D399', label: 'MEET' },
  };
  const p = platformStyles[meeting.platform] || platformStyles.teams;
  return (
    <div className="rounded-xl p-4 flex items-center gap-4"
      style={{
        background: meeting.isLive ? 'color-mix(in srgb, var(--c-rose) 6%, var(--surface-2))' : 'var(--surface-2)',
        border: `1px solid ${meeting.isLive ? 'color-mix(in srgb, var(--c-rose) 35%, transparent)' : 'var(--border)'}`,
      }}>
      <div className="text-center min-w-[52px]">
        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{meeting.timeLabel}</div>
        <div className="text-[10px] font-semibold tracking-wider"
          style={{ color: meeting.isLive ? '#EF4444' : 'var(--text-2)' }}>{meeting.period}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate mb-1" style={{ color: 'var(--text-1)' }}>{meeting.title}</div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider"
            style={{ background: p.bg, color: p.color }}>{p.label}</span>
          <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {meeting.attendees} attendees</span>
          <span>·</span>
          <span>{meeting.duration}</span>
        </div>
      </div>
      <button onClick={() => onToggle(!enabled)}
        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all border"
        style={{
          background: enabled ? 'color-mix(in srgb, var(--c-purple) 12%, transparent)' : 'var(--surface-3)',
          borderColor: enabled ? 'color-mix(in srgb, var(--c-purple) 45%, transparent)' : 'var(--border)',
          color: enabled ? 'var(--c-purple)' : 'var(--text-2)',
        }}>
        <span className={`w-1.5 h-1.5 rounded-full`} style={{ background: enabled ? 'var(--c-purple)' : 'var(--text-3)' }} />
        Copilot {enabled ? 'ON' : 'OFF'}
      </button>
      <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white shrink-0"
        style={{ background: meeting.isLive ? 'linear-gradient(135deg,#EC4899,#F97316)' : 'linear-gradient(135deg,#3B82F6,#6366F1)' }}>
        {meeting.isLive ? <><Headphones className="w-3 h-3" /> Open Copilot</> : <><Play className="w-3 h-3" /> Join</>}
      </button>
    </div>
  );
}

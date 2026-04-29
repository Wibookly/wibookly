import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  CalendarClock,
  Save,
  Loader2,
  Plus,
  Trash2,
  Sun,
  Moon,
  Pencil,
  Check,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { TimePicker } from './TimePicker';

const DAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 0, label: 'Sunday', short: 'Sun' },
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

type BriefType = 'morning' | 'evening';

// A "Schedule" is a simple preset: a set of days + 1 or 2 send times.
interface Schedule {
  id: string; // local UUID
  name: string;
  enabled: boolean;
  days: number[]; // 0..6
  morningEnabled: boolean;
  morningTime: string; // HH:MM
  eveningEnabled: boolean;
  eveningTime: string; // HH:MM
}

interface ScheduleRow {
  id: string;
  day_of_week: number;
  brief_type: BriefType;
  send_time: string;
  is_enabled: boolean;
  timezone: string;
  recipient_email: string | null;
}

const PRESET_DAY_GROUPS: { label: string; days: number[] }[] = [
  { label: 'Weekdays (Mon–Fri)', days: [1, 2, 3, 4, 5] },
  { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekends', days: [6, 0] },
];

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function describeDays(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(6) && set.has(0)) return 'Weekends';
  if (set.size === 0) return 'No days selected';
  return DAYS.filter(d => set.has(d.value)).map(d => d.short).join(', ');
}

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${period}`;
}

function getBriefTone(time: string): BriefType {
  const hour = parseInt((time || '08:00').split(':')[0] || '8', 10);
  return hour < 12 ? 'morning' : 'evening';
}

function getBriefToneLabel(time: string): string {
  return getBriefTone(time) === 'morning' ? 'Good morning brief' : 'Good evening recap';
}

function getBriefToneHint(time: string): string {
  return `${formatTime(time)} → ${getBriefToneLabel(time)}`;
}

function describeTimes(s: Schedule): string {
  const parts: string[] = [];
  if (s.morningEnabled) parts.push(getBriefToneHint(s.morningTime));
  if (s.eveningEnabled) parts.push(getBriefToneHint(s.eveningTime));
  return parts.length ? parts.join(' & ') : 'No times set';
}

// Auto-generate a friendly schedule name from days + times,
// e.g. "Weekdays · 8:00 AM" or "Mon · 9:19 PM evening".
function autoName(s: { days: number[]; morningEnabled: boolean; morningTime: string; eveningEnabled: boolean; eveningTime: string }): string {
  const days = describeDays(s.days);
  const times: string[] = [];
  if (s.morningEnabled) times.push(getBriefToneHint(s.morningTime));
  if (s.eveningEnabled) times.push(getBriefToneHint(s.eveningTime));
  if (!times.length) return days;
  return `${days} · ${times.join(' & ')}`;
}

// Stable serialization of the parts that get persisted to the DB.
// Used to detect unsaved changes between the in-memory schedules and
// what's actually stored. Anything not in this string (like the local
// `name` and the local `id`) is intentionally ignored.
function snapshotKey(list: Schedule[], tz: string, recipient: string): string {
  const norm = list
    .filter(s => s.enabled && s.days.length > 0 && (s.morningEnabled || s.eveningEnabled))
    .map(s => ({
      d: [...s.days].sort(),
      m: s.morningEnabled ? s.morningTime : null,
      e: s.eveningEnabled ? s.eveningTime : null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ tz, recipient, norm });
}

export function DailyBriefSchedule() {
  const { profile, organization } = useAuth();
  const { activeConnection } = useActiveEmail();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Snapshot of what's actually persisted in the DB. We compare the
  // current `schedules` against this to detect unsaved changes so the
  // user gets a clear visual cue (and we never show "ACTIVE" for a
  // schedule that only exists in local state).
  const [savedSnapshot, setSavedSnapshot] = useState<string>('[]');

  const detectedTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
    catch { return 'America/New_York'; }
  })();
  const [timezone, setTimezone] = useState(detectedTz);
  const [recipient, setRecipient] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load existing rows from DB and reconstruct into schedule presets.
  // Strategy: group rows by "(morningTime, eveningTime)" tuple — every
  // distinct combination becomes one Schedule preset. This keeps the
  // legacy per-day storage but presents it as simple groups in the UI.
  useEffect(() => {
    if (!profile?.user_id) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('daily_brief_schedules')
        .select('*')
        .eq('user_id', profile.user_id) as { data: ScheduleRow[] | null };

      if (data && data.length) {
        const first = data[0];
        if (first.timezone) setTimezone(first.timezone);
        if (first.recipient_email) setRecipient(first.recipient_email);

        // Build per-day morning/evening map
        const perDay: Record<number, {
          morning: { enabled: boolean; time: string };
          evening: { enabled: boolean; time: string };
        }> = {};
        for (const r of data) {
          if (!perDay[r.day_of_week]) {
            perDay[r.day_of_week] = {
              morning: { enabled: false, time: '08:00' },
              evening: { enabled: false, time: '17:00' },
            };
          }
          perDay[r.day_of_week][r.brief_type] = {
            enabled: r.is_enabled,
            time: (r.send_time || '08:00').slice(0, 5),
          };
        }

        // Group days that share the same (morning?, mTime, evening?, eTime) signature
        const groups = new Map<string, Schedule>();
        for (const day of DAYS) {
          const cfg = perDay[day.value];
          if (!cfg) continue;
          if (!cfg.morning.enabled && !cfg.evening.enabled) continue;
          const key = `${cfg.morning.enabled ? cfg.morning.time : '-'}|${cfg.evening.enabled ? cfg.evening.time : '-'}`;
          if (!groups.has(key)) {
            groups.set(key, {
              id: genId(),
              name: 'Schedule',
              enabled: true,
              days: [],
              morningEnabled: cfg.morning.enabled,
              morningTime: cfg.morning.time,
              eveningEnabled: cfg.evening.enabled,
              eveningTime: cfg.evening.time,
            });
          }
          groups.get(key)!.days.push(day.value);
        }
        const list = Array.from(groups.values()).map((s) => ({
          ...s,
          name: autoName(s),
        }));
        setSchedules(list);
        setSavedSnapshot(snapshotKey(list, first.timezone || timezone, first.recipient_email || ''));
      } else {
        const initialRecipient = activeConnection?.email || profile?.email || '';
        setRecipient(initialRecipient);
        // Start with one sensible default — but mark snapshot as empty
        // so the user sees an "unsaved" indicator until they Save.
        setSchedules([{
          id: genId(),
          name: 'Weekday brief',
          enabled: true,
          days: [1, 2, 3, 4, 5],
          morningEnabled: true,
          morningTime: '08:00',
          eveningEnabled: false,
          eveningTime: '17:00',
        }]);
        setSavedSnapshot('[]');
      }

      setLoading(false);
    })();
  }, [profile?.user_id, activeConnection?.email, profile?.email]);

  const updateSchedule = (id: string, patch: Partial<Schedule>) => {
    setSchedules(prev => prev.map(s => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      // Auto-rename when days/times change, but never override an explicit name edit.
      if (!('name' in patch)) {
        next.name = autoName(next);
      }
      return next;
    }));
  };

  const toggleDay = (id: string, day: number) => {
    setSchedules(prev => prev.map(s => {
      if (s.id !== id) return s;
      const has = s.days.includes(day);
      const days = has ? s.days.filter(d => d !== day) : [...s.days, day].sort();
      const next = { ...s, days };
      next.name = autoName(next);
      return next;
    }));
  };

  const sendTestNow = async (s: Schedule) => {
    if (!profile?.user_id) return;
    try {
      toast.loading('Sending test brief…', { id: `test-${s.id}` });
      // Persist the latest schedule first so the cron sees the right config.
      await handleSave({ silent: true });
      const testTime = s.morningEnabled ? s.morningTime : s.eveningTime;
      const { data, error } = await supabase.functions.invoke('send-daily-brief', {
        body: { force: true, userId: profile.user_id, briefType: getBriefTone(testTime) },
      });
      if (error) throw error;
      const sent = (data as { sent?: number })?.sent ?? 0;
      if (sent > 0) {
        toast.success(`Test brief sent to ${recipient || 'your email'}`, { id: `test-${s.id}` });
      } else {
        toast.error('No brief was sent — check that the agent mailbox is configured', { id: `test-${s.id}` });
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to send test brief', { id: `test-${s.id}` });
    }
  };

  const addSchedule = (preset?: { days: number[]; name: string }) => {
    const id = genId();
    const base = {
      days: preset?.days ?? [1, 2, 3, 4, 5],
      morningEnabled: true,
      morningTime: '08:00',
      eveningEnabled: false,
      eveningTime: '17:00',
    };
    setSchedules(prev => [
      ...prev,
      {
        id,
        name: autoName(base),
        enabled: true,
        ...base,
      },
    ]);
    setEditingId(id);
  };

  const removeSchedule = (id: string) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleSave = async (opts?: { silent?: boolean }) => {
    if (!profile?.user_id || !organization?.id) return;
    setSaving(true);
    try {
      // Wipe existing and re-insert (simple + idempotent).
      // We flatten every Schedule into the legacy per-day rows the
      // backend cron job already understands.
      await supabase
        .from('daily_brief_schedules')
        .delete()
        .eq('user_id', profile.user_id);

      // Per-day aggregation: for each day, take the LAST schedule that
      // covers it (in the user-visible order) — this gives predictable
      // behavior when overlapping schedules disagree.
      const perDay: Record<number, { morning?: { enabled: boolean; time: string }; evening?: { enabled: boolean; time: string } }> = {};
      for (const s of schedules) {
        if (!s.enabled) continue;
        for (const d of s.days) {
          if (!perDay[d]) perDay[d] = {};
          if (s.morningEnabled) perDay[d].morning = { enabled: true, time: s.morningTime };
          if (s.eveningEnabled) perDay[d].evening = { enabled: true, time: s.eveningTime };
        }
      }

      const rows: Array<Record<string, unknown>> = [];
      for (const d of DAYS) {
        const cfg = perDay[d.value];
        for (const slot of ['morning', 'evening'] as BriefType[]) {
          const sub = cfg?.[slot];
          const time = (sub?.time) || (slot === 'morning' ? '08:00' : '17:00');
          rows.push({
            user_id: profile.user_id,
            organization_id: organization.id,
            connection_id: activeConnection?.id || null,
            day_of_week: d.value,
            brief_type: getBriefTone(time),
            send_time: `${time}:00`,
            is_enabled: !!sub?.enabled,
            timezone,
            recipient_email: recipient || null,
            sender_email: 'agent@energyforward.com',
          });
        }
      }

      if (rows.length) {
        const { error } = await supabase
          .from('daily_brief_schedules')
          .insert(rows as never);
        if (error) throw error;
      }
      // Update the snapshot to reflect what's now persisted so the
      // "unsaved changes" indicator clears immediately.
      setSavedSnapshot(snapshotKey(schedules, timezone, recipient));
      if (!opts?.silent) toast.success('Daily Brief schedule saved');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  const currentSnapshot = useMemo(
    () => snapshotKey(schedules, timezone, recipient),
    [schedules, timezone, recipient],
  );
  const hasUnsavedChanges = currentSnapshot !== savedSnapshot;
  // Set of (days+times) signatures that ARE persisted in the DB. We use
  // this to decide whether each row should show "ACTIVE" or "UNSAVED".
  const savedSignatures = useMemo(() => {
    try {
      const parsed = JSON.parse(savedSnapshot) as { norm?: Array<{ d: number[]; m: string | null; e: string | null }> };
      return new Set((parsed.norm || []).map(n => JSON.stringify(n)));
    } catch {
      return new Set<string>();
    }
  }, [savedSnapshot]);
  const isSchedulePersisted = (s: Schedule): boolean => {
    if (!s.enabled || s.days.length === 0 || (!s.morningEnabled && !s.eveningEnabled)) return false;
    const sig = JSON.stringify({
      d: [...s.days].sort(),
      m: s.morningEnabled ? s.morningTime : null,
      e: s.eveningEnabled ? s.eveningTime : null,
    });
    return savedSignatures.has(sig);
  };

  const summary = useMemo(() => {
    const active = schedules.filter(s => s.enabled && s.days.length > 0 && (s.morningEnabled || s.eveningEnabled));
    if (active.length === 0) return 'No schedules set';
    const base = `${active.length} schedule${active.length === 1 ? '' : 's'} set up`;
    return hasUnsavedChanges ? `${base} · unsaved changes` : base;
  }, [schedules, hasUnsavedChanges]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading schedule…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          Daily Brief Schedule
          <span className="ml-auto text-xs font-normal text-muted-foreground">{summary}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Recipient + timezone */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="recipient">Send to</Label>
            <Input
              id="recipient"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="you@company.com"
            />
            <p className="text-xs text-muted-foreground">
              Briefs are sent from <span className="font-mono">agent@energyforward.com</span>.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from(new Set([detectedTz, timezone, ...TIMEZONES])).filter(Boolean).map(tz => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        {/* Schedule list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Your schedules</h4>
            <div className="flex flex-wrap gap-2">
              {PRESET_DAY_GROUPS.map(p => (
                <Button
                  key={p.label}
                  variant="outline"
                  size="sm"
                  onClick={() => addSchedule({ days: p.days, name: p.label })}
                >
                  <Plus className="w-3 h-3 mr-1" /> {p.label}
                </Button>
              ))}
              <Button variant="default" size="sm" onClick={() => addSchedule()}>
                <Plus className="w-3 h-3 mr-1" /> Custom
              </Button>
            </div>
          </div>

          {schedules.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No schedules yet. Pick a preset above or click <span className="font-medium">Custom</span> to build one.
            </div>
          ) : (
            <div className="space-y-2">
              {schedules.map((s, idx) => {
                const isEditing = editingId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border bg-card transition-colors ${isEditing ? 'border-primary shadow-sm' : 'hover:border-primary/50'}`}
                  >
                    {/* Summary row — always visible */}
                    {(() => {
                      const savedTime = s.morningEnabled ? s.morningTime : (s.eveningEnabled ? s.eveningTime : '');
                      const isMorning = savedTime ? getBriefTone(savedTime) === 'morning' : false;
                      const persisted = isSchedulePersisted(s);
                      return (
                    <div className="flex items-center gap-3 p-3">
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) => updateSchedule(s.id, { enabled: v })}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-semibold ${s.enabled ? '' : 'text-muted-foreground'}`}>
                            {describeDays(s.days)}
                          </span>
                          {savedTime && (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md border ${
                                isMorning
                                  ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200'
                                  : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/40 text-indigo-900 dark:text-indigo-200'
                              }`}
                              title={`Send time (${timezone})`}
                            >
                              {isMorning ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
                              {formatTime(savedTime)}
                            </span>
                          )}
                          {s.enabled && persisted && (
                            <span className="text-[10px] uppercase tracking-wide bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                              Active
                            </span>
                          )}
                          {s.enabled && !persisted && (
                            <span
                              className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded animate-pulse"
                              title="This schedule has not been saved yet — click Save Schedule to activate it"
                            >
                              Unsaved
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {savedTime
                            ? `${getBriefToneLabel(savedTime)} · ${timezone}`
                            : 'No time set'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(isEditing ? null : s.id)}
                      >
                        {isEditing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeSchedule(s.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                      );
                    })()}

                    {/* Editor */}
                    {isEditing && (
                      <div className="border-t border-border p-4 space-y-4 bg-muted/20">
                        {/* Name */}
                        <div className="space-y-1.5">
                          <Label className="text-xs">Name</Label>
                          <Input
                            value={s.name}
                            onChange={(e) => updateSchedule(s.id, { name: e.target.value })}
                            placeholder="e.g. Weekday brief"
                            className="h-9 max-w-xs"
                          />
                        </div>

                        {/* Days */}
                        <div className="space-y-1.5">
                          <Label className="text-xs">Days</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {DAYS.map(d => {
                              const on = s.days.includes(d.value);
                              return (
                                <button
                                  key={d.value}
                                  type="button"
                                  onClick={() => toggleDay(s.id, d.value)}
                                  className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
                                    on
                                      ? 'bg-primary text-primary-foreground border-primary'
                                      : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                                  }`}
                                >
                                  {d.short}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2 pt-1">
                            {PRESET_DAY_GROUPS.map(p => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => updateSchedule(s.id, { days: p.days })}
                                className="text-[11px] text-primary hover:underline"
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Delivery time — single adaptive block.
                            The chosen time decides the tone automatically:
                            AM → "Good morning brief" (sun, amber theme),
                            PM → "Good evening recap" (moon, indigo theme). */}
                        {(() => {
                          // Pick the active time. Prefer the morning slot if
                          // it's enabled, otherwise the evening slot. We
                          // collapse the previous two-slot model into a
                          // single time and let the tone be derived from
                          // the hour the user picks.
                          const activeTime = s.morningEnabled ? s.morningTime : s.eveningTime;
                          const isMorning = getBriefTone(activeTime) === 'morning';
                          const setActiveTime = (t: string) => {
                            // Snap into morning or evening slot based on the
                            // chosen hour, and clear the other slot so we
                            // never persist two values for the same schedule.
                            if (getBriefTone(t) === 'morning') {
                              updateSchedule(s.id, {
                                morningEnabled: true,
                                morningTime: t,
                                eveningEnabled: false,
                              });
                            } else {
                              updateSchedule(s.id, {
                                eveningEnabled: true,
                                eveningTime: t,
                                morningEnabled: false,
                              });
                            }
                          };

                          return (
                            <div
                              className={`rounded-md border p-4 space-y-3 transition-colors ${
                                isMorning
                                  ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                                  : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <Label className="text-xs flex items-center gap-1.5 font-semibold">
                                  {isMorning ? (
                                    <>
                                      <Sun className="w-4 h-4 text-amber-500" />
                                      <span className="text-amber-900 dark:text-amber-200">Morning delivery</span>
                                    </>
                                  ) : (
                                    <>
                                      <Moon className="w-4 h-4 text-indigo-500" />
                                      <span className="text-indigo-900 dark:text-indigo-200">Evening delivery</span>
                                    </>
                                  )}
                                </Label>
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                                    isMorning
                                      ? 'bg-amber-500/20 text-amber-900 dark:text-amber-200'
                                      : 'bg-indigo-500/20 text-indigo-900 dark:text-indigo-200'
                                  }`}
                                >
                                  {getBriefToneLabel(activeTime)}
                                </span>
                              </div>
                              <TimePicker
                                value={activeTime}
                                onChange={setActiveTime}
                              />
                              <p className="text-xs text-muted-foreground">
                                {getBriefToneHint(activeTime)}
                              </p>
                            </div>
                          );
                        })()}

                        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                          The chosen time decides the tone automatically: times before <span className="font-medium text-foreground">12:00 PM</span> send a <span className="font-medium text-foreground">Good morning</span> brief, and times from <span className="font-medium text-foreground">12:00 PM onward</span> send a <span className="font-medium text-foreground">Good evening</span> recap.
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => sendTestNow(s)}>
                            <Send className="w-4 h-4 mr-1.5" /> Send Test Now
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                            <Check className="w-4 h-4 mr-1.5" /> Done
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => handleSave()} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Schedule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

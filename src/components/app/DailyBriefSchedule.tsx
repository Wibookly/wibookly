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

function describeTimes(s: Schedule): string {
  const parts: string[] = [];
  if (s.morningEnabled) parts.push(`${formatTime(s.morningTime)} morning`);
  if (s.eveningEnabled) parts.push(`${formatTime(s.eveningTime)} evening`);
  return parts.length ? parts.join(' & ') : 'No times set';
}

// Auto-generate a friendly schedule name from days + times,
// e.g. "Weekdays · 8:00 AM" or "Mon · 9:19 PM evening".
function autoName(s: { days: number[]; morningEnabled: boolean; morningTime: string; eveningEnabled: boolean; eveningTime: string }): string {
  const days = describeDays(s.days);
  const times: string[] = [];
  if (s.morningEnabled) times.push(`${formatTime(s.morningTime)} morning`);
  if (s.eveningEnabled) times.push(`${formatTime(s.eveningTime)} evening`);
  if (!times.length) return days;
  return `${days} · ${times.join(' & ')}`;
}

export function DailyBriefSchedule() {
  const { profile, organization } = useAuth();
  const { activeConnection } = useActiveEmail();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

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
      } else {
        setRecipient(activeConnection?.email || profile?.email || '');
        // Start with one sensible default
        setSchedules([{
          id: genId(),
          name: 'Weekday brief',
          enabled: true,
          days: [1, 2, 3, 4, 5],
          morningEnabled: true,
          morningTime: '08:00',
          eveningEnabled: true,
          eveningTime: '17:00',
        }]);
      }

      setLoading(false);
    })();
  }, [profile?.user_id, activeConnection?.email, profile?.email]);

  const updateSchedule = (id: string, patch: Partial<Schedule>) => {
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const toggleDay = (id: string, day: number) => {
    setSchedules(prev => prev.map(s => {
      if (s.id !== id) return s;
      const has = s.days.includes(day);
      return { ...s, days: has ? s.days.filter(d => d !== day) : [...s.days, day].sort() };
    }));
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

  const handleSave = async () => {
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
        for (const type of ['morning', 'evening'] as BriefType[]) {
          const sub = cfg?.[type];
          rows.push({
            user_id: profile.user_id,
            organization_id: organization.id,
            connection_id: activeConnection?.id || null,
            day_of_week: d.value,
            brief_type: type,
            send_time: `${(sub?.time) || (type === 'morning' ? '08:00' : '17:00')}:00`,
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
      toast.success('Daily Brief schedule saved');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    const active = schedules.filter(s => s.enabled && s.days.length > 0 && (s.morningEnabled || s.eveningEnabled));
    if (active.length === 0) return 'No schedules set';
    return `${active.length} schedule${active.length === 1 ? '' : 's'} set up`;
  }, [schedules]);

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
                    <div className="flex items-center gap-3 p-3">
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) => updateSchedule(s.id, { enabled: v })}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${s.enabled ? '' : 'text-muted-foreground'}`}>
                            {s.name || `Schedule ${idx + 1}`}
                          </span>
                          {s.enabled && (
                            <span className="text-[10px] uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {describeDays(s.days)} · {describeTimes(s)}
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

                        {/* Times */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-md border bg-background p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs flex items-center gap-1.5 font-medium">
                                <Sun className="w-3.5 h-3.5 text-amber-500" /> Morning
                              </Label>
                              <Switch
                                checked={s.morningEnabled}
                                onCheckedChange={(v) => updateSchedule(s.id, { morningEnabled: v })}
                              />
                            </div>
                            <div className={s.morningEnabled ? '' : 'opacity-50 pointer-events-none'}>
                              <TimePicker
                                value={s.morningTime}
                                onChange={(t) => updateSchedule(s.id, { morningTime: t })}
                                disabled={!s.morningEnabled}
                              />
                            </div>
                          </div>
                          <div className="rounded-md border bg-background p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs flex items-center gap-1.5 font-medium">
                                <Moon className="w-3.5 h-3.5 text-indigo-500" /> Evening
                              </Label>
                              <Switch
                                checked={s.eveningEnabled}
                                onCheckedChange={(v) => updateSchedule(s.id, { eveningEnabled: v })}
                              />
                            </div>
                            <div className={s.eveningEnabled ? '' : 'opacity-50 pointer-events-none'}>
                              <TimePicker
                                value={s.eveningTime}
                                onChange={(t) => updateSchedule(s.id, { eveningTime: t })}
                                disabled={!s.eveningEnabled}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-end">
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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Schedule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

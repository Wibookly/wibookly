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
import { CalendarClock, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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

interface DayConfig {
  enabled: boolean;
  morning: { enabled: boolean; time: string };
  evening: { enabled: boolean; time: string };
}

const defaultDay = (dayValue: number): DayConfig => ({
  enabled: dayValue >= 1 && dayValue <= 5,
  morning: { enabled: dayValue >= 1 && dayValue <= 5, time: '08:00' },
  evening: { enabled: dayValue >= 1 && dayValue <= 5, time: '17:00' },
});

interface ScheduleRow {
  id: string;
  day_of_week: number;
  brief_type: BriefType;
  send_time: string;
  is_enabled: boolean;
  timezone: string;
  recipient_email: string | null;
}

export function DailyBriefSchedule() {
  const { profile, organization } = useAuth();
  const { activeConnection } = useActiveEmail();

  const [days, setDays] = useState<Record<number, DayConfig>>(() => {
    const initial: Record<number, DayConfig> = {};
    DAYS.forEach(d => { initial[d.value] = defaultDay(d.value); });
    return initial;
  });
  const [timezone, setTimezone] = useState('America/New_York');
  const [recipient, setRecipient] = useState('');
  const [bulkApply, setBulkApply] = useState(false);
  const [bulkMorning, setBulkMorning] = useState('08:00');
  const [bulkEvening, setBulkEvening] = useState('17:00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile?.user_id) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('daily_brief_schedules')
        .select('*')
        .eq('user_id', profile.user_id) as { data: ScheduleRow[] | null };

      const next: Record<number, DayConfig> = {};
      DAYS.forEach(d => { next[d.value] = defaultDay(d.value); });

      if (data && data.length) {
        // Reset enabled flags so we can rehydrate from DB
        DAYS.forEach(d => {
          next[d.value] = {
            enabled: false,
            morning: { enabled: false, time: '08:00' },
            evening: { enabled: false, time: '17:00' },
          };
        });
        for (const r of data) {
          const dc = next[r.day_of_week] ?? defaultDay(r.day_of_week);
          dc[r.brief_type] = { enabled: r.is_enabled, time: (r.send_time || '08:00').slice(0, 5) };
          if (r.is_enabled) dc.enabled = true;
          next[r.day_of_week] = dc;
        }
        const first = data[0];
        if (first.timezone) setTimezone(first.timezone);
        if (first.recipient_email) setRecipient(first.recipient_email);
      } else {
        setRecipient(activeConnection?.email || profile?.email || '');
      }

      setDays(next);
      setLoading(false);
    })();
  }, [profile?.user_id, activeConnection?.email, profile?.email]);

  const updateDay = (day: number, patch: Partial<DayConfig>) => {
    setDays(prev => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  };
  const updateBrief = (day: number, type: BriefType, patch: Partial<DayConfig['morning']>) => {
    setDays(prev => ({
      ...prev,
      [day]: { ...prev[day], [type]: { ...prev[day][type], ...patch } },
    }));
  };

  const applyBulk = (scope: 'weekdays' | 'all') => {
    setDays(prev => {
      const next = { ...prev };
      const targets = scope === 'weekdays' ? [1, 2, 3, 4, 5] : DAYS.map(d => d.value);
      for (const t of targets) {
        next[t] = {
          enabled: true,
          morning: { enabled: true, time: bulkMorning },
          evening: { enabled: true, time: bulkEvening },
        };
      }
      return next;
    });
    toast.success(`Applied ${bulkMorning} morning / ${bulkEvening} evening to ${scope === 'weekdays' ? 'Mon–Fri' : 'every day'}.`);
  };

  const handleSave = async () => {
    if (!profile?.user_id || !organization?.id) return;
    setSaving(true);
    try {
      // Wipe existing and re-insert (simple + idempotent)
      await supabase
        .from('daily_brief_schedules')
        .delete()
        .eq('user_id', profile.user_id);

      const rows: Array<Record<string, unknown>> = [];
      for (const d of DAYS) {
        const cfg = days[d.value];
        if (!cfg) continue;
        for (const type of ['morning', 'evening'] as BriefType[]) {
          const sub = cfg[type];
          rows.push({
            user_id: profile.user_id,
            organization_id: organization.id,
            connection_id: activeConnection?.id || null,
            day_of_week: d.value,
            brief_type: type,
            send_time: `${sub.time}:00`,
            is_enabled: cfg.enabled && sub.enabled,
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
    const enabledDays = DAYS.filter(d => {
      const c = days[d.value];
      return c && c.enabled && (c.morning.enabled || c.evening.enabled);
    });
    return enabledDays.length === 0
      ? 'No briefs scheduled'
      : `${enabledDays.length} day${enabledDays.length === 1 ? '' : 's'} scheduled`;
  }, [days]);

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
                {TIMEZONES.map(tz => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        {/* Bulk apply */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">Quick set</h4>
              <p className="text-xs text-muted-foreground">Apply the same morning + evening time across multiple days.</p>
            </div>
            <Switch checked={bulkApply} onCheckedChange={setBulkApply} />
          </div>
          {bulkApply && (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
              <div className="space-y-1">
                <Label className="text-xs">Morning time</Label>
                <Input type="time" value={bulkMorning} onChange={(e) => setBulkMorning(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Evening time</Label>
                <Input type="time" value={bulkEvening} onChange={(e) => setBulkEvening(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" onClick={() => applyBulk('weekdays')} className="self-end">
                Apply Mon–Fri
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyBulk('all')} className="self-end">
                Apply Every Day
              </Button>
            </div>
          )}
        </div>

        {/* Per-day grid */}
        <div className="space-y-2">
          {DAYS.map(d => {
            const cfg = days[d.value];
            return (
              <div key={d.value} className="grid grid-cols-[1fr_auto] sm:grid-cols-[140px_1fr_1fr] gap-3 items-center rounded-lg border bg-card p-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={cfg.enabled}
                    onCheckedChange={(v) => updateDay(d.value, { enabled: v })}
                  />
                  <span className={`text-sm font-medium ${cfg.enabled ? '' : 'text-muted-foreground'}`}>{d.label}</span>
                </div>
                <div className={`flex items-center gap-2 ${cfg.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                  <Switch
                    checked={cfg.morning.enabled}
                    onCheckedChange={(v) => updateBrief(d.value, 'morning', { enabled: v })}
                  />
                  <Label className="text-xs w-16">Morning</Label>
                  <Input
                    type="time"
                    className="h-9 w-32"
                    value={cfg.morning.time}
                    onChange={(e) => updateBrief(d.value, 'morning', { time: e.target.value })}
                  />
                </div>
                <div className={`flex items-center gap-2 ${cfg.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                  <Switch
                    checked={cfg.evening.enabled}
                    onCheckedChange={(v) => updateBrief(d.value, 'evening', { enabled: v })}
                  />
                  <Label className="text-xs w-16">Evening</Label>
                  <Input
                    type="time"
                    className="h-9 w-32"
                    value={cfg.evening.time}
                    onChange={(e) => updateBrief(d.value, 'evening', { time: e.target.value })}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Schedule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

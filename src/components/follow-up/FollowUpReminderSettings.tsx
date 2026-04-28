import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Mail, AlertTriangle, Clock, Send, FileEdit, Tag, Lock, RefreshCw, Search, CalendarClock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Settings {
  id: string;
  is_enabled: boolean;
  auto_draft_enabled: boolean;
  auto_reply_enabled: boolean;
  skip_if_replied: boolean;
  reminder_max_count: number;
  reminder_intervals_days: number[];
  bcc_domain: string;
  daily_audit_enabled: boolean;
  last_audit_at: string | null;
  last_audit_summary: {
    scanned?: number;
    flagged?: number;
    already_replied?: number;
    errors?: number;
    mode?: string;
    from?: string;
    to?: string;
  } | null;
  business_hours_only: boolean;
  business_hours_start: number;
  business_hours_end: number;
  business_days: number[];
  timezone: string | null;
}

const PRESETS = [2, 3, 5, 7, 10, 14, 21, 30];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
  catch { return 'America/New_York'; }
}
function fmtHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:00 ${ampm}`;
}

export default function FollowUpReminderSettings({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const { activeConnection } = useActiveEmail();
  const { hasFeature, loading: featureLoading } = useFeatureAccess();
  const allowed = hasFeature('feature.follow_up_reminder');

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [intervalsDraft, setIntervalsDraft] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [auditFrom, setAuditFrom] = useState(isoDaysAgo(30));
  const [auditTo, setAuditTo] = useState(todayIso());

  async function load() {
    if (!activeConnection?.id) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_or_create_follow_up_settings', {
      _connection_id: activeConnection.id,
    });
    if (error) {
      toast({ title: 'Could not load settings', description: error.message, variant: 'destructive' });
    } else if (data) {
      const row = data as unknown as Settings;
      setSettings(row);
      setIntervalsDraft((row.reminder_intervals_days ?? []).join(', '));
      // First-load convenience: if no timezone is stored yet, populate it
      // from the browser so the user sees their local hours straight away.
      if (!row.timezone) {
        const tz = browserTimezone();
        await supabase.from('follow_up_settings').update({ timezone: tz }).eq('id', row.id);
        setSettings({ ...row, timezone: tz });
      }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [activeConnection?.id]);

  async function patch(updates: Partial<Settings>) {
    if (!settings) return;
    setSaving(true);
    const next = { ...settings, ...updates };
    setSettings(next);
    const { error } = await supabase
      .from('follow_up_settings')
      .update(updates)
      .eq('id', settings.id);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      setSettings(settings);
    }
    setSaving(false);
  }

  async function saveIntervals() {
    if (!settings) return;
    const parsed = intervalsDraft
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 90);
    if (parsed.length === 0) {
      toast({ title: 'Invalid intervals', description: 'Use comma-separated whole numbers (1–90).', variant: 'destructive' });
      return;
    }
    await patch({ reminder_intervals_days: parsed });
    toast({ title: 'Reminder schedule saved' });
  }

  async function runScan() {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('cron-follow-ups', { body: {} });
      if (error) throw error;
      toast({ title: 'Scan started', description: 'Trackers and drafts will appear in a moment.' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: 'Scan failed', description: msg, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  }

  async function runAudit() {
    if (!activeConnection?.id) return;
    if (auditFrom > auditTo) {
      toast({ title: 'Invalid range', description: '"From" date must be before "To" date.', variant: 'destructive' });
      return;
    }
    setAuditing(true);
    try {
      const { data, error } = await supabase.functions.invoke('audit-inbox-followups', {
        body: {
          connection_id: activeConnection.id,
          from_date: auditFrom,
          to_date: new Date(auditTo + 'T23:59:59').toISOString(),
        },
      });
      if (error) throw error;
      const r = data as { scanned?: number; flagged?: number; already_replied?: number; errors?: number };
      toast({
        title: 'Audit complete',
        description: `Scanned ${r.scanned ?? 0} sent emails — flagged ${r.flagged ?? 0} for follow-up, ${r.already_replied ?? 0} already had replies.`,
      });
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: 'Audit failed', description: msg, variant: 'destructive' });
    } finally {
      setAuditing(false);
    }
  }

  if (featureLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <Alert variant="destructive">
        <Lock className="w-4 h-4" />
        <AlertTitle>Feature locked</AlertTitle>
        <AlertDescription>
          Follow-Up Reminder is not enabled for your group. Ask your admin to enable
          <strong> feature.follow_up_reminder</strong> in Admin → Groups.
        </AlertDescription>
      </Alert>
    );
  }

  if (!activeConnection) {
    return (
      <Alert>
        <AlertTriangle className="w-4 h-4" />
        <AlertTitle>Connect a mailbox first</AlertTitle>
        <AlertDescription>
          Go to <strong>Integrations</strong> and connect your Outlook account to enable Follow-Up Reminder.
        </AlertDescription>
      </Alert>
    );
  }

  if (!settings) return null;

  const domain = settings.bcc_domain;

  return (
    <div className="space-y-6">
      {/* Master toggle */}
      <Card className={compact ? 'border-primary/30' : ''}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary" /> Follow-Up Reminder
                {settings.is_enabled ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Active</Badge>
                ) : (
                  <Badge variant="outline">Off</Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1.5 max-w-2xl">
                BCC <code className="font-mono text-xs px-1 py-0.5 rounded bg-muted">N@{domain}</code> on any email
                (where N = days). When the due date hits, if the recipient hasn't replied, InboxIQ moves the
                original to your <strong>Follow Up</strong> category and applies the action you choose below.
              </CardDescription>
            </div>
            <Switch
              checked={settings.is_enabled}
              disabled={saving}
              onCheckedChange={(v) => patch({ is_enabled: v })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Active mailbox: <span className="font-mono text-foreground">{activeConnection.email}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((d) => (
              <Badge key={d} variant="outline" className="font-mono">
                {d}@{domain}
              </Badge>
            ))}
            <Badge variant="outline" className="font-mono text-muted-foreground">
              …any number works
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Action mode */}
      <Card className={!settings.is_enabled ? 'opacity-60 pointer-events-none' : ''}>
        <CardHeader>
          <CardTitle className="text-base">When the due date arrives</CardTitle>
          <CardDescription>Pick what InboxIQ does after confirming there's been no reply.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionRow
            icon={Tag}
            title="Always: move to Follow Up category"
            description="Original email is labeled and surfaced in your inbox so you can act on it. Always on."
            checked={true}
            disabled
            onChange={() => {}}
          />
          <ActionRow
            icon={FileEdit}
            title="Auto Draft a follow-up"
            description="AI writes a polite nudge into your Outlook Drafts. You review and send."
            checked={settings.auto_draft_enabled}
            onChange={(v) => patch({ auto_draft_enabled: v })}
          />
          <ActionRow
            icon={Send}
            title="Auto Reply (sends automatically)"
            description="AI writes AND sends the follow-up without review. Use with care."
            checked={settings.auto_reply_enabled}
            onChange={(v) => patch({ auto_reply_enabled: v })}
            warning={settings.auto_reply_enabled ? 'Replies will be sent without your review.' : undefined}
          />
        </CardContent>
      </Card>

      {/* Business hours */}
      <Card className={!settings.is_enabled ? 'opacity-60 pointer-events-none' : ''}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4" /> Business hours
              </CardTitle>
              <CardDescription className="mt-1.5">
                When on, <strong>Auto Draft</strong>, <strong>Auto Reply</strong> and the
                daily auto-audit only run during your local working hours. Outside hours,
                emails are still <em>moved</em> to your Follow Up category — drafts and sends
                wait until business hours resume.
              </CardDescription>
            </div>
            <Switch
              checked={settings.business_hours_only}
              disabled={saving}
              onCheckedChange={(v) => patch({ business_hours_only: v })}
            />
          </div>
        </CardHeader>
        <CardContent className={`space-y-4 ${!settings.business_hours_only ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bh-start">Start (local)</Label>
              <select
                id="bh-start"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={settings.business_hours_start}
                onChange={(e) => patch({ business_hours_start: parseInt(e.target.value, 10) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h} disabled={h >= settings.business_hours_end}>{fmtHour(h)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bh-end">End (local)</Label>
              <select
                id="bh-end"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={settings.business_hours_end}
                onChange={(e) => patch({ business_hours_end: parseInt(e.target.value, 10) })}
              >
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                  <option key={h} value={h} disabled={h <= settings.business_hours_start}>
                    {h === 24 ? '12:00 AM (next day)' : fmtHour(h)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bh-tz">Timezone</Label>
              <div className="flex gap-2">
                <Input
                  id="bh-tz"
                  value={settings.timezone ?? ''}
                  placeholder="America/New_York"
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  onBlur={() => patch({ timezone: settings.timezone || browserTimezone() })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => patch({ timezone: browserTimezone() })}
                  title="Use this computer's timezone"
                >
                  Use mine
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Auto-detected from Outlook on first run; falls back to your computer.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Business days</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((label, idx) => {
                const active = settings.business_days.includes(idx);
                return (
                  <Button
                    key={idx}
                    type="button"
                    variant={active ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      const next = active
                        ? settings.business_days.filter((d) => d !== idx)
                        : [...settings.business_days, idx].sort();
                      patch({ business_days: next });
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Current window: <strong>{fmtHour(settings.business_hours_start)}</strong> – <strong>{settings.business_hours_end === 24 ? '12:00 AM' : fmtHour(settings.business_hours_end)}</strong>
            {settings.timezone ? <> ({settings.timezone})</> : null}
          </div>
        </CardContent>
      </Card>

      {/* Reminder loop */}
      <Card className={!settings.is_enabled ? 'opacity-60 pointer-events-none' : ''}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Missed follow-up reminders
          </CardTitle>
          <CardDescription>
            If you miss a drafted follow-up, the agent will email you a reminder up to{' '}
            <strong>{settings.reminder_max_count}</strong> times.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rmax">Maximum reminders</Label>
              <Input
                id="rmax"
                type="number"
                min={0}
                max={5}
                value={settings.reminder_max_count}
                onChange={(e) =>
                  patch({ reminder_max_count: Math.max(0, Math.min(5, parseInt(e.target.value, 10) || 0)) })
                }
              />
              <p className="text-xs text-muted-foreground">0–5 nudges before giving up.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rint">Reminder intervals (days)</Label>
              <div className="flex gap-2">
                <Input
                  id="rint"
                  value={intervalsDraft}
                  onChange={(e) => setIntervalsDraft(e.target.value)}
                  placeholder="1, 3, 7"
                />
                <Button variant="outline" onClick={saveIntervals}>Save</Button>
              </div>
              <p className="text-xs text-muted-foreground">Days after the missed action to nudge you.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manual inbox audit */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" /> Inbox audit
          </CardTitle>
          <CardDescription>
            Scan your <strong>Sent Items</strong> over a date range and flag every email
            that hasn't received a reply. Flagged emails are copied into your Outlook
            <code className="font-mono text-xs px-1 mx-1 rounded bg-muted">Follow-up</code>
            folder and surfaced in the InboxIQ <strong>Follow Up</strong> category. No
            drafts are written and nothing is sent — pure audit for your review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="audit-from">From</Label>
              <Input id="audit-from" type="date" value={auditFrom} max={auditTo}
                onChange={(e) => setAuditFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-to">To</Label>
              <Input id="audit-to" type="date" value={auditTo} min={auditFrom} max={todayIso()}
                onChange={(e) => setAuditTo(e.target.value)} />
            </div>
            <Button onClick={runAudit} disabled={auditing}>
              {auditing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              {auditing ? 'Auditing…' : 'Audit now'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {[7, 30, 90].map((d) => (
              <Button key={d} variant="ghost" size="sm" onClick={() => { setAuditFrom(isoDaysAgo(d)); setAuditTo(todayIso()); }}>
                Last {d} days
              </Button>
            ))}
          </div>

          <div className="rounded-lg border p-3 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-md bg-secondary/60 text-foreground/80 mt-0.5">
                <CalendarClock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm">Auto-audit every 24 hours</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Each day, InboxIQ scans the previous 24 hours of Sent Items and
                  flags anything that hasn't been replied to.
                </div>
              </div>
            </div>
            <Switch
              checked={settings.daily_audit_enabled}
              disabled={saving}
              onCheckedChange={(v) => patch({ daily_audit_enabled: v })}
            />
          </div>

          {settings.last_audit_at ? (
            <div className="text-xs text-muted-foreground">
              Last audit: {new Date(settings.last_audit_at).toLocaleString()}
              {settings.last_audit_summary ? (
                <> — scanned <strong>{settings.last_audit_summary.scanned ?? 0}</strong>,
                  flagged <strong>{settings.last_audit_summary.flagged ?? 0}</strong>,
                  already replied <strong>{settings.last_audit_summary.already_replied ?? 0}</strong>
                  {settings.last_audit_summary.mode === 'daily_cron' ? ' (auto)' : ''}</>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          Auto-runs every 15 minutes. <strong>Auto Draft</strong> and <strong>Auto Reply</strong>
          fire within 15 minutes of a follow-up's due date.
        </p>
        <Button variant="outline" onClick={runScan} disabled={running}>
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Run scan now
        </Button>
      </div>
    </div>
  );
}

function ActionRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  disabled,
  warning,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  warning?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="p-2 rounded-md bg-secondary/60 text-foreground/80 mt-0.5">
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
          {warning ? (
            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {warning}
            </div>
          ) : null}
        </div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

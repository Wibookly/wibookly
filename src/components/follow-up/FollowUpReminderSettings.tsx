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
import { Loader2, Mail, AlertTriangle, Clock, Send, FileEdit, Tag, Lock, CalendarClock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
  
  const [intervalsDraft, setIntervalsDraft] = useState('');

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

  // When the page is opened, kick off a silent background scan so the
  // dashboard reflects the latest activity without requiring a button click.
  useEffect(() => {
    if (!activeConnection?.id) return;
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return;
      supabase.functions.invoke('cron-follow-ups', {
        headers: { Authorization: `Bearer ${token}` },
        body: { mode: 'manual', connection_id: activeConnection.id },
      }).catch(() => { /* silent */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id]);

  async function ensureTrackerCategory() {
    if (!activeConnection?.id) return;
    try {
      await supabase.rpc('ensure_no_reply_tracker_category', { _connection_id: activeConnection.id });
    } catch (e) {
      console.warn('ensure_no_reply_tracker_category failed', e);
    }
  }

  async function patch(updates: Partial<Settings>) {
    if (!settings) return;
    setSaving(true);
    // When master toggle is turned ON, force the supporting defaults ON too.
    let finalUpdates: Partial<Settings> = { ...updates };
    if (updates.is_enabled === true && !settings.is_enabled) {
      finalUpdates = {
        ...finalUpdates,
        business_hours_only: true,
        daily_audit_enabled: true,
        auto_draft_enabled: true,
      };
      await ensureTrackerCategory();
    }
    const next = { ...settings, ...finalUpdates };
    setSettings(next);
    const { error } = await supabase
      .from('follow_up_settings')
      .update(finalUpdates)
      .eq('id', settings.id);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      setSettings(settings);
    } else if (updates.is_enabled === true) {
      toast({
        title: 'No Reply Tracker enabled',
        description: 'Business hours, daily 24-hour auto-sync, and auto-draft are now active. The "No Reply Tracker" category was added in red.',
      });
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
          No Reply Tracker is not enabled for your group. Ask your admin to enable
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
          Go to <strong>Integrations</strong> and connect your Outlook account to enable No Reply Tracker.
        </AlertDescription>
      </Alert>
    );
  }

  if (!settings) return null;

  // Always derive the BCC domain from the user's actual mailbox so the
  // instructions on this page work for ANY tenant — no shared mailbox or
  // hardcoded domain required. The stored bcc_domain is only a fallback.
  const mailboxDomain =
    (activeConnection.email?.split('@')[1] || '').trim().toLowerCase() ||
    settings.bcc_domain;
  const domain = mailboxDomain;

  return (
    <div className="space-y-6">
      {/* Master toggle */}
      <Card data-tour="followup-master" className={compact ? 'border-primary/30' : ''}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 flex-wrap">
                <StepBadge n={1} />
                <Mail className="w-5 h-5 text-primary" /> No Reply Tracker
                {settings.is_enabled ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Active</Badge>
                ) : (
                  <Badge variant="outline">Off</Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1.5 max-w-2xl space-y-2">
                <p>
                  <strong>In plain English:</strong> No Reply Tracker makes sure you never lose
                  an email you're waiting on a reply for.
                </p>
                <p>
                  When you send an email and you expect an answer back, just add a BCC like{' '}
                  <code className="font-mono text-[11px] px-1 rounded bg-muted">3@{domain}</code>{' '}
                  — the number is how many days you're willing to wait. If the recipient replies
                  in time, nothing happens. If they don't, InboxIQ automatically <strong>drafts a
                  polite follow-up</strong> for you to review (or <strong>drafts and sends it</strong>{' '}
                  if you turn on Auto Reply) so the conversation never goes cold.
                </p>
                <p className="text-xs">
                  Works on <strong>any</strong> domain — no shared mailbox or extra inbox needed.
                  The BCC address is just a private signal to InboxIQ; it never has to receive mail.
                </p>
              </CardDescription>

            </div>
            <Switch
              data-tour="followup-toggle"
              checked={settings.is_enabled}
              disabled={saving}
              onCheckedChange={(v) => patch({ is_enabled: v })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="text-xs text-muted-foreground">
            Active mailbox: <span className="font-mono text-foreground">{activeConnection.email}</span>
            {' '}· Your trigger domain: <span className="font-mono text-foreground">@{domain}</span>
          </div>

          {/* Visual flow */}
          <div data-tour="followup-flow" className="grid md:grid-cols-4 gap-2">
            <FlowStep
              n={1}
              title="BCC a number"
              body={
                <>Send your email and BCC <code className="font-mono text-[11px] px-1 rounded bg-muted">N@{domain}</code> where <strong>N</strong> is the days to wait (min 2).</>
              }
            />
            <FlowStep
              n={2}
              title="We watch the reply"
              body="On the due date InboxIQ checks the thread. If the recipient replied, the tracker clears itself."
            />
            <FlowStep
              n={3}
              title="No reply → nudge"
              body={
                <>If still no reply, we tag the message <strong>No Reply Tracker</strong> and (if Auto Draft is on) write a polite follow-up into your Drafts.</>
              }
            />
            <FlowStep
              n={4}
              title="Up to 3 attempts"
              body={
                <>You get <strong>up to {settings.reminder_max_count} reminders</strong>, then we stop automatically. The label stays so you can decide.</>
              }
            />
          </div>

          {/* Cancel + examples */}
          <div data-tour="followup-stop" className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
            <div className="font-medium text-foreground">Stop or restart anytime</div>
            <p className="text-xs text-muted-foreground">
              Reply on the thread with BCC{' '}
              <code className="font-mono text-[11px] px-1 rounded bg-background border">stop@{domain}</code>{' '}
              (or <code className="font-mono text-[11px] px-1 rounded bg-background border">0@{domain}</code>) to cancel.
              To re-arm, send a new email with another numeric BCC like{' '}
              <code className="font-mono text-[11px] px-1 rounded bg-background border">3@{domain}</code>.
            </p>
          </div>

          {/* Sample addresses */}
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">Examples for your mailbox:</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((d) => (
                <Badge key={d} variant="outline" className="font-mono">
                  {d}@{domain}
                </Badge>
              ))}
              <Badge variant="outline" className="font-mono text-muted-foreground">
                …any number ≥ 2 works
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Action mode */}
      <Card data-tour="followup-actions" className={!settings.is_enabled ? 'opacity-70' : ''}>

        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <StepBadge n={2} /> When the due date arrives
          </CardTitle>
          <CardDescription>
            {settings.is_enabled
              ? 'Pick what InboxIQ does after confirming there\'s been no reply.'
              : 'Locked — turn on Step 1 (the master switch above) to edit these actions.'}
          </CardDescription>
        </CardHeader>
        <CardContent className={`space-y-4 ${!settings.is_enabled ? 'pointer-events-none' : ''}`}>
          <div data-tour="followup-action-tag">
            <ActionRow
              icon={Tag}
              title="Always: move to No Reply Tracker category"
              description="Original email is labeled and surfaced in your inbox so you can act on it. This is built into the tracker and can't be turned off."
              checked={true}
              onChange={() => {}}
              alwaysOn
            />
          </div>

          <div data-tour="followup-action-draft">
            <ActionRow
              icon={FileEdit}
              title="Auto Draft a follow-up"
              description="AI writes a polite nudge into your Outlook Drafts. You review and send."
              checked={settings.auto_draft_enabled}
              disabled={!settings.is_enabled}
              disabledHint="Turn on Step 1 (master switch) to enable Auto Draft."
              onChange={(v) => patch({ auto_draft_enabled: v })}
            />
          </div>
          <div data-tour="followup-action-reply">
            <ActionRow
              icon={Send}
              title="Auto Reply (sends automatically)"
              description="AI writes AND sends the follow-up without review. Use with care."
              checked={settings.auto_reply_enabled}
              disabled={!settings.is_enabled}
              disabledHint="Turn on Step 1 (master switch) to enable Auto Reply."
              onChange={(v) => patch({ auto_reply_enabled: v })}
              warning={settings.auto_reply_enabled ? 'Replies will be sent without your review.' : undefined}
            />
          </div>

        </CardContent>
      </Card>

      {/* Lifecycle & how to stop */}
      <Card data-tour="followup-lifecycle" className={!settings.is_enabled ? 'opacity-70' : ''}>

        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-primary" /> Lifecycle & how to stop a tracker
          </CardTitle>
          <CardDescription>
            Every tracker ends one of four ways. Knowing this prevents endless nudges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Reply received</strong> — tracker clears automatically and the email leaves the No Reply Tracker category.</li>
            <li><strong className="text-foreground">Auto-stop after {settings.reminder_max_count} nudges</strong> — if you don't act on the draft and there's still no reply after the maximum reminders, the tracker stops on its own. The email stays in the No Reply Tracker category so you can decide manually.</li>
            <li>
              <strong className="text-foreground">Manual stop via BCC</strong> — send a new email on the thread with one of these BCCs to cancel immediately and move the original message back to the inbox:
              <div className="flex flex-wrap gap-2 mt-1.5">
                {['stop', '0'].map((w) => {
                  const addr = `${w}@${domain}`;
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(addr); toast({ title: 'Copied', description: addr }); }}
                      className="font-mono text-xs px-2 py-1 rounded border bg-muted hover:bg-accent transition-colors"
                      title="Click to copy"
                    >
                      {addr}
                    </button>
                  );
                })}
              </div>
            </li>
            <li><strong className="text-foreground">Re-arm anytime</strong> — sending a fresh email on the thread with a numeric BCC like <code className="font-mono text-xs px-1 py-0.5 rounded bg-muted">2@{domain}</code> starts a brand-new tracker with a fresh due date and a fresh reminder count.</li>
          </ul>
        </CardContent>
      </Card>

      {/* Business hours */}

      <Card data-tour="followup-bh" className={!settings.is_enabled ? 'opacity-70' : ''}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <StepBadge n={3} /> <Clock className="w-4 h-4" /> Business hours
              </CardTitle>
              <CardDescription className="mt-1.5">
                When on, <strong>Auto Draft</strong>, <strong>Auto Reply</strong> and the
                daily auto-audit only run during your local working hours. Outside hours,
                emails are still <em>moved</em> to your No Reply Tracker category — drafts and sends
                wait until business hours resume.
                {settings.is_enabled ? (
                  <span className="block mt-1 text-xs text-muted-foreground">
                    Locked ON while No Reply Tracker is active.
                  </span>
                ) : null}
              </CardDescription>
            </div>
            <Switch
              checked={settings.business_hours_only}
              disabled={saving || settings.is_enabled}
              onCheckedChange={(v) => patch({ business_hours_only: v })}
            />
          </div>
        </CardHeader>
        <CardContent className={`space-y-4 ${!settings.business_hours_only ? 'opacity-70 pointer-events-none' : ''}`}>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5" data-tour="followup-bh-start">
              <Label htmlFor="bh-start">Start (local)</Label>
              <select
                id="bh-start"
                className="w-full h-10 rounded-md border-2 border-[var(--border-strong)] bg-[var(--surface-2)] hover:border-[var(--primary)] focus:border-[hsl(var(--ring))] focus:outline-none focus:ring-2 focus:ring-ring px-3 text-sm text-foreground transition-colors"
                value={settings.business_hours_start}
                onChange={(e) => patch({ business_hours_start: parseInt(e.target.value, 10) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h} disabled={h >= settings.business_hours_end}>{fmtHour(h)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5" data-tour="followup-bh-end">
              <Label htmlFor="bh-end">End (local)</Label>
              <select
                id="bh-end"
                className="w-full h-10 rounded-md border-2 border-[var(--border-strong)] bg-[var(--surface-2)] hover:border-[var(--primary)] focus:border-[hsl(var(--ring))] focus:outline-none focus:ring-2 focus:ring-ring px-3 text-sm text-foreground transition-colors"
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
            <div className="space-y-1.5" data-tour="followup-bh-tz">
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
                  data-tour="followup-bh-usemine"
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

          <div className="space-y-1.5" data-tour="followup-bh-days">
            <Label>Business days</Label>
            <div className="flex flex-wrap gap-2">

              {DAY_LABELS.map((label, idx) => {
                const active = settings.business_days.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? settings.business_days.filter((d) => d !== idx)
                        : [...settings.business_days, idx].sort();
                      patch({ business_days: next });
                    }}
                    className="w-12 h-12 rounded-full text-button transition-colors"
                    style={
                      active
                        ? { background: 'var(--c-blue)', color: '#FFFFFF', border: '1px solid var(--c-blue)' }
                        : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)' }
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Holidays (skip days)</Label>
            <div className="flex gap-2 flex-wrap items-center">
              <Input
                type="date"
                className="w-44"
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const cur = ((settings as any).holidays as string[] | null) || [];
                  if (cur.includes(v)) return;
                  patch({ ...({ holidays: [...cur, v].sort() } as any) });
                  e.currentTarget.value = '';
                }}
              />
              <div className="flex flex-wrap gap-1.5">
                {(((settings as any).holidays as string[] | null) || []).map((d) => (
                  <Badge key={d} variant="secondary" className="gap-1">
                    {d}
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        const cur = ((settings as any).holidays as string[] | null) || [];
                        patch({ ...({ holidays: cur.filter((x) => x !== d) } as any) });
                      }}
                    >×</button>
                  </Badge>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">AI follow-ups won't send on these dates; they'll roll to the next business hour.</p>
          </div>

          <div className="text-xs text-muted-foreground">
            Current window: <strong>{fmtHour(settings.business_hours_start)}</strong> – <strong>{settings.business_hours_end === 24 ? '12:00 AM' : fmtHour(settings.business_hours_end)}</strong>
            {settings.timezone ? <> ({settings.timezone})</> : null}
          </div>
        </CardContent>
      </Card>

      {/* Auto-sync (every 24 hours) */}
      <Card data-tour="followup-audit">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" /> Inbox auto-audit
          </CardTitle>
          <CardDescription>
            InboxIQ automatically scans your <strong>Sent Items</strong> every 24 hours and flags
            any email that hasn't been replied to. Flagged messages are copied into your Outlook
            <code className="font-mono text-xs px-1 mx-1 rounded bg-muted">No-Reply-Tracker</code>
            folder and surfaced in the InboxIQ <strong>No Reply Tracker</strong> category. No drafts
            are written and nothing is sent — pure audit for your review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div data-tour="followup-autosync" className="rounded-lg border p-3 flex items-start justify-between gap-4 bg-muted/30">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 mt-0.5">
                <CalendarClock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  Auto-sync every 24 hours
                  {settings.is_enabled && settings.daily_audit_enabled ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Active</Badge>
                  ) : (
                    <Badge variant="outline">Paused</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  While No Reply Tracker is ON, InboxIQ scans the previous 24 hours of Sent Items
                  every day and flags anything that hasn't been replied to.
                </div>
              </div>
            </div>
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

      <p className="text-xs text-muted-foreground pt-2">
        Background scan runs every 15 min and refreshes automatically each time you open this page.
        {' '}<strong>Auto Draft</strong>, <strong>Auto Reply</strong>, and the daily auto-audit only fire during your business hours
        {settings.timezone ? <> ({settings.timezone})</> : null}.
      </p>
    </div>
  );
}

function FlowStep({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <div className="relative rounded-lg border-2 border-[var(--border-strong)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center gap-2 mb-1">
        <StepBadge n={n} />
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed">{body}</div>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border-2 border-primary text-primary bg-primary/10 shrink-0"
      aria-label={`Step ${n}`}
    >
      {n}
    </span>
  );
}


function ActionRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  disabled,
  disabledHint,
  warning,
  alwaysOn,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledHint?: string;
  warning?: string;
  alwaysOn?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border-2 p-3 bg-[var(--surface-2)]">
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
      {alwaysOn ? (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 shrink-0">
          Always On
        </Badge>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
              </span>
            </TooltipTrigger>
            {disabled && disabledHint && <TooltipContent>{disabledHint}</TooltipContent>}
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );

}

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { PageHero } from '@/components/app/PageHero';
import { BellRing, Loader2, Flag, CheckCircle2, XCircle, AlarmClock, FileEdit, AlertTriangle, Mail, Send, ChevronDown, ChevronRight, Users, List, Settings as SettingsIcon, Circle, Clock } from 'lucide-react';
import { ReportExportMenu } from '@/components/reports/ReportExportMenu';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { format, formatDistanceToNow } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FlaggedEmailSettingsBody } from './FlaggedEmailSettings';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';



interface HistEntry { attempt: number; drafted_at: string; sent_at: string | null; auto_sent: boolean; draft_id?: string | null; }
interface TrackedEmail {
  id: string;
  recipient_address: string | null;
  recipient_name: string | null;
  subject: string | null;
  sent_at: string;
  trigger_type: 'flag' | 'category';
  trigger_detail: any;
  follow_up_at: string | null;
  attempts: number;
  status: 'pending' | 'replied' | 'completed' | 'drafted' | 'draft_ready' | 'sent' | 'queued' | 'cancelled' | 'exhausted' | 'error' | string;
  last_checked_at: string | null;
  last_error: string | null;
  conversation_id: string | null;
  follow_up_history: HistEntry[] | null;
  scheduled_send_at?: string | null;
  queued_reason?: string | null;
  web_link?: string | null;
  graph_message_id?: string | null;
}


type StatusMeta = { label: string; icon: any; variant: 'default' | 'secondary' | 'destructive' | 'outline'; tooltip: string };

const STATUS_META: Record<string, StatusMeta> = {
  pending: { label: 'Waiting for due date', icon: AlarmClock, variant: 'secondary', tooltip: 'Flagged — waiting until your follow-up due date arrives.' },
  replied: { label: 'Checked · recipient responded', icon: CheckCircle2, variant: 'default', tooltip: 'Recipient replied — queue cleared and tracker kept as history.' },
  completed: { label: 'Checked · recipient responded', icon: CheckCircle2, variant: 'default', tooltip: 'Recipient replied — queue cleared and tracker kept as history.' },
  drafted: { label: 'Draft ready', icon: FileEdit, variant: 'default', tooltip: 'AI follow-up draft is ready in Outlook.' },
  draft_ready: { label: 'Draft ready', icon: FileEdit, variant: 'default', tooltip: 'AI follow-up draft is ready in Outlook.' },
  sent: { label: 'Follow-up sent', icon: Send, variant: 'default', tooltip: 'AI sent the scheduled follow-up and is waiting for a recipient reply.' },
  queued: { label: 'Queued (business hours)', icon: AlarmClock, variant: 'outline', tooltip: 'Due date hit outside business hours — will send at the next business-hour window.' },
  cancelled: { label: 'Cancelled by you', icon: XCircle, variant: 'outline', tooltip: 'You cancelled this tracker.' },
  exhausted: { label: 'No response · 3 sent', icon: AlertTriangle, variant: 'destructive', tooltip: 'AI sent all 3 follow-ups and the recipient never replied.' },
  no_response: { label: 'No response · 3 sent', icon: AlertTriangle, variant: 'destructive', tooltip: 'AI sent all 3 follow-ups and the recipient never replied.' },
  error: { label: 'Send error', icon: AlertTriangle, variant: 'destructive', tooltip: 'A send failed. Check the email account connection.' },
};

const FALLBACK_STATUS_META = {
  label: 'Tracking',
  icon: AlarmClock,
  variant: 'outline' as const,
  tooltip: 'This email is being tracked.',
};

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(new Date(d), 'MMM d, yyyy · h:mm a'); } catch { return '—'; }
}

function outlookLink(r: TrackedEmail): string | null {
  // Open the exact message inside the full Outlook on the web shell
  // (left nav + folder list + reading pane). The folder segment must match
  // where the message actually lives, otherwise Outlook drops you on the
  // folder root without the message selected.
  if (r.graph_message_id) {
    const folderHint = String(r.trigger_detail?.folder || '').toLowerCase();
    const folderSeg =
      folderHint === 'sent' ? 'sentitems'
      : folderHint === 'inbox' ? 'inbox'
      // Default: if WE were the sender (we have a recipient_address), it's in Sent Items.
      : (r.recipient_address ? 'sentitems' : 'inbox');
    return `https://outlook.office.com/mail/${folderSeg}/id/${encodeURIComponent(r.graph_message_id)}`;
  }
  if (r.web_link) return r.web_link;
  return null;
}

function dateValue(value: unknown): Date | null {
  if (!value) return null;
  // Graph dueDateTime: { dateTime: "2026-06-29T03:30:00.0000000", timeZone: "UTC" }
  // The dateTime string has no zone suffix, so new Date() interprets it as
  // local time and silently shifts the displayed value. Honor timeZone.
  if (typeof value === 'object' && value !== null && 'dateTime' in value) {
    const obj = value as { dateTime?: unknown; timeZone?: unknown };
    const raw = obj.dateTime;
    if (typeof raw !== 'string') return null;
    const tz = String(obj.timeZone || 'UTC');
    const trimmed = raw.replace(/(\.\d{3})\d+$/, '$1'); // trim sub-ms
    const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
    if (hasZone) {
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (/^utc$/i.test(tz)) {
      const d = new Date(trimmed + 'Z');
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // Best-effort: treat unspecified zone strings as UTC so the display is stable.
    const d = new Date(trimmed + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtAny(value: unknown) {
  const d = dateValue(value);
  return d ? format(d, 'MMM d, yyyy · h:mm a') : '—';
}

function distanceAny(value: unknown) {
  const d = dateValue(value);
  if (!d) return '—';
  try { return formatDistanceToNow(d, { addSuffix: true }); } catch { return '—'; }
}

function addMs(value: unknown, ms: number): Date | null {
  const d = dateValue(value);
  if (!d || !Number.isFinite(ms)) return null;
  return new Date(d.getTime() + ms);
}

function cadenceMs(_r: TrackedEmail): number {
  return 86400000;
}

function scheduleUrgent(value: unknown) {
  const d = dateValue(value);
  if (!d) return false;
  const diff = d.getTime() - Date.now();
  return diff <= 60 * 60 * 1000;
}

function rowStatusMeta(r: TrackedEmail): StatusMeta {
  if (r.status === 'pending' && (r.attempts || 0) > 0) {
    return {
      label: 'Pending reply',
      icon: AlarmClock,
      variant: 'secondary',
      tooltip: 'AI follow-up was sent — waiting for the recipient to reply or for the next send date.',
    };
  }
  return STATUS_META[r.status] || FALLBACK_STATUS_META;
}

function plannedDateFromCurrent(r: TrackedEmail, targetAttempt: number, _intervalsDays: number[]) {
  const currentPendingAttempt = Math.min((r.attempts || 0) + 1, 3);
  const base = dateValue(r.scheduled_send_at || r.follow_up_at);
  if (!base || targetAttempt <= currentPendingAttempt) return base;

  let ms = base.getTime();
  const fallbackGap = cadenceMs(r);
  for (let completedAttempt = currentPendingAttempt; completedAttempt < targetAttempt; completedAttempt += 1) {
    ms += fallbackGap;
  }
  return new Date(ms);
}

function buildSendSchedule(r: TrackedEmail, intervalsDays: number[] = []) {
  const hist = Array.isArray(r.follow_up_history) ? r.follow_up_history : [];
  const byAttempt = new Map<number, HistEntry>();
  hist.forEach((h) => {
    if (typeof h?.attempt === 'number') byAttempt.set(h.attempt, h);
  });

  const firstDue = r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : r.follow_up_at;
  const gap = cadenceMs(r);
  const currentPendingAttempt = Math.min((r.attempts || 0) + 1, 3);

  return [1, 2, 3].map((attempt) => {
    const labelBase = attempt === 1 ? 'Follow-up 1' : `Follow-up ${attempt}`;
    const h = byAttempt.get(attempt);
    if (h?.sent_at) {
      return { attempt, label: labelBase, status: 'Sent', date: h.sent_at };
    }
    if (h?.drafted_at) {
      return { attempt, label: labelBase, status: 'Draft ready', date: h.drafted_at };
    }
    if (r.status === 'queued' && attempt === currentPendingAttempt && r.scheduled_send_at) {
      return { attempt, label: labelBase, status: 'Scheduled', date: r.scheduled_send_at };
    }
    if ((r.status === 'pending' || r.status === 'queued') && attempt === currentPendingAttempt) {
      return { attempt, label: labelBase, status: 'Scheduled', date: r.scheduled_send_at || r.follow_up_at };
    }
    if (attempt > currentPendingAttempt && !['completed', 'replied', 'cancelled', 'exhausted', 'no_response'].includes(r.status)) {
      return { attempt, label: labelBase, status: 'Pending', date: plannedDateFromCurrent(r, attempt, intervalsDays) || addMs(firstDue, gap * (attempt - 1)) };
    }
    return { attempt, label: labelBase, status: '—', date: null };
  });
}

function withTimeout<T>(promise: PromiseLike<T>, ms = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Tracker data is taking too long to respond. Please retry.')), ms);
    Promise.resolve(promise)
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timer));
  });
}

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}



export default function FlaggedEmailTrackerPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TrackedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(todayStr(-90));
  const [to, setTo] = useState<string>(todayStr(0));
  
  const [groupBy, setGroupBy] = useState<'none' | 'recipient'>('recipient');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reminderIntervalsDays, setReminderIntervalsDays] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);





  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoadError(null);
    try {
      const fromDate = new Date(`${from}T00:00:00`);
      const toDate = new Date(`${to}T23:59:59`);
      const safeFrom = Number.isNaN(fromDate.getTime()) ? new Date(`${todayStr(-90)}T00:00:00`).toISOString() : fromDate.toISOString();
      const safeTo = Number.isNaN(toDate.getTime()) ? new Date(`${todayStr(0)}T23:59:59`).toISOString() : toDate.toISOString();

      const { data, error } = await withTimeout(
        supabase
          .from('tracked_emails' as any)
          .select('*')
          .eq('user_id', user.id)
          .or(`and(sent_at.gte.${safeFrom},sent_at.lte.${safeTo}),and(updated_at.gte.${safeFrom},updated_at.lte.${safeTo})`)
          .order('updated_at', { ascending: false })
          .order('sent_at', { ascending: false })
          .limit(500),
      );
      if (error) {
        setLoadError(error.message || 'Could not load tracked emails.');
        toast.error('Could not load tracked emails');
      } else {
        setRows((data as any) || []);
      }
    } catch (error: any) {
      setLoadError(error?.message || 'Could not load tracked emails.');
      toast.error('Could not load tracked emails');
    } finally {
      setLoading(false);
    }
  }, [user, from, to]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('follow_up_settings' as any)
      .select('reminder_intervals_days')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const vals = Array.isArray((data as any)?.reminder_intervals_days)
          ? (data as any).reminder_intervals_days.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
          : [];
        setReminderIntervalsDays(vals);
      });
  }, [user?.id]);

  // Render cached rows immediately; run the Graph sweep in the background and
  // refresh when it finishes. Avoids a long "Loading…" state when the Graph
  // ingest is slow (e.g., large mailbox or per-row deletion sweep).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    // 1) Immediate load from DB so the page is never blank.
    load();
    // 2) Background ingest + reload. Never let a slow/failed function block rendering.
    const runIngest = async () => {
      try { await supabase.functions.invoke('flag-tracker-ingest', { body: {} }); } catch {/* silent */}
      if (!cancelled) await load();
    };
    runIngest();
    const interval = setInterval(runIngest, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, from, to]);

  const stats = useMemo(() => {
    const now = Date.now();
    const total = rows.length;
    const pending = rows.filter(r => r.status === 'pending').length;
    const replied = rows.filter(r => r.status === 'replied' || r.status === 'completed').length;
    const drafted = rows.filter(r => r.status === 'drafted').length;
    const queued = rows.filter(r => r.status === 'queued').length;
    const missed = rows.filter(r => r.status === 'exhausted' || r.status === 'no_response' || (r.status === 'pending' && new Date(r.follow_up_at).getTime() < now && (r.attempts || 0) >= 3)).length;
    const followUpsSent = rows.reduce((sum, r) => sum + (r.attempts || 0), 0);
    return { total, pending, queued, replied, drafted, missed, followUpsSent };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.recipient_address ?? '',
        r.recipient_name ?? '',
        r.subject ?? '',
        (r as any).body_preview ?? '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);


  const exportRows = useMemo(() => rows.map((r) => {
    const flagDue = r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : r.follow_up_at;
    const schedule = buildSendSchedule(r, reminderIntervalsDays)
      .map((s) => `${s.label} — ${s.status}${s.date ? ` · ${fmtAny(s.date)}` : ''}`)
      .join('\n');
    const recipient = r.recipient_name
      ? `${r.recipient_name} <${r.recipient_address || ''}>`
      : (r.recipient_address || '');
    return {
      'Subject': r.subject || '(no subject)',
      'To (recipient)': recipient,
      'User sent': fmt(r.sent_at),
      'Flag due': fmtAny(flagDue || r.follow_up_at),
      'Follow-up schedule': schedule || '—',
      'Status': r.status,
    };
  }), [rows, reminderIntervalsDays]);

  const emailReport = async () => {
    if (!user) return;
    const { error } = await supabase.functions.invoke('flag-report-email', {
      body: { from, to, range_label: `${from} → ${to}` },
    });
    if (error) throw error;
  };

  const cancelRow = useCallback(async (id: string) => {
    const prev = rows;
    // Remove from view immediately — user wants it out of the queue entirely.
    setRows(rs => rs.filter(r => r.id !== id));
    // Edge function clears the Outlook flag AND deletes the tracker row so
    // (a) it disappears from the report, (b) the AI follow-up queue stops,
    // and (c) the flag in Outlook is removed so the next ingest won't re-add it.
    const { data, error } = await supabase.functions.invoke('flag-tracker-cancel', {
      body: { id },
    });
    if (error || (data && (data as any).error)) {
      setRows(prev);
      toast.error('Could not cancel — try again');
    } else if ((data as any)?.flag_cleared === false && (data as any)?.flag_error) {
      toast.success('Removed from queue — flag in Outlook could not be cleared automatically');
    } else {
      toast.success('Removed from queue and unflagged in Outlook');
    }
  }, [rows]);

  return (
    <div className="page-shell" data-print-title="Flagged Email Tracker">
      <div className="page-shell-sticky print:hidden">
        <PageHero
          eyebrow="AI Intelligence"
          title="Flagged Email Tracker"
          description="Live view of every email you've flagged in Outlook. If auto-send is on, AI sends a polite follow-up when the flag's due date passes with no reply — up to 3 attempts. Cancel any row before its next send."
          accent="purple"
          icon={<BellRing className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in space-y-6">
        {/* Collapsible settings panel — full tracker settings inline */}
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Card className="print:hidden border-primary/30">
            <CollapsibleTrigger asChild>
              <button type="button" className="w-full text-left">
                <CardHeader className="flex flex-row items-center justify-between gap-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <SettingsIcon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        Tracker settings
                        <Badge variant="outline" className="text-[10px]">Tracker · auto-send · schedule · tone</Badge>
                      </CardTitle>
                      <CardDescription>
                        Turn the tracker on/off, choose whether AI auto-sends the follow-up, set business hours, and tune your AI writing tone.
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform shrink-0 ${settingsOpen ? 'rotate-180' : ''}`} />
                </CardHeader>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 border-t">
                <div className="pt-5">
                  <FlaggedEmailSettingsBody />
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>


        {/* Date range + export controls */}
        <Card className="print:hidden">
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </div>
            <div className="flex gap-2 ml-auto flex-wrap">
              <Button variant="outline" size="sm" onClick={() => { setFrom(todayStr(-7)); setTo(todayStr(0)); }}>Last 7 days</Button>
              <Button variant="outline" size="sm" onClick={() => { setFrom(todayStr(-30)); setTo(todayStr(0)); }}>Last 30 days</Button>
              <Button variant="outline" size="sm" onClick={() => { setFrom(todayStr(-90)); setTo(todayStr(0)); }}>Last 90 days</Button>
              <ReportExportMenu
                fileName={`flagged-email-report_${from}_to_${to}`}
                sheetName="Flagged Emails"
                title="Flagged Email Tracker"
                subtitle={`Range: ${from} → ${to}`}
                rows={exportRows}
                onEmail={emailReport}
                emailRecipientLabel={user?.email}
              />
            </div>
          </CardContent>
        </Card>

        {/* 90-day retention notice */}
        <div className="rounded-md border border-amber-300/50 bg-amber-50/60 dark:bg-amber-500/10 dark:border-amber-500/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>Retention:</strong> Emails shown here are kept for up to <strong>90 days</strong>. After 90 days they are removed from the tracker — <em>unless</em> they have an active follow-up scheduled, in which case they remain until the schedule completes or a reply arrives.
          </span>
        </div>

        {/* Live stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard label="Flagged" value={stats.total} icon={Flag} tone="amber" />
          <StatCard label="Waiting" value={stats.pending} icon={AlarmClock} tone="slate" />
          <StatCard label="Queued (off-hours)" value={stats.queued} icon={AlarmClock} tone="indigo" />
          <StatCard label="Replied" value={stats.replied} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Follow-ups sent" value={stats.followUpsSent} icon={Send} tone="blue" />
          <StatCard label="No response (3/3)" value={stats.missed} icon={AlertTriangle} tone="red" />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Tracked emails queue</CardTitle>
              <CardDescription>Auto-syncs with Microsoft 365 on every open and every minute. Up to 3 polite AI follow-ups per email, then marked as no response.</CardDescription>
            </div>
            <div className="flex gap-1 print:hidden">
              <Button variant={groupBy === 'recipient' ? 'default' : 'outline'} size="sm" onClick={() => setGroupBy('recipient')}>
                <Users className="w-4 h-4 mr-1.5" /> Group by recipient
              </Button>
              <Button variant={groupBy === 'none' ? 'default' : 'outline'} size="sm" onClick={() => setGroupBy('none')}>
                <List className="w-4 h-4 mr-1.5" /> Flat list
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 print:hidden">
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search the queue by recipient, email, or subject…"
                  className="pl-9 pr-9"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1.5 py-0.5 rounded"
                    aria-label="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
              {search && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {filteredRows.length} of {rows.length} match “{search}”
                </p>
              )}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : loadError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm">
                <div className="font-medium text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Could not load tracker data
                </div>
                <p className="mt-1 text-muted-foreground">{loadError}</p>
                <Button className="mt-3" variant="outline" size="sm" onClick={load}>Retry</Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No flagged emails in this range. Flag a sent message in Outlook with a due date — it'll appear here automatically.
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No emails in the queue match “{search}”. Try a different recipient or subject keyword.
              </div>
            ) : groupBy === 'recipient' ? (
              <RecipientGroups rows={filteredRows} expanded={expanded} setExpanded={setExpanded} onCancel={cancelRow} reminderIntervalsDays={reminderIntervalsDays} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>To (recipient)</TableHead>
                      <TableHead>User sent</TableHead>
                      <TableHead>Flag due</TableHead>
                      <TableHead>Follow-up schedule</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((r) => <EmailRow key={r.id} r={r} onCancel={cancelRow} reminderIntervalsDays={reminderIntervalsDays} />)}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>

        </Card>
      </div>
    </div>
  );
}

function EmailRow({ r, onCancel, reminderIntervalsDays = [] }: { r: TrackedEmail; onCancel: (id: string) => void; reminderIntervalsDays?: number[] }) {
  const meta = rowStatusMeta(r);
  const Icon = meta.icon;
  const flagDue = r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : r.follow_up_at;
  const dueDate = dateValue(flagDue || r.follow_up_at);
  const overdue = r.status === 'pending' && !!dueDate && dueDate.getTime() < Date.now();
  const dueSoon = !!dueDate && dueDate.getTime() > Date.now() && dueDate.getTime() - Date.now() <= 60 * 60 * 1000;
  const dueUrgent = overdue || dueSoon;
  const hist = Array.isArray(r.follow_up_history) ? r.follow_up_history : [];
  const sendSchedule = buildSendSchedule(r, reminderIntervalsDays);
  const canCancel = r.status === 'pending' || r.status === 'queued' || r.status === 'drafted' || r.status === 'draft_ready';
  return (
    <TableRow>
      <TableCell className="max-w-sm">
        {(() => {
          const href = outlookLink(r);
          const subject = r.subject || '(no subject)';
          return href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline underline-offset-2 break-words"
              title={`Open in Outlook: ${subject}`}
            >
              {subject}
            </a>
          ) : (
            <div className="font-medium" title={subject}>{subject}</div>
          );
        })()}
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Flag className="w-3 h-3 text-amber-500" /> Flag trigger · click subject to open in Outlook
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-start gap-1.5 text-sm">
          <Mail className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
          <div className="break-words">
            {r.recipient_name && <div className="font-medium">{r.recipient_name}</div>}
            <div className="text-xs text-muted-foreground break-all">{r.recipient_address || '—'}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        <div className="font-medium">{fmt(r.sent_at)}</div>
        <div className="text-[10px] text-muted-foreground">user sent</div>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        <div className={dueUrgent ? 'text-red-600 font-medium' : ''}>{fmtAny(flagDue || r.follow_up_at)}</div>
        <div className={`text-[10px] ${dueUrgent ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
          {distanceAny(flagDue || r.follow_up_at)}
        </div>
      </TableCell>
      <TableCell className="text-xs min-w-[260px]">
        <div className="space-y-1.5">
          {sendSchedule.map((send) => {
            const urgent = send.status === 'Scheduled' && scheduleUrgent(send.date);
            const isSent = send.status === 'Sent';
            const isScheduled = send.status === 'Scheduled' || send.status === 'Queued';
            const isPending = send.status === 'Pending' || send.status === 'Draft ready';
            const StatusIcon = isSent ? CheckCircle2 : isScheduled ? Circle : isPending ? Clock : null;
            const iconColor = isSent
              ? 'text-emerald-600'
              : isScheduled
                ? 'text-orange-500'
                : isPending
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground';
            const statusColor = urgent
              ? 'text-red-600 font-semibold'
              : isSent
                ? 'text-emerald-700 font-medium'
                : isScheduled
                  ? 'text-orange-600 font-medium'
                  : 'text-muted-foreground';
            return (
              <div key={send.attempt} className="flex items-start justify-between gap-3 rounded-md bg-muted/30 px-2 py-1">
                <div className="font-medium whitespace-nowrap flex items-center gap-1.5">
                  {StatusIcon && <StatusIcon className={`w-3.5 h-3.5 ${iconColor} ${isScheduled ? 'fill-orange-100' : ''}`} />}
                  {send.label}
                </div>
                <div className="text-right min-w-0">
                  <div className={statusColor}>{send.status}</div>
                  <div className={urgent ? 'text-red-600 font-medium whitespace-nowrap' : 'text-muted-foreground whitespace-nowrap'}>{send.date ? fmtAny(send.date) : '—'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1.5">
          <Badge
            variant={meta.variant}
            className={`gap-1 ${
              r.status === 'completed' || r.status === 'replied'
                ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-500/30'
                : r.status === 'no_response' || r.status === 'exhausted'
                  ? 'bg-red-500/15 text-red-700 hover:bg-red-500/20 border-red-500/30'
                  : ''
            }`}
          >
            <Icon className="w-3 h-3" /> {meta.label}
          </Badge>
          {canCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10 print:hidden"
              onClick={() => onCancel(r.id)}
              title="Cancel this follow-up — no further AI sends for this email"
            >
              <XCircle className="w-3 h-3 mr-1" /> Cancel
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function RecipientGroups({
  rows,
  expanded,
  setExpanded,
  onCancel,
  reminderIntervalsDays,
}: {
  rows: TrackedEmail[];
  expanded: Record<string, boolean>;
  setExpanded: (e: Record<string, boolean>) => void;
  onCancel: (id: string) => void;
  reminderIntervalsDays?: number[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; email: string; items: TrackedEmail[] }>();
    for (const r of rows) {
      const email = (r.recipient_address || 'unknown').toLowerCase();
      const cur = map.get(email) || { key: email, name: r.recipient_name || '', email: r.recipient_address || 'unknown', items: [] };
      cur.items.push(r);
      if (!cur.name && r.recipient_name) cur.name = r.recipient_name;
      map.set(email, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [rows]);

  const toggle = (key: string) => setExpanded({ ...expanded, [key]: !expanded[key] });

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const open = expanded[g.key] ?? groups.length <= 3;
        const pending = g.items.filter((r) => r.status === 'pending').length;
        const replied = g.items.filter((r) => r.status === 'replied' || r.status === 'completed').length;
        const missed = g.items.filter((r) => r.status === 'exhausted' || r.status === 'no_response').length;
        return (
          <div key={g.key} className="rounded-lg border bg-card">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              className="w-full flex items-center gap-3 p-3 hover:bg-secondary/30 transition-colors text-left"
            >
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <Mail className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{g.name || g.email}</div>
                {g.name && <div className="text-xs text-muted-foreground truncate">{g.email}</div>}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Badge variant="secondary" className="text-xs">{g.items.length} email{g.items.length === 1 ? '' : 's'}</Badge>
                {pending > 0 && <Badge variant="outline" className="text-xs">{pending} pending</Badge>}
                {replied > 0 && <Badge className="text-xs bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-500/30">{replied} replied</Badge>}
                {missed > 0 && <Badge variant="destructive" className="text-xs">{missed} no response</Badge>}
              </div>
            </button>
            {open && (
              <div className="border-t overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>User sent</TableHead>
                      <TableHead>Flag due</TableHead>
                      <TableHead>Follow-up schedule</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map((r) => <EmailRow key={r.id} r={r} onCancel={onCancel} reminderIntervalsDays={reminderIntervalsDays} />)}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: 'amber' | 'slate' | 'emerald' | 'blue' | 'red' | 'indigo' }) {
  const tones: Record<string, string> = {
    amber: 'text-amber-600 bg-amber-500/10',
    slate: 'text-slate-600 bg-slate-500/10',
    emerald: 'text-emerald-600 bg-emerald-500/10',
    blue: 'text-blue-600 bg-blue-500/10',
    red: 'text-red-600 bg-red-500/10',
    indigo: 'text-indigo-600 bg-indigo-500/10',
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

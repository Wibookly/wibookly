import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { PageHero } from '@/components/app/PageHero';
import { BellRing, Loader2, Flag, CheckCircle2, XCircle, AlarmClock, FileEdit, AlertTriangle, Mail, Send, ChevronDown, ChevronRight, Users, List, Settings as SettingsIcon } from 'lucide-react';
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



interface HistEntry { attempt: number; drafted_at: string; sent_at: string | null; auto_sent: boolean; }
interface TrackedEmail {
  id: string;
  recipient_address: string | null;
  recipient_name: string | null;
  subject: string | null;
  sent_at: string;
  trigger_type: 'flag' | 'category';
  trigger_detail: any;
  follow_up_at: string;
  attempts: number;
  status: 'pending' | 'replied' | 'completed' | 'drafted' | 'queued' | 'cancelled' | 'exhausted' | 'error';
  last_checked_at: string | null;
  last_error: string | null;
  conversation_id: string | null;
  follow_up_history: HistEntry[] | null;
  scheduled_send_at?: string | null;
  queued_reason?: string | null;
}

interface TrackerSettings {
  id: string;
  is_enabled: boolean;
  auto_reply_enabled: boolean;
  business_hours_only: boolean;
  business_hours_start: number;
  business_hours_end: number;
  business_days: number[];
  timezone: string | null;
}

const STATUS_META: Record<TrackedEmail['status'], { label: string; icon: any; variant: 'default' | 'secondary' | 'destructive' | 'outline'; tooltip: string }> = {
  pending: { label: 'Waiting for due date', icon: AlarmClock, variant: 'secondary', tooltip: 'Flagged — waiting until your follow-up due date arrives.' },
  replied: { label: 'Completed · recipient replied', icon: CheckCircle2, variant: 'default', tooltip: 'Recipient replied — queue cleared and tracker completed.' },
  completed: { label: 'Completed · recipient replied', icon: CheckCircle2, variant: 'default', tooltip: 'Recipient replied — queue cleared and tracker completed.' },
  drafted: { label: 'Draft ready', icon: FileEdit, variant: 'default', tooltip: 'AI follow-up draft is ready in Outlook.' },
  queued: { label: 'Queued (business hours)', icon: AlarmClock, variant: 'outline', tooltip: 'Due date hit outside business hours — will send at the next business-hour window.' },
  cancelled: { label: 'Cancelled by you', icon: XCircle, variant: 'outline', tooltip: 'You unflagged the email or cancelled the follow-up.' },
  exhausted: { label: 'Max attempts (3/3)', icon: AlertTriangle, variant: 'destructive', tooltip: 'Sent 3 follow-ups with no reply — tracker closed.' },
  error: { label: 'Send error', icon: AlertTriangle, variant: 'destructive', tooltip: 'A send failed. Check the email account connection.' },
};

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(new Date(d), 'MMM d, yyyy · h:mm a'); } catch { return '—'; }
}

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:00 ${ampm}`;
}

function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
  catch { return 'America/New_York'; }
}

export default function FlaggedEmailTrackerPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TrackedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState<string>(todayStr(-30));
  const [to, setTo] = useState<string>(todayStr(0));
  
  const [groupBy, setGroupBy] = useState<'none' | 'recipient'>('recipient');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);


  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('tracked_emails' as any)
      .select('*')
      .eq('user_id', user.id)
      .gte('sent_at', new Date(from).toISOString())
      .lte('sent_at', new Date(`${to}T23:59:59`).toISOString())
      .order('sent_at', { ascending: false })
      .limit(500);
    if (error) { toast.error('Could not load tracked emails'); }
    else { setRows((data as any) || []); }
    setLoading(false);
  }, [user, from, to]);

  const loadSettings = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('follow_up_settings' as any)
      .select('id,is_enabled,auto_reply_enabled,business_hours_only,business_hours_start,business_hours_end,business_days,timezone,updated_at')
      .eq('user_id', user.id)
      .order('is_enabled', { ascending: false })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    setSettings((data as any) || null);
  }, [user]);

  const patchSettings = async (updates: Partial<TrackerSettings>) => {
    if (!settings) return;
    setSavingSettings(true);
    const prev = settings;
    const next = { ...settings, ...updates };
    setSettings(next);
    const { error } = await supabase
      .from('follow_up_settings' as any)
      .update(updates as any)
      .eq('id', settings.id);
    if (error) {
      setSettings(prev);
      toast.error('Could not save business-hours settings');
    } else {
      toast.success('Business-hours settings saved');
    }
    setSavingSettings(false);
  };

  // Pull current data + trigger live scan on every open, then refresh every 60s
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    (async () => {
      try { await supabase.functions.invoke('flag-tracker-ingest', { body: {} }); } catch {/* silent */}
      await loadSettings();
      await load();
    })();
    const interval = setInterval(async () => {
      try { await supabase.functions.invoke('flag-tracker-ingest', { body: {} }); } catch {/* silent */}
      await load();
    }, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, from, to]);

  const stats = useMemo(() => {
    const now = Date.now();
    const total = rows.length;
    const pending = rows.filter(r => r.status === 'pending').length;
    const replied = rows.filter(r => r.status === 'replied' || r.status === 'completed').length;
    const drafted = rows.filter(r => r.status === 'drafted').length;
    const queued = rows.filter(r => r.status === 'queued').length;
    const missed = rows.filter(r => r.status === 'exhausted' || (r.status === 'pending' && new Date(r.follow_up_at).getTime() < now && (r.attempts || 0) >= 3)).length;
    const followUpsSent = rows.reduce((sum, r) => sum + (r.attempts || 0), 0);
    return { total, pending, queued, replied, drafted, missed, followUpsSent };
  }, [rows]);

  const exportRows = useMemo(() => rows.map((r) => {
    const hist = Array.isArray(r.follow_up_history) ? r.follow_up_history : [];
    const lastSent = hist.filter(h => h.sent_at).map(h => h.sent_at).pop() || '';
    const flagDue = r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : r.follow_up_at;
    return {
      Subject: r.subject || '',
      'Recipient Name': r.recipient_name || '',
      'Recipient Email': r.recipient_address || '',
      Sent: r.sent_at,
      'Flag Due': flagDue,
      'Follow-up Due': r.follow_up_at,
      'Next Send': r.scheduled_send_at || '',
      'Follow-ups Sent': `${r.attempts || 0}/3`,
      'Last AI Send': lastSent,
      Status: r.status,
    };
  }), [rows]);

  const emailReport = async () => {
    if (!user) return;
    const { error } = await supabase.functions.invoke('flag-report-email', {
      body: { from, to, range_label: `${from} → ${to}` },
    });
    if (error) throw error;
  };

  return (
    <div className="page-shell">
      <div className="page-shell-sticky print:hidden">
        <PageHero
          eyebrow="AI Intelligence Report"
          title="Flagged Email Tracker Report"
          description="Live view of every email you've flagged in Outlook — pulls fresh data from Microsoft 365 on every open and every minute."
          accent="green"
          icon={<BellRing className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in space-y-6">
        {settings && (
          <Card className="print:hidden border-primary/30">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlarmClock className="w-4 h-4 text-primary" /> Auto-send schedule
                  {settings.business_hours_only ? <Badge variant="secondary">Business-hours guard on</Badge> : <Badge variant="outline">Anytime sending</Badge>}
                </CardTitle>
                <CardDescription>
                  When Auto-send is on, queued follow-ups send only inside this window. Turn this off if you want due follow-ups to send immediately at any hour.
                </CardDescription>
              </div>
              <Switch
                checked={settings.business_hours_only}
                disabled={savingSettings}
                onCheckedChange={(v) => patchSettings({ business_hours_only: v })}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`grid md:grid-cols-3 gap-3 ${!settings.business_hours_only ? 'opacity-60' : ''}`}>
                <div className="space-y-1.5">
                  <Label>Start</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={settings.business_hours_start}
                    disabled={!settings.business_hours_only || savingSettings}
                    onChange={(e) => patchSettings({ business_hours_start: parseInt(e.target.value, 10) })}
                  >
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h} disabled={h >= settings.business_hours_end}>{fmtHour(h)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>End</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={settings.business_hours_end}
                    disabled={!settings.business_hours_only || savingSettings}
                    onChange={(e) => patchSettings({ business_hours_end: parseInt(e.target.value, 10) })}
                  >
                    {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h} disabled={h <= settings.business_hours_start}>{h === 24 ? '12:00 AM (next day)' : fmtHour(h)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Timezone</Label>
                  <div className="flex gap-2">
                    <Input
                      value={settings.timezone || ''}
                      disabled={!settings.business_hours_only || savingSettings}
                      placeholder="America/New_York"
                      onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                      onBlur={() => patchSettings({ timezone: settings.timezone || browserTimezone() })}
                    />
                    <Button variant="outline" size="sm" disabled={!settings.business_hours_only || savingSettings} onClick={() => patchSettings({ timezone: browserTimezone() })}>Use mine</Button>
                  </div>
                </div>
              </div>
              <div className={`${!settings.business_hours_only ? 'opacity-60' : ''}`}>
                <Label>Business days</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {DAY_LABELS.map((label, idx) => {
                    const active = (settings.business_days || []).includes(idx);
                    return (
                      <Button
                        key={label}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={!settings.business_hours_only || savingSettings}
                        onClick={() => {
                          const days = active
                            ? (settings.business_days || []).filter((d) => d !== idx)
                            : [...(settings.business_days || []), idx].sort();
                          patchSettings({ business_days: days });
                        }}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Current rule: {settings.business_hours_only
                  ? `send Monday–Friday style windows you select (${fmtHour(settings.business_hours_start)}–${settings.business_hours_end === 24 ? '12:00 AM' : fmtHour(settings.business_hours_end)}${settings.timezone ? `, ${settings.timezone}` : ''}). Weekends/off-hours stay queued.`
                  : 'send automatically as soon as the due date arrives and no recipient reply is found.'}
              </p>
            </CardContent>
          </Card>
        )}

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
                rows={exportRows}
                onEmail={emailReport}
                emailRecipientLabel={user?.email}
              />
            </div>
          </CardContent>
        </Card>

        {/* Live stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard label="Flagged" value={stats.total} icon={Flag} tone="amber" />
          <StatCard label="Waiting" value={stats.pending} icon={AlarmClock} tone="slate" />
          <StatCard label="Queued (off-hours)" value={stats.queued} icon={AlarmClock} tone="indigo" />
          <StatCard label="Replied" value={stats.replied} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Follow-ups sent" value={stats.followUpsSent} icon={Send} tone="blue" />
          <StatCard label="Missed (3/3)" value={stats.missed} icon={AlertTriangle} tone="red" />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Tracked emails</CardTitle>
              <CardDescription>Auto-syncs with Microsoft 365 on every open and every minute. Up to 3 polite AI follow-ups per email, then marked as missed.</CardDescription>
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
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No flagged emails in this range. Flag a sent message in Outlook with a due date — it'll appear here automatically.
              </div>
            ) : groupBy === 'recipient' ? (
              <RecipientGroups rows={rows} expanded={expanded} setExpanded={setExpanded} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>To (recipient)</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Flag / Due</TableHead>
                      <TableHead>Follow-up due</TableHead>
                      <TableHead>Next send</TableHead>
                      <TableHead className="text-center">Follow-ups (max 3)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => <EmailRow key={r.id} r={r} />)}
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

function EmailRow({ r }: { r: TrackedEmail }) {
  const meta = STATUS_META[r.status];
  const Icon = meta.icon;
  const flagDue = r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : null;
  const overdue = r.status === 'pending' && new Date(r.follow_up_at).getTime() < Date.now();
  const hist = Array.isArray(r.follow_up_history) ? r.follow_up_history : [];
  return (
    <TableRow>
      <TableCell className="max-w-sm">
        <div className="font-medium" title={r.subject || ''}>{r.subject || '(no subject)'}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Flag className="w-3 h-3 text-amber-500" /> Flag trigger
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
      <TableCell className="text-xs whitespace-nowrap">{fmt(r.sent_at)}</TableCell>
      <TableCell className="text-xs whitespace-nowrap">{flagDue ? fmt(flagDue) : '—'}</TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        <div>{fmt(r.follow_up_at)}</div>
        <div className={`text-[10px] ${overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
          {formatDistanceToNow(new Date(r.follow_up_at), { addSuffix: true })}
        </div>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {r.scheduled_send_at ? (
          <div>
            <div className="text-indigo-600 font-medium">{fmt(r.scheduled_send_at)}</div>
            <div className="text-[10px] text-muted-foreground">queued · business hours</div>
          </div>
        ) : '—'}
      </TableCell>
      <TableCell className="text-center">
        <div className="font-medium">{r.attempts || 0}/3</div>
        {hist.length > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
            {hist.map((h, i) => (
              <div key={i} title={h.sent_at ? `Sent by AI` : 'Drafted'}>
                #{h.attempt}: {format(new Date(h.sent_at || h.drafted_at), 'MMM d, h:mm a')}
                {h.sent_at ? ' ✓' : ' (draft)'}
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={meta.variant} className="gap-1">
          <Icon className="w-3 h-3" /> {meta.label}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

function RecipientGroups({
  rows,
  expanded,
  setExpanded,
}: {
  rows: TrackedEmail[];
  expanded: Record<string, boolean>;
  setExpanded: (e: Record<string, boolean>) => void;
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
        const replied = g.items.filter((r) => r.status === 'replied').length;
        const missed = g.items.filter((r) => r.status === 'exhausted').length;
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
                {missed > 0 && <Badge variant="destructive" className="text-xs">{missed} missed</Badge>}
              </div>
            </button>
            {open && (
              <div className="border-t overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Flag / Due</TableHead>
                      <TableHead>Follow-up due</TableHead>
                      <TableHead>Next send</TableHead>
                      <TableHead className="text-center">Follow-ups (max 3)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map((r) => <EmailRow key={r.id} r={r} />)}
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

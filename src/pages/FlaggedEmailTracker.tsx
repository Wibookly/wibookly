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

  // Pull current data + trigger live scan on every open, then refresh every 60s
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    (async () => {
      try { await supabase.functions.invoke('flag-tracker-ingest', { body: {} }); } catch {/* silent */}
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
    <div className="page-shell">
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
              <RecipientGroups rows={rows} expanded={expanded} setExpanded={setExpanded} onCancel={cancelRow} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>To (recipient)</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Flag due</TableHead>
                      <TableHead>Next send</TableHead>
                      <TableHead className="text-center">Follow-ups (max 3)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => <EmailRow key={r.id} r={r} onCancel={cancelRow} />)}
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

function EmailRow({ r, onCancel }: { r: TrackedEmail; onCancel: (id: string) => void }) {
  const meta = STATUS_META[r.status];
  const Icon = meta.icon;
  const flagDue = r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : null;
  const overdue = r.status === 'pending' && new Date(r.follow_up_at).getTime() < Date.now();
  const hist = Array.isArray(r.follow_up_history) ? r.follow_up_history : [];
  const canCancel = r.status === 'pending' || r.status === 'queued' || r.status === 'drafted';
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
      <TableCell className="text-xs whitespace-nowrap">
        <div>{flagDue ? fmt(flagDue) : fmt(r.follow_up_at)}</div>
        <div className={`text-[10px] ${overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
          {formatDistanceToNow(new Date(flagDue || r.follow_up_at), { addSuffix: true })}
        </div>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {r.scheduled_send_at ? (
          <div>
            <div className="text-indigo-600 font-medium">{fmt(r.scheduled_send_at)}</div>
            <div className="text-[10px] text-muted-foreground">queued · business hours</div>
          </div>
        ) : r.status === 'pending' ? (
          <div>
            <div className="font-medium">{fmt(r.follow_up_at)}</div>
            <div className="text-[10px] text-muted-foreground">next follow-up</div>
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
        <div className="flex flex-col items-start gap-1.5">
          <Badge variant={meta.variant} className="gap-1">
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
}: {
  rows: TrackedEmail[];
  expanded: Record<string, boolean>;
  setExpanded: (e: Record<string, boolean>) => void;
  onCancel: (id: string) => void;
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
                      <TableHead>Flag due</TableHead>
                      <TableHead>Next send</TableHead>
                      <TableHead className="text-center">Follow-ups (max 3)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map((r) => <EmailRow key={r.id} r={r} onCancel={onCancel} />)}
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

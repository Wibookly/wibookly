import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { PageHero } from '@/components/app/PageHero';
import { BellRing, Loader2, RefreshCw, Flag, Tag as TagIcon, CheckCircle2, XCircle, AlarmClock, FileEdit, AlertTriangle, Mail, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

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
  status: 'pending' | 'replied' | 'drafted' | 'cancelled' | 'exhausted' | 'error';
  last_checked_at: string | null;
  last_error: string | null;
  conversation_id: string | null;
}

const STATUS_META: Record<TrackedEmail['status'], { label: string; icon: any; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', icon: AlarmClock, variant: 'secondary' },
  replied: { label: 'Replied', icon: CheckCircle2, variant: 'default' },
  drafted: { label: 'Follow-up drafted', icon: FileEdit, variant: 'default' },
  cancelled: { label: 'Cancelled', icon: XCircle, variant: 'outline' },
  exhausted: { label: 'Missed (2/2 sent)', icon: AlertTriangle, variant: 'destructive' },
  error: { label: 'Error', icon: AlertTriangle, variant: 'destructive' },
};

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(new Date(d), 'MMM d, yyyy · h:mm a'); } catch { return '—'; }
}

export default function FlaggedEmailTrackerPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TrackedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('tracked_emails' as any)
      .select('*')
      .eq('user_id', user.id)
      .order('sent_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('[tracked_emails]', error);
      toast.error('Could not load tracked emails');
    } else {
      setRows((data as any) || []);
    }
    setLoading(false);
  }, [user]);

  // Auto-pull current data every time page opens, then refresh every 60s
  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(() => { load(); }, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  // Auto-trigger Outlook scan on open so numbers are current
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        await supabase.functions.invoke('flag-tracker-ingest', { body: {} });
        await load();
      } catch (e) {
        // silent — manual scan button is always available
        console.warn('[auto-scan]', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const runScan = async () => {
    setScanning(true);
    try {
      const { error } = await supabase.functions.invoke('flag-tracker-ingest', { body: {} });
      if (error) throw error;
      toast.success('Scanned Outlook for flagged sent emails');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const stats = useMemo(() => {
    const now = Date.now();
    const total = rows.length;
    const pending = rows.filter(r => r.status === 'pending').length;
    const replied = rows.filter(r => r.status === 'replied').length;
    const drafted = rows.filter(r => r.status === 'drafted').length;
    const missed = rows.filter(r => r.status === 'exhausted' || (r.status === 'pending' && new Date(r.follow_up_at).getTime() < now)).length;
    const followUpsSent = rows.reduce((sum, r) => sum + (r.attempts || 0), 0);
    return { total, pending, replied, drafted, missed, followUpsSent };
  }, [rows]);

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Reports"
          title="Flagged Email Tracker"
          description="Flag a sent email in Outlook and set a due date. If no reply arrives, InboxIQ drafts a polite follow-up in the same thread — up to 2 attempts, never auto-sent."
          accent="green"
          icon={<BellRing className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in space-y-6">
        {/* Live stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Flagged" value={stats.total} icon={Flag} tone="amber" />
          <StatCard label="Pending" value={stats.pending} icon={AlarmClock} tone="slate" />
          <StatCard label="Replied" value={stats.replied} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Follow-ups sent" value={stats.followUpsSent} icon={Send} tone="blue" />
          <StatCard label="Missed deadline" value={stats.missed} icon={AlertTriangle} tone="red" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to track an email</CardTitle>
            <CardDescription>Two zero-config gestures — both are private to your mailbox; recipients never see them.</CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium mb-1"><Flag className="w-4 h-4 text-amber-500" /> Flag + due date (preferred)</div>
              <p className="text-muted-foreground">In Outlook, flag the email you just sent and pick a due date. We'll draft a follow-up on that date if no reply comes.</p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium mb-1"><TagIcon className="w-4 h-4 text-emerald-500" /> Category fallback</div>
              <p className="text-muted-foreground">Apply a category named <code className="px-1 rounded bg-muted">FollowUp</code> or <code className="px-1 rounded bg-muted">FollowUp 5d</code> (1–999 days). Default 3 days for a bare <code className="px-1 rounded bg-muted">FollowUp</code>.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Tracked emails</CardTitle>
              <CardDescription>Live view — auto-refreshes every minute. Up to 2 polite follow-up drafts per tracked email, always left as drafts for you to review.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={runScan} disabled={scanning}>
              {scanning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Scan Outlook now
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No tracked emails yet. Flag a sent message in Outlook with a due date, then click "Scan Outlook now".
              </div>
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
                      <TableHead className="text-center">Follow-ups sent</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const meta = STATUS_META[r.status];
                      const Icon = meta.icon;
                      const flagDue = r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : null;
                      const overdue = r.status === 'pending' && new Date(r.follow_up_at).getTime() < Date.now();
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="max-w-xs">
                            <div className="font-medium truncate" title={r.subject || ''}>{r.subject || '(no subject)'}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              {r.trigger_type === 'flag'
                                ? <><Flag className="w-3 h-3 text-amber-500" /> Flag trigger</>
                                : <><TagIcon className="w-3 h-3 text-emerald-500" /> Category trigger</>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm">
                              <Mail className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="truncate max-w-[200px]" title={r.recipient_address || ''}>
                                {r.recipient_name ? `${r.recipient_name} <${r.recipient_address}>` : r.recipient_address || '—'}
                              </span>
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
                          <TableCell className="text-center font-medium">{r.attempts}/2</TableCell>
                          <TableCell>
                            <Badge variant={meta.variant} className="gap-1">
                              <Icon className="w-3 h-3" /> {meta.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: 'amber' | 'slate' | 'emerald' | 'blue' | 'red' }) {
  const tones: Record<string, string> = {
    amber: 'text-amber-600 bg-amber-500/10',
    slate: 'text-slate-600 bg-slate-500/10',
    emerald: 'text-emerald-600 bg-emerald-500/10',
    blue: 'text-blue-600 bg-blue-500/10',
    red: 'text-red-600 bg-red-500/10',
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

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { PageHero } from '@/components/app/PageHero';
import { BellRing, Loader2, RefreshCw, Flag, Tag as TagIcon, CheckCircle2, XCircle, AlarmClock, FileEdit, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ConnectionHealthPanel } from '@/components/follow-up/ConnectionHealthPanel';

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
  exhausted: { label: 'Exhausted (2/2)', icon: AlertTriangle, variant: 'destructive' },
  error: { label: 'Error', icon: AlertTriangle, variant: 'destructive' },
};

export default function FlaggedEmailTrackerPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TrackedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('tracked_emails' as any)
      .select('*')
      .eq('user_id', user.id)
      .order('follow_up_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('[tracked_emails]', error);
      toast.error('Could not load tracked emails');
    } else {
      setRows((data as any) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

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

        <ConnectionHealthPanel />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Tracked emails</CardTitle>
              <CardDescription>Up to 2 polite follow-up drafts per tracked email — always left as drafts for you to review.</CardDescription>
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
                      <TableHead>Recipient</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Follow up</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const meta = STATUS_META[r.status];
                      const Icon = meta.icon;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.recipient_name || r.recipient_address || '—'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={r.subject || ''}>{r.subject || '(no subject)'}</TableCell>
                          <TableCell>
                            {r.trigger_type === 'flag' ? (
                              <Badge variant="outline" className="gap-1"><Flag className="w-3 h-3" /> Flag</Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1"><TagIcon className="w-3 h-3" /> Category</Badge>
                            )}
                          </TableCell>
                          <TableCell title={format(new Date(r.follow_up_at), 'PPpp')}>
                            {formatDistanceToNow(new Date(r.follow_up_at), { addSuffix: true })}
                          </TableCell>
                          <TableCell>{r.attempts}/2</TableCell>
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

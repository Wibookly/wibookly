import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Mail, CheckCircle2, Clock, AlertTriangle, RefreshCw, FileEdit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';

interface Tracker {
  id: string;
  subject: string | null;
  bcc_alias: string;
  days_after_send: number;
  sent_at: string;
  due_at: string;
  status: 'pending' | 'replied' | 'drafted' | 'sent' | 'cancelled';
  to_recipients: Array<{ emailAddress?: { name?: string; address?: string } }>;
  drafted_at: string | null;
  replied_at: string | null;
}

const ALIASES = [2, 3, 5, 7, 10, 14];

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: any }> = {
  pending:   { label: 'Waiting',  variant: 'outline',     icon: Clock },
  drafted:   { label: 'Drafted',  variant: 'default',     icon: FileEdit },
  sent:      { label: 'Sent',     variant: 'default',     icon: CheckCircle2 },
  replied:   { label: 'Replied',  variant: 'secondary',   icon: CheckCircle2 },
  cancelled: { label: 'Cancelled',variant: 'outline',     icon: AlertTriangle },
};

export default function FollowUpsPanel({ organizationId }: { organizationId: string | null }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [domain, setDomain] = useState<string>('energyforward.com');

  async function load() {
    if (!organizationId) return;
    setLoading(true);

    // Discover the org's primary domain from the agent_settings or first connected email
    const { data: agent } = await supabase
      .from('agent_settings')
      .select('shared_mailbox_address')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (agent?.shared_mailbox_address?.includes('@')) {
      setDomain(agent.shared_mailbox_address.split('@')[1]);
    }

    const { data: t } = await supabase
      .from('follow_up_trackers')
      .select('id,subject,bcc_alias,days_after_send,sent_at,due_at,status,to_recipients,drafted_at,replied_at')
      .eq('organization_id', organizationId)
      .order('due_at', { ascending: false })
      .limit(50);

    setTrackers((t ?? []) as Tracker[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [organizationId]);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: text });
  }

  async function runNow() {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('cron-follow-ups', { body: {} });
      if (error) throw error;
      toast({ title: 'Follow-up scan started', description: 'New trackers and drafts will appear in a moment.' });
      setTimeout(load, 2500);
    } catch (e: any) {
      toast({ title: 'Scan failed', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  }

  const counts = trackers.reduce(
    (acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Smart Follow-ups</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            BCC any of the addresses below from Outlook (or anywhere) to track an email for follow-up.
            If the recipient hasn't replied by the due date, the original is moved to your <strong>Follow-up</strong>
            {' '}folder and an AI nudge is drafted. The BCC stays visible in your sent message so you always know
            when the original follow-up was scheduled.
          </p>
        </div>
        <Button onClick={runNow} disabled={running} variant="outline" className="shrink-0">
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Run scan now
        </Button>
      </div>

      {/* Aliases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="w-4 h-4" /> Your follow-up BCC addresses
          </CardTitle>
          <CardDescription>
            Click any address to copy it. Then BCC it on the email you want tracked. Hidden from recipients.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {ALIASES.map((d) => {
              const addr = `${d}@${domain}`;
              return (
                <button
                  key={d}
                  onClick={() => copy(addr)}
                  className="group flex items-center justify-between rounded-lg border bg-card hover:bg-accent transition-colors p-3 text-left"
                >
                  <div>
                    <div className="font-mono text-sm">{addr}</div>
                    <div className="text-xs text-muted-foreground">Follow up after {d} {d === 1 ? 'day' : 'days'}</div>
                  </div>
                  <Copy className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p className="font-medium">One-time Microsoft 365 setup required</p>
                <p className="text-muted-foreground">
                  For these BCC addresses to actually deliver, your M365 admin needs to create
                  6 mail-enabled aliases (<code className="font-mono text-xs">2@</code>, <code className="font-mono text-xs">3@</code>, <code className="font-mono text-xs">5@</code>, <code className="font-mono text-xs">7@</code>, <code className="font-mono text-xs">10@</code>, <code className="font-mono text-xs">14@{domain}</code>) — each forwarding to a single
                  inbox (the agent mailbox is fine). The system only needs the BCC trail; it does not need to read those mailboxes.
                </p>
                <p className="text-muted-foreground">
                  Easiest: in Exchange admin → <em>Mail flow → Rules</em>, create one rule that matches recipient
                  addresses <code className="font-mono text-xs">2@, 3@, 5@, 7@, 10@, 14@{domain}</code> and BCCs/forwards to
                  <code className="font-mono text-xs"> agent@{domain}</code>. Or create them as distribution groups with no members.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tracker list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Tracked emails</CardTitle>
              <CardDescription>
                {trackers.length === 0 ? 'No emails tracked yet.' : `${trackers.length} most recent`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['pending', 'drafted', 'replied', 'sent'] as const).map((s) => {
                const M = STATUS_META[s];
                return (
                  <Badge key={s} variant={M.variant} className="gap-1">
                    <M.icon className="w-3 h-3" /> {M.label}: {counts[s] ?? 0}
                  </Badge>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : trackers.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">
              Nothing tracked yet. BCC one of the addresses above on your next email and click <strong>Run scan now</strong>.
            </div>
          ) : (
            <div className="divide-y">
              {trackers.map((t) => {
                const M = STATUS_META[t.status] ?? STATUS_META.pending;
                const recipient = t.to_recipients?.[0]?.emailAddress?.address ?? '—';
                const due = new Date(t.due_at);
                const overdue = t.status === 'pending' && due < new Date();
                return (
                  <div key={t.id} className="py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{t.subject ?? '(no subject)'}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">{t.bcc_alias}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        To <span className="font-mono">{recipient}</span> · sent {format(new Date(t.sent_at), 'MMM d')}
                        {' · '}
                        {overdue ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            overdue by {formatDistanceToNow(due)}
                          </span>
                        ) : t.status === 'pending' ? (
                          <span>due {formatDistanceToNow(due, { addSuffix: true })}</span>
                        ) : t.status === 'drafted' && t.drafted_at ? (
                          <span>drafted {formatDistanceToNow(new Date(t.drafted_at), { addSuffix: true })}</span>
                        ) : t.status === 'replied' && t.replied_at ? (
                          <span>replied {formatDistanceToNow(new Date(t.replied_at), { addSuffix: true })}</span>
                        ) : null}
                      </div>
                    </div>
                    <Badge variant={M.variant} className="gap-1 shrink-0">
                      <M.icon className="w-3 h-3" /> {M.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, RefreshCw, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface ProbeResult {
  probe: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'skipped';
  detail?: any;
}

const PROBE_LABELS: Record<string, string> = {
  identity: '1. Identify connected mailbox',
  scopes: '2. Required scopes (Mail.Read, Mail.ReadWrite, offline_access)',
  read_sent_flags: '3. Read flag & category fields on sent mail',
  read_conversation: '4. Read conversation (for reply detection)',
  subscription: '5. Sent Items change-notification subscription',
  draft_write: '6. Create & delete a follow-up draft (write access)',
};

const STATUS_ICON = {
  pass: <ShieldCheck className="w-4 h-4 text-emerald-500" />,
  fail: <ShieldAlert className="w-4 h-4 text-red-500" />,
  warn: <ShieldQuestion className="w-4 h-4 text-amber-500" />,
  skipped: <ShieldQuestion className="w-4 h-4 text-muted-foreground" />,
};

export function ConnectionHealthPanel() {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [verdict, setVerdict] = useState<'ready' | 'not_ready' | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const loadLatest = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('graph_health' as any)
      .select('*')
      .eq('user_id', user.id)
      .order('checked_at', { ascending: false })
      .limit(20);
    if (data && data.length) {
      // Take latest per probe
      const map = new Map<string, ProbeResult>();
      for (const row of data as any[]) {
        if (!map.has(row.probe)) {
          map.set(row.probe, {
            probe: row.probe,
            label: PROBE_LABELS[row.probe] || row.probe,
            status: row.status,
            detail: row.detail,
          });
        }
      }
      const ordered = Object.keys(PROBE_LABELS).map((k) => map.get(k)).filter(Boolean) as ProbeResult[];
      if (ordered.length) {
        setResults(ordered);
        setLastChecked((data as any)[0].checked_at);
        computeVerdict(ordered);
      }
    }
  };

  useEffect(() => { loadLatest(); /* eslint-disable-next-line */ }, [user?.id]);

  const computeVerdict = (rs: ProbeResult[]) => {
    const critical = ['identity', 'scopes', 'read_sent_flags', 'read_conversation', 'draft_write'];
    const allOk = critical.every((p) => rs.find((r) => r.probe === p)?.status === 'pass');
    setVerdict(allOk ? 'ready' : 'not_ready');
  };

  const runProbes = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('graph-preflight', { body: {} });
      if (error) throw error;
      const rs: ProbeResult[] = (data?.results || []).map((r: any) => ({
        ...r,
        label: PROBE_LABELS[r.probe] || r.probe,
      }));
      setResults(rs);
      setLastChecked(new Date().toISOString());
      computeVerdict(rs);
      toast.success('Connection health check complete');
    } catch (e: any) {
      toast.error(e?.message || 'Preflight failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Microsoft Graph Connection Health</CardTitle>
          <CardDescription>
            Self-diagnostic that probes your Outlook connection with real (cleanup-after) calls. No emails are ever sent.
          </CardDescription>
        </div>
        <Button onClick={runProbes} disabled={running} size="sm" variant="outline">
          {running ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Run check
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {verdict && (
          <div className={`rounded-lg p-3 text-sm font-medium flex items-center gap-2 ${verdict === 'ready' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>
            {verdict === 'ready' ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            {verdict === 'ready' ? 'Ready to track follow-ups' : 'Not ready — see failed probes below'}
            {verdict !== 'ready' && (
              <Button asChild size="sm" variant="outline" className="ml-auto">
                <Link to="/integrations"><Plug className="w-3 h-3 mr-1" /> Reconnect Microsoft</Link>
              </Button>
            )}
          </div>
        )}

        {!results && !running && (
          <p className="text-sm text-muted-foreground">Click "Run check" to verify the app has the Graph access it needs.</p>
        )}

        {results && (
          <ul className="space-y-2">
            {Object.keys(PROBE_LABELS).map((key) => {
              const r = results.find((x) => x.probe === key);
              const status = r?.status || 'skipped';
              return (
                <li key={key} className="flex items-start gap-3 p-2 rounded border">
                  <div className="mt-0.5">{STATUS_ICON[status]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{PROBE_LABELS[key]}</div>
                    {r?.detail && status !== 'pass' && (
                      <div className="text-xs text-muted-foreground mt-1 break-all">
                        {typeof r.detail === 'string' ? r.detail : r.detail.message || r.detail.error || JSON.stringify(r.detail).slice(0, 240)}
                      </div>
                    )}
                    {r?.detail?.email && status === 'pass' && key === 'identity' && (
                      <div className="text-xs text-muted-foreground mt-1">Connected as <b>{r.detail.email}</b></div>
                    )}
                  </div>
                  <span className={`text-xs font-medium uppercase ${status === 'pass' ? 'text-emerald-600' : status === 'warn' ? 'text-amber-600' : status === 'fail' ? 'text-red-600' : 'text-muted-foreground'}`}>{status}</span>
                </li>
              );
            })}
          </ul>
        )}

        {lastChecked && (
          <p className="text-xs text-muted-foreground">Last checked {new Date(lastChecked).toLocaleString()}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default ConnectionHealthPanel;

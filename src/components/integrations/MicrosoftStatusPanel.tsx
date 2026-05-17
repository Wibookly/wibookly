import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Mail, Calendar, HardDrive, FolderOpen, User, KeyRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Status = 'pass' | 'fail' | 'idle' | 'pending';

interface FeatureRow {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  status: Status;
  detail?: string;
}

const INITIAL_ROWS: FeatureRow[] = [
  { key: 'token', label: 'OAuth Token Vault', icon: KeyRound, status: 'idle' },
  { key: 'me', label: 'Identity (/me)', icon: User, status: 'idle' },
  { key: 'mail', label: 'Mail', icon: Mail, status: 'idle' },
  { key: 'calendar', label: 'Calendar', icon: Calendar, status: 'idle' },
  { key: 'onedrive', label: 'OneDrive', icon: HardDrive, status: 'idle' },
  { key: 'sharepoint', label: 'SharePoint', icon: FolderOpen, status: 'idle' },
];

function StatusIcon({ status }: { status: Status }) {
  if (status === 'pass') return <CheckCircle className="w-5 h-5 text-success" />;
  if (status === 'fail') return <XCircle className="w-5 h-5 text-destructive" />;
  if (status === 'pending') return <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />;
  return <AlertTriangle className="w-5 h-5 text-muted-foreground/40" />;
}

export function MicrosoftStatusPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<FeatureRow[]>(INITIAL_ROWS);
  const [running, setRunning] = useState(false);
  const [overall, setOverall] = useState<Status>('idle');
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const runTest = async () => {
    if (!user?.id) {
      toast({ title: 'Not signed in', description: 'Sign in to run the test.', variant: 'destructive' });
      return;
    }
    setRunning(true);
    setOverall('pending');
    setRows((rs) => rs.map((r) => ({ ...r, status: 'pending', detail: undefined })));

    try {
      const { data, error } = await supabase.functions.invoke('test-microsoft-connection', {
        body: { userId: user.id },
      });
      if (error) throw error;

      const tests = data?.tests ?? {};
      const next: FeatureRow[] = INITIAL_ROWS.map((r) => {
        if (r.key === 'token') {
          const ok = tests.token === 'ok';
          return { ...r, status: ok ? 'pass' : 'fail', detail: ok ? 'Refresh token valid' : (data?.error ?? 'No valid token') };
        }
        const t = tests[r.key];
        if (!t) return { ...r, status: 'fail', detail: 'No response' };
        const detail = t.ok
          ? (r.key === 'me' ? `${t.displayName ?? ''} ${t.upn ? `(${t.upn})` : ''}`.trim() : `HTTP ${t.status} OK`)
          : `HTTP ${t.status}${t.body ? ` — ${String(t.body).slice(0, 140)}` : ''}`;
        return { ...r, status: t.ok ? 'pass' : 'fail', detail };
      });
      setRows(next);
      setOverall(data?.ok ? 'pass' : 'fail');
      setLastRunAt(new Date());
    } catch (e: any) {
      setRows((rs) => rs.map((r) => ({ ...r, status: 'fail', detail: 'Test failed to run' })));
      setOverall('fail');
      toast({ title: 'Test failed', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const failedScopes = rows.filter((r) => ['onedrive', 'sharepoint'].includes(r.key) && r.status === 'fail');
  const showReconnectHint = failedScopes.length > 0;

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            Microsoft 365 Integration Status
            <span className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full',
              overall === 'pass' && 'bg-success/15 text-success',
              overall === 'fail' && 'bg-destructive/15 text-destructive',
              overall === 'pending' && 'bg-muted text-muted-foreground',
              overall === 'idle' && 'bg-muted text-muted-foreground',
            )}>
              {overall === 'pass' && 'All systems go'}
              {overall === 'fail' && 'Issues detected'}
              {overall === 'pending' && 'Testing…'}
              {overall === 'idle' && 'Not tested'}
            </span>
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Live test of Microsoft Graph access for Mail, Calendar, OneDrive and SharePoint.
            {lastRunAt && <> Last run: {lastRunAt.toLocaleTimeString()}.</>}
          </p>
        </div>
        <Button onClick={runTest} disabled={running} size="sm">
          <RefreshCw className={cn('w-4 h-4 mr-2', running && 'animate-spin')} />
          {running ? 'Testing…' : 'Run Test'}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div
              key={row.key}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border bg-secondary/30 border-border/50',
                row.status === 'fail' && 'border-destructive/40 bg-destructive/5',
                row.status === 'pass' && 'border-success/30 bg-success/5',
              )}
            >
              <Icon className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{row.label}</p>
                  <StatusIcon status={row.status} />
                </div>
                {row.detail && (
                  <p className="text-xs text-muted-foreground mt-1 break-words">{row.detail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showReconnectHint && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-warning/40 bg-warning/5 text-sm">
          <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">OneDrive / SharePoint scopes missing</p>
            <p className="text-muted-foreground mt-1">
              Your current Microsoft token was issued before Files / Sites permissions were granted.
              Disconnect Microsoft 365 above and reconnect — accept the new Files and Sites prompts on the Microsoft consent screen.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

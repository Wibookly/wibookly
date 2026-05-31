import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  CheckCircle, XCircle, AlertTriangle, RefreshCw, Mail, Calendar, HardDrive,
  FolderOpen, User, KeyRound, ShieldCheck, ShieldAlert,
} from 'lucide-react';
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

const REQUIRED_SCOPES = [
  'openid', 'profile', 'offline_access', 'User.Read',
  'Mail.Read', 'Mail.ReadWrite', 'Mail.Send',
  'Calendars.Read', 'Calendars.ReadWrite',
  'Files.Read.All', 'Sites.Read.All',
];

const HEALTH_APIS: Array<{ key: 'mail' | 'calendar' | 'onedrive' | 'sharepoint'; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'mail', label: 'Mail', icon: Mail },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'onedrive', label: 'OneDrive', icon: HardDrive },
  { key: 'sharepoint', label: 'SharePoint', icon: FolderOpen },
];

interface VaultState {
  refresh_failure_count: number;
  requires_reauth: boolean;
  last_refresh_at: string | null;
  last_refresh_error: string | null;
}

interface HealthRow {
  api_name: string;
  status: string;
  response_ms: number | null;
  error_message: string | null;
  checked_at: string;
}

interface ApiSummary {
  total: number;
  failed: number;
  avgMs: number;
  successRate: number;
  lastFailure: string | null;
}

function decodeJwtScopes(token: string): string[] {
  try {
    const part = token.split('.')[1];
    // base64url -> base64
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? b64 + '='.repeat(4 - (b64.length % 4)) : b64;
    const payload = JSON.parse(atob(pad));
    return String(payload.scp || '').split(' ').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function summarize(rows: HealthRow[]): Record<string, ApiSummary> {
  const out: Record<string, ApiSummary> = {};
  for (const api of HEALTH_APIS) {
    const subset = rows.filter((r) => r.api_name === api.key);
    const total = subset.length;
    const failed = subset.filter((r) => r.status === 'failed').length;
    const msSamples = subset.map((r) => r.response_ms ?? 0).filter((n) => n > 0);
    const avgMs = msSamples.length ? Math.round(msSamples.reduce((a, b) => a + b, 0) / msSamples.length) : 0;
    const lastFailure = subset.find((r) => r.status === 'failed')?.error_message ?? null;
    out[api.key] = {
      total,
      failed,
      avgMs,
      successRate: total ? Math.round(((total - failed) / total) * 100) : 0,
      lastFailure,
    };
  }
  return out;
}

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
  const [grantedScopes, setGrantedScopes] = useState<string[]>([]);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [health24h, setHealth24h] = useState<HealthRow[]>([]);
  const [reconnecting, setReconnecting] = useState(false);

  const loadVaultAndHealth = async () => {
    if (!user?.id) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [vRes, hRes] = await Promise.all([
      supabase
        .from('oauth_token_vault' as any)
        .select('refresh_failure_count, requires_reauth, last_refresh_at, last_refresh_error')
        .eq('user_id', user.id)
        .eq('provider', 'outlook')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('m365_api_health' as any)
        .select('api_name, status, response_ms, error_message, checked_at')
        .eq('user_id', user.id)
        .gte('checked_at', since)
        .order('checked_at', { ascending: false })
        .limit(500),
    ]);
    if (vRes.data) setVault(vRes.data as any);
    if (hRes.data) setHealth24h(hRes.data as any);
  };

  useEffect(() => { loadVaultAndHealth(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

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
          ? (r.key === 'me' ? `${t.displayName ?? ''} ${t.upn ? `(${t.upn})` : ''}`.trim() : `HTTP ${t.status} OK · ${t.response_ms ?? '?'}ms`)
          : `HTTP ${t.status}${t.body ? ` — ${String(t.body).slice(0, 140)}` : ''}`;
        return { ...r, status: t.ok ? 'pass' : 'fail', detail };
      });
      setRows(next);
      setOverall(data?.ok ? 'pass' : 'fail');
      setLastRunAt(new Date());
      if (Array.isArray(data?.scopes)) {
        setGrantedScopes(data.scopes);
      } else if (typeof data?.access_token === 'string') {
        setGrantedScopes(decodeJwtScopes(data.access_token));
      }
      await loadVaultAndHealth();
    } catch (e: any) {
      setRows((rs) => rs.map((r) => ({ ...r, status: 'fail', detail: 'Test failed to run' })));
      setOverall('fail');
      toast({ title: 'Test failed', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const handleReconnect = async () => {
    if (!user?.id) return;
    setReconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('oauth-init', {
        body: { provider: 'outlook', prompt: 'consent' },
      });
      if (error) throw error;
      const url = (data as any)?.url ?? (data as any)?.authorization_url;
      if (!url) throw new Error('No authorization URL returned');
      window.location.href = url;
    } catch (e: any) {
      toast({ title: 'Reconnect failed', description: e?.message ?? String(e), variant: 'destructive' });
      setReconnecting(false);
    }
  };

  const missingScopes = grantedScopes.length ? REQUIRED_SCOPES.filter((s) => !grantedScopes.includes(s)) : [];
  const summary = summarize(health24h);
  const totalSuccess = health24h.filter((r) => r.status !== 'failed').length;
  const totalFailed = health24h.filter((r) => r.status === 'failed').length;

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-6">
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

      {/* Per-feature live test results */}
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

      {/* Scope chips */}
      {grantedScopes.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-border/60">
          <div className="flex items-center gap-2">
            {missingScopes.length === 0
              ? <ShieldCheck className="w-4 h-4 text-success" />
              : <ShieldAlert className="w-4 h-4 text-warning" />}
            <h4 className="font-medium text-sm">Granted Scopes</h4>
            <span className="text-xs text-muted-foreground">({grantedScopes.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {grantedScopes.map((scope) => (
              <span
                key={scope}
                className="px-2.5 py-1 rounded-full bg-success/10 text-success text-xs font-medium border border-success/20"
              >
                ✓ {scope}
              </span>
            ))}
          </div>

          {missingScopes.length > 0 && (
            <div className="pt-2">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-destructive" />
                Missing Required Scopes
              </h4>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {missingScopes.map((scope) => (
                  <span
                    key={scope}
                    className="px-2.5 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-medium border border-destructive/20"
                  >
                    ✗ {scope}
                  </span>
                ))}
              </div>
              <Button onClick={handleReconnect} disabled={reconnecting} size="sm">
                {reconnecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Reconnect to Grant Missing Scopes
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Token vault health */}
      {vault && (
        <div className="pt-2 border-t border-border/60 space-y-2">
          <h4 className="font-medium text-sm">Token Vault</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Refresh failures</div>
              <div className={cn('font-semibold', vault.refresh_failure_count > 0 ? 'text-warning' : 'text-foreground')}>
                {vault.refresh_failure_count} / 3
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className={cn('font-semibold', vault.requires_reauth ? 'text-destructive' : 'text-success')}>
                {vault.requires_reauth ? 'Locked — reconnect' : 'Active'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Last refresh</div>
              <div className="font-semibold">
                {vault.last_refresh_at ? new Date(vault.last_refresh_at).toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Last error</div>
              <div className="font-medium text-xs break-words text-muted-foreground">
                {vault.last_refresh_error ? vault.last_refresh_error.slice(0, 80) : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 24h Connection Health Summary */}
      <div className="pt-2 border-t border-border/60 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium text-sm">Connection Health (last 24h)</h4>
          <div className="text-xs text-muted-foreground">
            <span className="text-success font-medium">{totalSuccess}</span> success ·{' '}
            <span className="text-destructive font-medium">{totalFailed}</span> failed
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {HEALTH_APIS.map((api) => {
            const s = summary[api.key];
            const Icon = api.icon;
            const borderColor = s.total === 0
              ? 'border-border/50'
              : s.failed === 0
                ? 'border-success/40'
                : s.successRate >= 50
                  ? 'border-warning/40'
                  : 'border-destructive/40';
            return (
              <div key={api.key} className={cn('p-3 rounded-lg border bg-secondary/30', borderColor)}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{api.label}</span>
                </div>
                {s.total === 0 ? (
                  <div className="text-xs text-muted-foreground">No data</div>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-semibold">{s.successRate}%</span>
                      <span className="text-xs text-muted-foreground">{s.total} calls</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      avg {s.avgMs}ms · {s.failed} failed
                    </div>
                    {s.lastFailure && (
                      <div className="text-xs text-destructive/80 mt-1 break-words line-clamp-2">
                        {s.lastFailure}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { PageHero } from '@/components/app/PageHero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Briefcase, ExternalLink, Loader2, RefreshCw, Settings } from 'lucide-react';

type Stat = { label: string; value: string | number };

export default function UnanetDashboard() {
  const { profile } = useAuth();
  const { hasFeature } = useFeatureAccess();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';
  const canAccess = isSuperAdmin || hasFeature('unanet_integration');

  const [status, setStatus] = useState<string>('idle');
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<Stat[]>([
    { label: 'Active projects', value: '—' },
    { label: 'Utilization %', value: '—' },
    { label: 'Open timesheets', value: '—' },
    { label: 'Pending approvals', value: '—' },
  ]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    try {
      const { data: st } = await supabase.functions.invoke('unanet-status', { body: {} });
      const connected = (st as any)?.connected === true && (st as any)?.status === 'active';
      setStatus(connected ? 'healthy' : ((st as any)?.status ?? 'idle'));
      setCloudUrl((st as any)?.base_url ?? null);

      if (connected) {
        const { data } = await supabase.functions.invoke('unanet-search', {
          body: { kind: 'dashboard_summary' },
        });
        const s = (data as any)?.summary;
        if (s) {
          setStats([
            { label: 'Active projects', value: s.active_projects ?? '—' },
            { label: 'Utilization %', value: s.utilization_pct != null ? `${s.utilization_pct}%` : '—' },
            { label: 'Open timesheets', value: s.open_timesheets ?? '—' },
            { label: 'Pending approvals', value: s.pending_approvals ?? '—' },
          ]);
        }
      }
    } catch {
      setStatus('idle');
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [profile?.organization_id]);

  if (!canAccess) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            The Unanet dashboard is not enabled for your account. Ask your admin to enable the Unanet feature on your plan.
          </CardContent>
        </Card>
      </div>
    );
  }

  const isConnected = status === 'healthy' || status === 'connected';

  return (
    <div className="p-6 space-y-6">
      <PageHero
        icon={<Briefcase className="w-6 h-6" />}
        title="Unanet Dashboard"
        description="Projects, utilization, timesheets, and approvals from your Unanet cloud tenant."
      />

      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs border ${
            isConnected
              ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
              : status === 'failed'
              ? 'bg-rose-500/10 text-rose-700 border-rose-500/30'
              : 'bg-muted text-muted-foreground border-border'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-emerald-500' : status === 'failed' ? 'bg-rose-500' : 'bg-muted-foreground/50'
            }`}
          />
          {isConnected ? 'Connected' : status === 'failed' ? 'Connection failed' : 'Not configured'}
        </span>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          Refresh
        </Button>
        {cloudUrl && (
          <Button size="sm" variant="ghost" asChild>
            <a href={cloudUrl} target="_blank" rel="noopener noreferrer">
              Open Unanet <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <Link to="/admin">
            <Settings className="h-3.5 w-3.5 mr-1" /> Admin → Integrations → Apps
          </Link>
        </Button>
      </div>

      {!isConnected && (
        <Card className="border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm">
            Unanet is not connected yet. An org admin can configure the cloud URL, database, and API key in{' '}
            <Link to="/admin" className="underline">Admin → Integrations → Apps → Unanet</Link>.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">About this dashboard</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Unanet is an ERP for services organizations covering projects, resources, and time & expense.
            When connected, this page will show live summary tiles from your tenant and AI Chat can answer
            questions about Unanet data using the "Unanet context" toggle in the chat's + menu.
          </p>
          <p>
            More detailed reports (per-project drilldowns, utilization by resource, approval queues) will
            surface here as they're wired up.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

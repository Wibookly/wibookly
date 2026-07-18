import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Icon } from './shared/Icon';
import { StatusPill } from './shared/StatusPill';
import { CredentialRow } from './shared/CredentialRow';
import { AuditTable } from './shared/AuditTable';
import { findProvider, type Provider } from './shared/inventory';
import { useIntegrationHealth, statusOf } from './hooks/useIntegrationHealth';
import { useRunProbe } from './hooks/useRunProbe';
import { useIntegrationAction } from './hooks/useIntegrationAction';
import type { SelectedNode } from './IntegrationsSidebar';
import { UnanetSettingsCard } from '@/components/admin/UnanetSettingsCard';
import { useAuth } from '@/lib/auth';

export function ProviderDetail({ id, onSelect }: { id: string; onSelect: (n: SelectedNode) => void }) {
  const provider = findProvider(id);
  const { profile } = useAuth();
  const { rows } = useIntegrationHealth();
  const { run, running } = useRunProbe();
  const { dispatch, running: actionRunning } = useIntegrationAction();
  if (!provider) return <div className="p-6">Provider not found.</div>;
  const status = statusOf(rows, provider.id);
  const subHealthy = provider.subs.filter((s) => statusOf(rows, s.id) === 'healthy').length;
  const subFailed = provider.subs.filter((s) => statusOf(rows, s.id) === 'failed').length;
  const isFailed = status === 'failed';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-4">
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon name={provider.icon} className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold leading-tight">{provider.name}</h2>
            <StatusPill status={status} />
            <span className="text-[10px] uppercase tracking-wide rounded-full border px-2 py-0.5 text-muted-foreground">
              {provider.isRouter ? 'Internal router' : 'Provider'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{provider.subtitle}</p>
        </div>
        <div className="flex gap-2">
          {isFailed && (
            <Button variant="outline" size="sm" disabled={actionRunning === 'run_test'} onClick={() => run(provider.id)}>
              Recover now
            </Button>
          )}
          <Button size="sm" disabled={running === provider.id} onClick={() => run(provider.id)}>
            {running === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Run test
          </Button>
        </div>
      </header>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="audit">Audit & history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {provider.id === 'unanet' && (
            <UnanetSettingsCard organizationId={profile?.organization_id ?? null} />
          )}
          <div className="grid md:grid-cols-2 gap-4">
            <Card><CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">Provider account</h3>
              <p className="text-sm text-muted-foreground">{provider.description}</p>
              <div className="text-xs text-muted-foreground pt-2 border-t mt-2">{provider.meta}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">Snapshot</h3>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Sub-services" value={provider.subs.length} />
                <Stat label="Healthy" value={subHealthy} />
                <Stat label="Unhealthy" value={subFailed} tone={subFailed > 0 ? 'bad' : 'ok'} />
              </div>
            </CardContent></Card>
          </div>

          {isFailed && rows[provider.id]?.message && (
            <div className="rounded-md border border-rose-500/30 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 p-3 text-sm">
              {rows[provider.id]?.message}
            </div>
          )}

          {provider.subs.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Sub-services</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {provider.subs.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelect({ type: 'sub', id: s.id })}
                    className="text-left rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon name={s.icon} className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{s.name}</span>
                      <StatusPill status={statusOf(rows, s.id)} className="ml-auto" />
                    </div>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {provider.scopes && (
            <Card><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-2">OAuth scopes granted</h3>
              <div className="flex flex-wrap gap-1.5">
                {provider.scopes.map((s) => (
                  <code key={s} className="text-[11px] rounded bg-muted px-1.5 py-0.5 font-mono">{s}</code>
                ))}
              </div>
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {provider.id === 'unanet' && (
            <UnanetSettingsCard organizationId={profile?.organization_id ?? null} />
          )}
          {provider.isRouter ? (
            <div className="rounded-md border border-blue-500/30 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 p-3 text-sm">
              This is the {provider.name}. It uses OPENAI_API_KEY and ANTHROPIC_API_KEY from the OpenAI and Anthropic providers.
            </div>
          ) : (
            <Card><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-2">Credentials</h3>
              <div className="divide-y">
                {provider.credentials.map((c) => <CredentialRow key={c.secret} {...c} />)}
              </div>
            </CardContent></Card>
          )}

          {provider.extraCredentials && (
            <Card><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-2">{provider.extraCredentials.title}</h3>
              <div className="divide-y">
                {provider.extraCredentials.rows.map((c) => <CredentialRow key={c.secret} {...c} />)}
              </div>
            </CardContent></Card>
          )}

          <Card><CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Provider-wide actions</h3>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Run health check across all sub-services</div>
                <div className="text-xs text-muted-foreground">Probes each sub-service in sequence.</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => run(provider.id)} disabled={!!running}>Run all</Button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Reset health-check counters</div>
                <div className="text-xs text-muted-foreground">Clears recent retry counts.</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => dispatch(provider.id, 'reset_health_counters', { integration_key: provider.id })}>Reset</Button>
            </div>
          </CardContent></Card>

          {provider.consoleUrl && (
            <Card className="border-rose-500/30"><CardContent className="p-4">
              <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300 mb-2">Danger zone</h3>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">Rotate credentials at the provider</div>
                  <div className="text-xs text-muted-foreground">Open the provider console in a new tab.</div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={provider.consoleUrl.url} target="_blank" rel="noopener noreferrer">
                    {provider.consoleUrl.label} <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="audit">
          {auditSourceForProvider(provider) ? (
            <AuditTable source={auditSourceForProvider(provider)!} title="Source: provider logs" />
          ) : (
            <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground text-center">
              No audit source for this provider.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function auditSourceForProvider(p: Provider) {
  if (p.id === 'microsoft') return { kind: 'm365_api_health' as const };
  if (['openai', 'anthropic', 'lovable-ai', 'llm-gateway'].includes(p.id))
    return { kind: 'llm_call_logs' as const, provider: p.id === 'lovable-ai' ? 'lovable' : p.id };
  if (p.id === 'lovable-email') return { kind: 'email_send_log' as const };
  if (p.id === 'deepgram') return { kind: 'none' as const, note: 'Would require new logging — currently relies on call-time errors only.' };
  return { kind: 'none' as const, note: 'No log source configured.' };
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-md border bg-background p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'bad' ? 'text-rose-600' : ''}`}>{value}</div>
    </div>
  );
}

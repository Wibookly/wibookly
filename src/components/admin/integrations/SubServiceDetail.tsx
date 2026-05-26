import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Icon } from './shared/Icon';
import { StatusPill } from './shared/StatusPill';
import { AuditTable } from './shared/AuditTable';
import { findSub } from './shared/inventory';
import { useIntegrationHealth, statusOf } from './hooks/useIntegrationHealth';
import { useRunProbe } from './hooks/useRunProbe';
import type { SelectedNode } from './IntegrationsSidebar';

export function SubServiceDetail({ id, onSelect }: { id: string; onSelect: (n: SelectedNode) => void }) {
  const found = findSub(id);
  const { rows } = useIntegrationHealth();
  const { run, running } = useRunProbe();
  if (!found) return <div className="p-6">Sub-service not found.</div>;
  const { sub, provider } = found;
  const status = statusOf(rows, sub.id);
  const row = rows[sub.id];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-4">
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon name={sub.icon} className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold leading-tight">{sub.name}</h2>
            <StatusPill status={status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">{sub.description}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Last activity: {row?.last_checked_at ? new Date(row.last_checked_at).toLocaleString() : '—'}
            {row?.latency_ms ? ` · ${row.latency_ms}ms` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {status === 'failed' && (
            <Button variant="outline" size="sm" onClick={() => run(sub.id)}>Recover now</Button>
          )}
          <Button size="sm" disabled={running === sub.id} onClick={() => run(sub.id)}>
            {running === sub.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Run test
          </Button>
        </div>
      </header>

      <div className="text-xs text-muted-foreground">
        <button onClick={() => onSelect({ type: 'provider', id: provider.id })} className="hover:text-foreground underline-offset-2 hover:underline">
          {provider.name}
        </button>
        <span className="mx-1.5">›</span>
        <span>{sub.name}</span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="audit">Audit & history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="rounded-md border border-blue-500/30 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 p-3 text-sm">
            Credentials for this service live on its parent provider — {' '}
            <button onClick={() => onSelect({ type: 'provider', id: provider.id })} className="underline font-medium">
              open {provider.name}
            </button>
            {' '}to view or rotate keys. Update them once and every sub-service inherits the change.
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card><CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">Live status</h3>
              <StatusPill status={status} />
              <div className="text-xs grid grid-cols-2 gap-y-1 pt-2">
                <span className="text-muted-foreground">Last activity</span>
                <span>{row?.last_checked_at ? new Date(row.last_checked_at).toLocaleString() : '—'}</span>
                <span className="text-muted-foreground">Latency</span>
                <span>{row?.latency_ms != null ? `${row.latency_ms}ms` : '—'}</span>
                <span className="text-muted-foreground">Message</span>
                <span className={status === 'failed' ? 'text-rose-600' : ''}>{row?.message ?? '—'}</span>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">Provider</h3>
              <div className="flex items-center gap-2">
                <Icon name={provider.icon} className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{provider.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{provider.tierLabel}</p>
              <button
                onClick={() => onSelect({ type: 'provider', id: provider.id })}
                className="text-xs text-primary hover:underline"
              >
                Manage credentials at {provider.name} →
              </button>
            </CardContent></Card>
          </div>

          {sub.calledBy && sub.calledBy.length > 0 && (
            <Card><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-2">Called by</h3>
              <div className="flex flex-wrap gap-1.5">
                {sub.calledBy.map((c) => (
                  <code key={c} className="text-[11px] rounded bg-muted px-1.5 py-0.5 font-mono">{c}</code>
                ))}
              </div>
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="audit">
          <AuditTable
            source={sub.auditSource ?? { kind: 'none', note: 'No log source configured.' }}
            title={`Source: ${sub.auditSource?.kind ?? 'none'}`}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}


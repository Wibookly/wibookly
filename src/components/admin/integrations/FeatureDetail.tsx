import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Icon } from './shared/Icon';
import { StatusPill } from './shared/StatusPill';
import { AuditTable } from './shared/AuditTable';
import { findFeature, findSub, findProvider, type NodeStatus } from './shared/inventory';
import { useIntegrationHealth, statusOf } from './hooks/useIntegrationHealth';
import { useRunProbe } from './hooks/useRunProbe';
import type { SelectedNode } from './IntegrationsSidebar';

function rollup(rows: Record<string, any>, ids: string[]): NodeStatus {
  let warn = false;
  for (const id of ids) {
    const s = rows[id]?.status as NodeStatus | undefined;
    if (s === 'failed') return 'failed';
    if (s === 'warning') warn = true;
  }
  return warn ? 'warning' : 'healthy';
}

export function FeatureDetail({ id, onSelect }: { id: string; onSelect: (n: SelectedNode) => void }) {
  const feat = findFeature(id);
  const { rows } = useIntegrationHealth();
  const { run, running } = useRunProbe();
  if (!feat) return <div className="p-6">Feature not found.</div>;
  const allDeps = [...feat.aiDependencies, ...feat.otherDependencies].map((d) => d.targetId);
  const status = rollup(rows, allDeps);
  const failedCount = allDeps.filter((id) => rows[id]?.status === 'failed').length;

  const renderRow = (d: { targetId: string; usage: string }) => {
    const sub = findSub(d.targetId);
    const prov = !sub ? findProvider(d.targetId) : undefined;
    const name = sub?.sub.name ?? prov?.name ?? d.targetId;
    const icon = sub?.sub.icon ?? prov?.icon ?? 'Circle';
    const click = sub
      ? () => onSelect({ type: 'sub', id: d.targetId })
      : prov ? () => onSelect({ type: 'provider', id: d.targetId }) : () => {};
    return (
      <button key={d.targetId + d.usage} onClick={click} className="w-full flex items-center gap-3 rounded-md border bg-card p-3 hover:bg-muted/50">
        <Icon name={icon} className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1 text-left">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">{d.usage}</div>
        </div>
        <StatusPill status={statusOf(rows, d.targetId)} />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-4">
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon name={feat.icon} className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold leading-tight">{feat.name}</h2>
            <StatusPill status={status} />
            <span className="text-[10px] uppercase tracking-wide rounded-full border px-2 py-0.5 text-muted-foreground">Feature</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{feat.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={running === feat.id} onClick={() => run(feat.id)}>
            {running === feat.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
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
          <div className="grid md:grid-cols-2 gap-4">
            <Card><CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">Feature status</h3>
              <StatusPill status={status} />
              <p className="text-sm text-muted-foreground">{feat.subtitle}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">Health summary</h3>
              <p className="text-sm text-muted-foreground">
                {failedCount === 0 ? 'All dependencies healthy.' : `${failedCount} of ${allDeps.length} dependencies failed. Click any failed dependency below to fix.`}
              </p>
            </CardContent></Card>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">AI dependencies</h3>
            <div className="space-y-2">{feat.aiDependencies.map(renderRow)}</div>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-2">Other dependencies</h3>
            <div className="space-y-2">{feat.otherDependencies.map(renderRow)}</div>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <div className="rounded-md border border-blue-500/30 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 p-3 text-sm">
            This is a composite feature. Credentials for its dependencies are managed at each provider.
          </div>
          <Card><CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Feature controls</h3>
            <p className="text-xs text-muted-foreground">Enabled toggle and per-user daily cap land in a follow-up — they will write to group_features / user_feature_access.</p>
          </CardContent></Card>
          {feat.aiModelSteps && (
            <Card><CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">AI model preferences for this feature</h3>
              <div className="space-y-2">
                {feat.aiModelSteps.map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{s.label}</span>
                    <code className="font-mono text-xs rounded bg-muted px-2 py-0.5">{s.options[0]}</code>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="audit">
          <AuditTable source={{ kind: 'ai_activity_logs', feature: feat.id }} title="Source: ai_activity_logs" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

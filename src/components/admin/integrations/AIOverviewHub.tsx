import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { Icon } from './shared/Icon';
import { StatusPill } from './shared/StatusPill';
import { AuditTable } from './shared/AuditTable';
import { GROUPS, type NodeStatus } from './shared/inventory';
import { useIntegrationHealth, statusOf } from './hooks/useIntegrationHealth';
import { useRunProbe } from './hooks/useRunProbe';
import { useIntegrationAction } from './hooks/useIntegrationAction';
import type { SelectedNode } from './IntegrationsSidebar';

export function AIOverviewHub({ onSelect }: { onSelect: (n: SelectedNode) => void }) {
  const aiGroup = GROUPS.find((g) => g.id === 'ai')!;
  const providers = aiGroup.providers ?? [];
  const { rows } = useIntegrationHealth();
  const { run, running } = useRunProbe();
  const { dispatch } = useIntegrationAction();

  let failed = 0;
  for (const p of providers) if (statusOf(rows, p.id) === 'failed') failed++;
  const summary: NodeStatus = failed > 0 ? 'failed' : 'healthy';

  const runAll = async () => { for (const p of providers) await run(p.id); };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-4">
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon name="Layers" className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold leading-tight">AI</h2>
            <StatusPill status={summary} label={failed > 0 ? `${failed} provider failed` : 'All healthy'} />
            <span className="text-[10px] uppercase tracking-wide rounded-full border px-2 py-0.5 text-muted-foreground">Section overview</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">All AI providers, models, and the LLM gateway router.</p>
          <p className="text-xs text-muted-foreground mt-0.5">{providers.length} providers</p>
        </div>
        <Button size="sm" disabled={!!running} onClick={runAll}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Test all AI
        </Button>
      </header>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="audit">Audit & history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Mini label="Providers" value={providers.length} />
            <Mini label="Today's spend" value="—" />
            <Mini label="Calls today" value="—" />
            <Mini label="Errors 24h" value={failed} tone={failed > 0 ? 'bad' : 'ok'} />
          </div>

          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left font-medium px-4 py-2">Provider</th>
                  <th className="text-left font-medium px-4 py-2">Purpose</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-right font-medium px-4 py-2">Calls today</th>
                  <th className="text-right font-medium px-4 py-2">Today's cost</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => onSelect({ type: 'provider', id: p.id })}>
                    <td className="px-4 py-2 flex items-center gap-2"><Icon name={p.icon} className="h-4 w-4 text-muted-foreground" />{p.name}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{p.subtitle}</td>
                    <td className="px-4 py-2"><StatusPill status={statusOf(rows, p.id)} /></td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">—</td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>

          <Card><CardContent className="p-4 space-y-1">
            <h3 className="text-sm font-semibold">How the AI section works</h3>
            <p className="text-sm text-muted-foreground">
              The LLM gateway routes chat and agent calls to OpenAI or Anthropic based on feature config.
              The Lovable AI gateway is a separate path for transactional functions like categorization and the daily brief.
              Deepgram is its own provider for live speech-to-text. OpenAI also provides embeddings and Whisper under the same key.
            </p>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <div className="rounded-md border border-blue-500/30 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 p-3 text-sm">
            Each provider has its own API key. Open a provider from the sidebar (or click a row above) to update its key.
          </div>
          <Card><CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Cross-AI controls</h3>
            <div className="text-sm text-muted-foreground">Org monthly cap and per-user daily cap inputs land in a follow-up.</div>
            <div className="pt-2 border-t">
              <Button variant="destructive" size="sm" onClick={() => dispatch('llm-gateway', 'set_kill_switch', { enabled: true })}>
                Pause all AI calls (kill switch)
              </Button>
              <p className="text-xs text-muted-foreground mt-1">Writes ai_kill_switch=true to system_flags. Edge functions can read this flag to short-circuit.</p>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="audit">
          <AuditTable source={{ kind: 'llm_call_logs' }} title="Source: llm_call_logs (all providers)" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'bad' ? 'text-rose-600' : ''}`}>{value}</div>
    </div>
  );
}

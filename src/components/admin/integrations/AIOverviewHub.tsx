import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Icon } from './shared/Icon';
import { StatusPill } from './shared/StatusPill';
import { AuditTable } from './shared/AuditTable';
import { GROUPS, type NodeStatus, type Provider } from './shared/inventory';
import { useIntegrationHealth, statusOf } from './hooks/useIntegrationHealth';
import { useRunProbe } from './hooks/useRunProbe';
import { useIntegrationAction } from './hooks/useIntegrationAction';
import { useSecretStatus } from './hooks/useSecretStatus';
import type { SelectedNode } from './IntegrationsSidebar';

function tierBadgeClass(tier: Provider['tier']) {
  switch (tier) {
    case 'free': return 'border-slate-400/40 text-slate-700 dark:text-slate-300';
    case 'lovable': return 'border-violet-500/40 text-violet-700 dark:text-violet-300';
    case 'byo': return 'border-amber-500/40 text-amber-700 dark:text-amber-300';
    case 'platform': return 'border-sky-500/40 text-sky-700 dark:text-sky-300';
  }
}

export function AIOverviewHub({ onSelect }: { onSelect: (n: SelectedNode) => void }) {
  const aiGroup = GROUPS.find((g) => g.id === 'ai')!;
  const providers = aiGroup.providers ?? [];
  const { rows } = useIntegrationHealth();
  const { run, running } = useRunProbe();
  const { dispatch } = useIntegrationAction();
  const { secrets, loading, refresh } = useSecretStatus();

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
          <p className="text-sm text-muted-foreground mt-1">
            One row per AI provider. Each key below is stored once and reused by every sub-service of that provider.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{providers.length} providers</p>
        </div>
        <Button size="sm" disabled={!!running} onClick={runAll}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Test all AI
        </Button>
      </header>

      <Tabs defaultValue="dictionary">
        <TabsList>
          <TabsTrigger value="dictionary">Key dictionary</TabsTrigger>
          <TabsTrigger value="overview">Usage overview</TabsTrigger>
          <TabsTrigger value="settings">Cross-AI controls</TabsTrigger>
          <TabsTrigger value="audit">Audit & history</TabsTrigger>
        </TabsList>

        <TabsContent value="dictionary" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Live read of the Edge Function runtime — shows the exact secret name, whether the system can see it, and a masked
              preview of the last 4 characters so you can confirm it's the right value.
            </p>
            <Button size="sm" variant="ghost" onClick={() => refresh()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Re-check
            </Button>
          </div>
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left font-medium px-4 py-2">Provider</th>
                  <th className="text-left font-medium px-4 py-2">Tier</th>
                  <th className="text-left font-medium px-4 py-2">Secret name</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-left font-medium px-4 py-2">Used by</th>
                  <th className="text-right font-medium px-4 py-2">Health</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  const keys = p.credentials.length > 0
                    ? p.credentials
                    : [{ label: '(internal router)', secret: '' }];
                  return keys.map((c, i) => {
                    const info = c.secret ? secrets[c.secret] : null;
                    const present = !!info?.present;
                    return (
                      <tr
                        key={`${p.id}-${c.secret || i}`}
                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                        onClick={() => onSelect({ type: 'provider', id: p.id })}
                      >
                        <td className="px-4 py-2">
                          {i === 0 ? (
                            <div className="flex items-center gap-2">
                              <Icon name={p.icon} className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{p.name}</span>
                            </div>
                          ) : <span className="text-xs text-muted-foreground pl-6">↳ same provider</span>}
                        </td>
                        <td className="px-4 py-2">
                          {i === 0 && (
                            <Badge variant="outline" className={`text-[10px] ${tierBadgeClass(p.tier)}`}>
                              {p.tierLabel}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {c.secret ? (
                            <code className="text-[11px] font-mono">{c.secret}</code>
                          ) : <span className="text-xs text-muted-foreground italic">no key required</span>}
                        </td>
                        <td className="px-4 py-2">
                          {!c.secret ? (
                            <Badge variant="outline" className="text-[10px]">N/A</Badge>
                          ) : loading && !info ? (
                            <Badge variant="outline" className="text-[10px]"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Checking…</Badge>
                          ) : present ? (
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3 mr-1" />Configured {info?.preview ? `(${info.preview})` : ''}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-300">
                              <AlertCircle className="h-3 w-3 mr-1" />Missing
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {i === 0 ? (p.subs.length > 0 ? p.subs.map((s) => s.name).join(', ') : '—') : ''}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {i === 0 && <StatusPill status={statusOf(rows, p.id)} />}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </CardContent></Card>
          <Card><CardContent className="p-4 space-y-1">
            <h3 className="text-sm font-semibold">How to read this</h3>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li><span className="font-medium text-foreground">Included with Lovable</span> — no key needed, billing flows through your Lovable plan.</li>
              <li><span className="font-medium text-foreground">Bring-your-own</span> — you pay the provider directly; rotate the key in the provider's row.</li>
              <li><span className="font-medium text-foreground">Internal router</span> — has no key of its own; it reuses OpenAI / Anthropic keys above.</li>
              <li>One key per provider — every sub-service (chat, embeddings, Whisper, etc.) inherits the same value.</li>
            </ul>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left font-medium px-4 py-2">Provider</th>
                  <th className="text-left font-medium px-4 py-2">Purpose</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-right font-medium px-4 py-2">Sub-services</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => onSelect({ type: 'provider', id: p.id })}>
                    <td className="px-4 py-2 flex items-center gap-2"><Icon name={p.icon} className="h-4 w-4 text-muted-foreground" />{p.name}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{p.subtitle}</td>
                    <td className="px-4 py-2"><StatusPill status={statusOf(rows, p.id)} /></td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">{p.subs.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <div className="rounded-md border border-blue-500/30 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 p-3 text-sm">
            Keys are stored on the provider, not the sub-service. Open any provider from the dictionary above to rotate its single key.
          </div>
          <Card><CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Kill switch</h3>
            <Button variant="destructive" size="sm" onClick={() => dispatch('llm-gateway', 'set_kill_switch', { enabled: true })}>
              Pause all AI calls
            </Button>
            <p className="text-xs text-muted-foreground">Writes ai_kill_switch=true to system_flags. Edge functions can short-circuit on it.</p>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="audit">
          <AuditTable source={{ kind: 'llm_call_logs' }} title="Source: llm_call_logs (all providers)" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

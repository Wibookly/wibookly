import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Activity, DollarSign, Zap, Users as UsersIcon, RefreshCw, Download } from 'lucide-react';

interface UsageRow {
  id: string;
  user_id: string | null;
  provider: string;
  model: string;
  action: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  created_at: string;
}

interface UserMeta {
  user_id: string;
  email: string;
  full_name: string | null;
}

const RANGES = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

function fmtMoney(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 });
}

function fmtTokens(v: number) {
  if (v > 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v > 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString();
}

interface ProviderSpend {
  provider: 'openai' | 'anthropic';
  available: boolean;
  total_usd: number | null;
  currency: string;
  error?: string;
}

export default function AIUsagePanel({ organizationId }: { organizationId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30');
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [users, setUsers] = useState<Record<string, UserMeta>>({});
  const [liveSpend, setLiveSpend] = useState<ProviderSpend[] | null>(null);
  const [liveSpendLoading, setLiveSpendLoading] = useState(false);

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();

    const [{ data: usage }, { data: profiles }] = await Promise.all([
      supabase
        .from('ai_usage_logs')
        .select('id,user_id,provider,model,action,prompt_tokens,completion_tokens,total_tokens,cost_usd,created_at')
        .eq('organization_id', organizationId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase
        .from('user_profiles')
        .select('user_id,email,full_name')
        .eq('organization_id', organizationId),
    ]);

    setRows((usage as UsageRow[]) ?? []);
    const userMap: Record<string, UserMeta> = {};
    (profiles ?? []).forEach((p) => { userMap[p.user_id] = p as UserMeta; });
    setUsers(userMap);
    setLoading(false);
  }

  // Pulls live org-wide spend directly from OpenAI + Anthropic billing APIs.
  // Server returns a per-provider breakdown with friendly errors when an admin
  // billing key isn't configured, so we always render *something*.
  async function loadLiveSpend() {
    setLiveSpendLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('live-ai-cost', {
        body: { days: parseInt(range) },
        method: 'POST',
      });
      if (error) throw error;
      setLiveSpend((data?.providers as ProviderSpend[]) ?? []);
    } catch (e) {
      console.warn('live-ai-cost failed', e);
      setLiveSpend([]);
    } finally {
      setLiveSpendLoading(false);
    }
  }

  useEffect(() => { load(); loadLiveSpend(); }, [organizationId, range]);


  const totals = useMemo(() => {
    const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const totalTokens = rows.reduce((s, r) => s + Number(r.total_tokens || 0), 0);
    const callCount = rows.length;
    const activeUsers = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;
    return { totalCost, totalTokens, callCount, activeUsers };
  }, [rows]);

  const perUser = useMemo(() => {
    const map = new Map<string, { user_id: string; calls: number; tokens: number; cost: number; byProvider: Record<string, number> }>();
    rows.forEach((r) => {
      const key = r.user_id ?? 'system';
      const ex = map.get(key) ?? { user_id: key, calls: 0, tokens: 0, cost: 0, byProvider: {} };
      ex.calls += 1;
      ex.tokens += r.total_tokens;
      ex.cost += Number(r.cost_usd || 0);
      ex.byProvider[r.provider] = (ex.byProvider[r.provider] ?? 0) + Number(r.cost_usd || 0);
      map.set(key, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [rows]);

  const perAction = useMemo(() => {
    const map = new Map<string, { action: string; calls: number; cost: number }>();
    rows.forEach((r) => {
      const ex = map.get(r.action) ?? { action: r.action, calls: 0, cost: 0 };
      ex.calls += 1;
      ex.cost += Number(r.cost_usd || 0);
      map.set(r.action, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [rows]);

  function exportCsv() {
    const header = ['Time', 'User', 'Email', 'Provider', 'Model', 'Action', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', 'Cost USD'];
    const lines = rows.map((r) => {
      const u = r.user_id ? users[r.user_id] : null;
      return [
        new Date(r.created_at).toISOString(),
        u?.full_name ?? '',
        u?.email ?? r.user_id ?? 'system',
        r.provider,
        r.model,
        r.action,
        r.prompt_tokens,
        r.completion_tokens,
        r.total_tokens,
        Number(r.cost_usd).toFixed(6),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-usage-${range}d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">AI Usage & Cost</h2>
          <p className="text-sm text-muted-foreground">Per-user breakdown across OpenAI, Claude and other models</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard icon={<DollarSign className="w-4 h-4" />} label="Total cost (logged)" value={fmtMoney(totals.totalCost)} />
        <SummaryCard icon={<Zap className="w-4 h-4" />} label="Total tokens" value={fmtTokens(totals.totalTokens)} />
        <SummaryCard icon={<Activity className="w-4 h-4" />} label="API calls" value={totals.callCount.toLocaleString()} />
        <SummaryCard icon={<UsersIcon className="w-4 h-4" />} label="Active users" value={totals.activeUsers.toString()} />
      </div>

      {/* Live provider spend (org-wide) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Live provider spend</CardTitle>
              <CardDescription>
                Org-wide totals pulled directly from OpenAI and Anthropic billing APIs for the selected period.
              </CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={loadLiveSpend} disabled={liveSpendLoading}>
              {liveSpendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {liveSpendLoading && !liveSpend ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(liveSpend ?? []).map((p) => (
                <div
                  key={p.provider}
                  className="rounded-lg border border-border bg-background p-4 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold capitalize">{p.provider}</span>
                    {p.available ? (
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                        Live
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Unavailable
                      </Badge>
                    )}
                  </div>
                  {p.available ? (
                    <div className="text-2xl font-semibold tabular-nums">
                      {fmtMoney(p.total_usd ?? 0)}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {p.error || 'Live spend not available for this provider yet.'}
                    </p>
                  )}
                </div>
              ))}
              {(!liveSpend || liveSpend.length === 0) && (
                <p className="text-sm text-muted-foreground py-2">
                  Live spend service unavailable. Per-user totals below are computed from logged usage.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>


      {/* By user */}
      <Card>
        <CardHeader>
          <CardTitle>Cost per user</CardTitle>
          <CardDescription>Total spend, tokens used and call volume per active user</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : perUser.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No AI activity recorded in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead>Providers</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perUser.map((u) => {
                  const meta = users[u.user_id];
                  return (
                    <TableRow key={u.user_id}>
                      <TableCell>
                        <div className="font-medium">{meta?.full_name ?? meta?.email ?? u.user_id.slice(0, 8)}</div>
                        {meta?.email && <div className="text-xs text-muted-foreground">{meta.email}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{u.calls.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(u.tokens)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(u.byProvider).map(([p, c]) => (
                            <Badge key={p} variant="secondary" className="text-[10px]">
                              {p} · {fmtMoney(c)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmtMoney(u.cost)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* By action */}
      <Card>
        <CardHeader>
          <CardTitle>Cost by action</CardTitle>
          <CardDescription>Where the spend is going (drafts, auto-replies, agent, chat, etc.)</CardDescription>
        </CardHeader>
        <CardContent>
          {perAction.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No data.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perAction.map((a) => (
                  <TableRow key={a.action}>
                    <TableCell><Badge variant="outline">{a.action}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{a.calls.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{fmtMoney(a.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold mt-1">{value}</p>
          </div>
          <div className="rounded-full bg-primary/10 text-primary p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

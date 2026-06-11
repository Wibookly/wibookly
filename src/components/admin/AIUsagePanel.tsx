import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Activity, DollarSign, Zap, Users as UsersIcon, RefreshCw, Download, Info } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip as ReTooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts';

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
  department: string | null;
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
        .select('user_id,email,full_name,department')
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

  // Weekly aggregation (ISO week starting Monday UTC) — supports the new
  // weekly limit_term in enforce_llm_limits so admins can see usage in the
  // same window the limiter uses.
  const perWeek = useMemo(() => {
    const map = new Map<string, { week: string; calls: number; cost: number }>();
    rows.forEach((r) => {
      const d = new Date(r.created_at);
      // Monday-of-week (UTC)
      const day = d.getUTCDay();
      const diff = (day === 0 ? -6 : 1 - day);
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
      const key = monday.toISOString().slice(0, 10);
      const ex = map.get(key) ?? { week: key, calls: 0, cost: 0 };
      ex.calls += 1;
      ex.cost += Number(r.cost_usd || 0);
      map.set(key, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.week.localeCompare(a.week));
  }, [rows]);

  // Feature × user matrix: shows the top spenders per feature. Useful for
  // spotting users about to hit a daily/weekly limit (paired with the
  // QuotaBadge surfaced in the user-facing pages).
  const featureUserBreakdown = useMemo(() => {
    const byFeat = new Map<string, Map<string, { calls: number; cost: number }>>();
    rows.forEach((r) => {
      if (!r.user_id) return;
      const inner = byFeat.get(r.action) ?? new Map();
      const ex = inner.get(r.user_id) ?? { calls: 0, cost: 0 };
      ex.calls += 1;
      ex.cost += Number(r.cost_usd || 0);
      inner.set(r.user_id, ex);
      byFeat.set(r.action, inner);
    });
    return Array.from(byFeat.entries())
      .map(([action, users]) => ({
        action,
        topUsers: Array.from(users.entries())
          .map(([uid, v]) => ({ user_id: uid, ...v }))
          .sort((a, b) => b.calls - a.calls)
          .slice(0, 5),
        totalCalls: Array.from(users.values()).reduce((s, u) => s + u.calls, 0),
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls);
  }, [rows]);

  // --- chart aggregations (mirror the Activity report's visual language) ---
  const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

  // Daily cost timeseries
  const dailyCostSeries = useMemo(() => {
    const map = new Map<string, { day: string; cost: number; calls: number }>();
    rows.forEach((r) => {
      const day = r.created_at.slice(0, 10);
      const ex = map.get(day) ?? { day, cost: 0, calls: 0 };
      ex.cost += Number(r.cost_usd || 0);
      ex.calls += 1;
      map.set(day, ex);
    });
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
      .map(d => ({ ...d, day: d.day.slice(5), cost: Number(d.cost.toFixed(4)) }));
  }, [rows]);

  // Cost by provider (pie)
  const costByProvider = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach(r => map.set(r.provider, (map.get(r.provider) ?? 0) + Number(r.cost_usd || 0)));
    return Array.from(map.entries())
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value: Number(value.toFixed(4)) }));
  }, [rows]);

  // Cost by model (bar)
  const costByModel = useMemo(() => {
    const map = new Map<string, { model: string; cost: number; calls: number }>();
    rows.forEach(r => {
      const ex = map.get(r.model) ?? { model: r.model || 'unknown', cost: 0, calls: 0 };
      ex.cost += Number(r.cost_usd || 0);
      ex.calls += 1;
      map.set(r.model, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost).slice(0, 10)
      .map(d => ({ ...d, cost: Number(d.cost.toFixed(4)) }));
  }, [rows]);

  // Cost by feature/action (bar)
  const costByFeature = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach(r => map.set(r.action, (map.get(r.action) ?? 0) + Number(r.cost_usd || 0)));
    return Array.from(map.entries())
      .filter(([, v]) => v > 0)
      .map(([action, cost]) => ({ action, cost: Number(cost.toFixed(4)) }))
      .sort((a, b) => b.cost - a.cost);
  }, [rows]);

  // Cost by department (bar)
  const costByDepartment = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach(r => {
      const dept = (r.user_id && users[r.user_id]?.department) || 'Unassigned';
      map.set(dept, (map.get(dept) ?? 0) + Number(r.cost_usd || 0));
    });
    return Array.from(map.entries())
      .filter(([, v]) => v > 0)
      .map(([department, cost]) => ({ department, cost: Number(cost.toFixed(4)) }))
      .sort((a, b) => b.cost - a.cost);
  }, [rows, users]);

  // Feature × Provider matrix — answers "what AI vendor does each feature use,
  // and how much is each one costing me?". One row per feature, one column per
  // provider (openai / anthropic / google / lovable_ai), plus a total.
  const featureProviderMatrix = useMemo(() => {
    const providers = new Set<string>();
    const map = new Map<string, { action: string; calls: number; cost: number; perProvider: Record<string, { calls: number; cost: number; models: Set<string> }> }>();
    rows.forEach((r) => {
      providers.add(r.provider);
      const ex = map.get(r.action) ?? { action: r.action, calls: 0, cost: 0, perProvider: {} };
      ex.calls += 1;
      ex.cost += Number(r.cost_usd || 0);
      const pp = ex.perProvider[r.provider] ?? { calls: 0, cost: 0, models: new Set<string>() };
      pp.calls += 1;
      pp.cost += Number(r.cost_usd || 0);
      if (r.model) pp.models.add(r.model);
      ex.perProvider[r.provider] = pp;
      map.set(r.action, ex);
    });
    return {
      providers: Array.from(providers).sort(),
      rows: Array.from(map.values()).sort((a, b) => b.cost - a.cost),
    };
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

      {/* Accuracy methodology — explains exactly how the number is computed */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
            <div className="text-xs leading-relaxed text-muted-foreground space-y-2">
              <p className="text-foreground font-medium">How we measure AI cost</p>
              <p>
                Every AI call the app makes goes through one shared accounting helper
                (<code className="px-1 rounded bg-muted">recordSpend</code>) that writes a row to
                <code className="px-1 rounded bg-muted"> ai_usage_logs</code> with:
                <span className="font-medium"> user, organization, feature, provider, model,
                prompt tokens, completion tokens</span> and a computed
                <span className="font-medium"> cost_usd</span>.
              </p>
              <p>
                <span className="font-medium text-foreground">cost_usd</span> ={' '}
                <code className="px-1 rounded bg-muted">(prompt_tokens × input_price + completion_tokens × output_price) ÷ 1,000,000</code>{' '}
                using each vendor's published per-million-token rates (OpenAI, Anthropic,
                Google Gemini via Lovable AI Gateway, Llama, Phi). Tokens come from the model
                response's <code className="px-1 rounded bg-muted">usage</code> block — the same
                counter the vendor bills from — so the "Logged cost" total below matches the
                vendor invoice within rounding (and minus prompt-cache discounts the vendor
                applies after the fact).
              </p>
              <p>
                <span className="font-medium text-foreground">Live provider spend</span> (further
                below) hits each vendor's billing API directly and is the authoritative number.
                Use the logged numbers for per-user / per-feature / per-department breakdowns
                — the vendor billing APIs don't expose those.
              </p>
              <p className="text-amber-600/90 dark:text-amber-400/80">
                If a feature shows <span className="font-medium">$0.00</span> with non-zero calls,
                it means the model id used (e.g. a brand-new Gemini preview) isn't priced in
                <code className="px-1 rounded bg-muted">_shared/enforce-limits.ts → MODEL_COSTS</code>{' '}
                yet — add it there and the next call will price correctly.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Daily cost trend</CardTitle>
            <CardDescription>Logged AI spend per day (USD)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              {dailyCostSeries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center pt-20">No activity in this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyCostSeries}>
                    <defs>
                      <linearGradient id="ai-cost-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <ReTooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                    />
                    <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="url(#ai-cost-gradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cost by provider</CardTitle>
            <CardDescription>Where your spend lives</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              {costByProvider.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center pt-20">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={costByProvider} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {costByProvider.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <ReTooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cost by model</CardTitle>
            <CardDescription>Top 10 models by spend</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {costByModel.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center pt-24">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costByModel} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="model" tick={{ fontSize: 11 }} width={140} />
                    <ReTooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                    />
                    <Bar dataKey="cost" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cost by feature</CardTitle>
            <CardDescription>Which features drive the bill</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {costByFeature.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center pt-24">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costByFeature} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="action" tick={{ fontSize: 11 }} width={140} />
                    <ReTooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                    />
                    <Bar dataKey="cost" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cost by department</CardTitle>
          <CardDescription>Aggregates per-user spend by their assigned department</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            {costByDepartment.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center pt-20">No department data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costByDepartment} margin={{ left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <ReTooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                  />
                  <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Feature × Provider matrix — which AI vendor each app feature is using */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Feature × AI vendor breakdown</CardTitle>
          <CardDescription>
            For each app feature: which AI vendor(s) it called, how many calls, which
            model(s), and how much each vendor was charged. Hover a model badge to see
            the full id.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {featureProviderMatrix.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No data in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    {featureProviderMatrix.providers.map((p) => (
                      <TableHead key={p} className="capitalize">{p.replace('_', ' ')}</TableHead>
                    ))}
                    <TableHead className="text-right">Total cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {featureProviderMatrix.rows.map((r) => (
                    <TableRow key={r.action}>
                      <TableCell>
                        <Badge variant="outline">{r.action}</Badge>
                        <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                          {r.calls.toLocaleString()} calls
                        </div>
                      </TableCell>
                      {featureProviderMatrix.providers.map((p) => {
                        const pp = r.perProvider[p];
                        if (!pp) {
                          return <TableCell key={p} className="text-muted-foreground">—</TableCell>;
                        }
                        return (
                          <TableCell key={p}>
                            <div className="text-sm font-medium tabular-nums">{fmtMoney(pp.cost)}</div>
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              {pp.calls.toLocaleString()} calls
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Array.from(pp.models).slice(0, 3).map((m) => (
                                <Badge key={m} variant="secondary" className="text-[9px]" title={m}>
                                  {m.length > 22 ? `${m.slice(0, 22)}…` : m}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(r.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>




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

      {/* Weekly view — matches the new weekly limit_term window */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly totals</CardTitle>
          <CardDescription>Calls and cost per ISO week (Monday–Sunday UTC), matching the weekly limit window.</CardDescription>
        </CardHeader>
        <CardContent>
          {perWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No data.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week of</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perWeek.map((w) => (
                  <TableRow key={w.week}>
                    <TableCell className="font-medium tabular-nums">{w.week}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.calls.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{fmtMoney(w.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Per-feature top users — helps spot who is approaching their limit */}
      <Card>
        <CardHeader>
          <CardTitle>Top users per feature</CardTitle>
          <CardDescription>The 5 highest-volume users for each feature. Pair with the user's plan limits to see who's near a cap.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {featureUserBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No data.</p>
          ) : (
            featureUserBreakdown.map((f) => (
              <div key={f.action} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline">{f.action}</Badge>
                  <span className="text-xs text-muted-foreground">{f.totalCalls.toLocaleString()} calls total</span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {f.topUsers.map((u) => {
                    const meta = users[u.user_id];
                    return (
                      <div key={u.user_id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-muted/40">
                        <span className="truncate" title={meta?.email ?? u.user_id}>
                          {meta?.full_name ?? meta?.email ?? u.user_id.slice(0, 8)}
                        </span>
                        <span className="tabular-nums shrink-0">{u.calls} · {fmtMoney(u.cost)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
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

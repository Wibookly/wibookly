import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Loader2, Download } from 'lucide-react';

type Range = 'live' | '24h' | '7d' | '30d' | 'custom';

interface UsageRow {
  id: string;
  user_id: string | null;
  organization_id: string;
  domain_id: string | null;
  group_id: string | null;
  action: string;
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number | null;
  cost_usd: number;
  status: string | null;
  block_reason: string | null;
  error_message: string | null;
  latency_ms: number | null;
  created_at: string;
}

interface Lookup {
  users: Record<string, { name: string; email: string }>;
  groups: Record<string, string>;
  domains: Record<string, string>;
}

const FEATURES: Array<{ value: string; label: string }> = [
  { value: 'ai_draft', label: 'AI Draft' },
  { value: 'ai_auto_reply', label: 'AI Auto-Reply' },
  { value: 'ai_assistant', label: 'AI Chat' },
  { value: 'daily_brief', label: 'Daily Brief' },
  { value: 'reports', label: 'Activity Reports' },
  { value: 'email_agent', label: 'Email Agent' },
  { value: 'teams_agent', label: 'Teams Agent' },
  { value: 'feature.follow_up_reminder', label: 'No-Reply Tracker' },
  { value: 'documents', label: 'Documents (PDF/Word)' },
  { value: 'powerpoints', label: 'PowerPoints' },
  { value: 'excel', label: 'Excel files' },
  { value: 'file_review', label: 'File review' },
];

const featureLabel = (k: string) => FEATURES.find((f) => f.value === k)?.label ?? k;

function relTime(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 5) return 'just now';
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function modelLabel(m: string): string {
  if (!m) return '—';
  return m
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^claude-([a-z]+)-?(\d+)?-?(\d+)?.*$/i, (_, n, a, b) =>
      `${n[0].toUpperCase()}${n.slice(1)}${a ? ` ${a}${b ? '.' + b : ''}` : ''}`,
    );
}

function rangeStart(range: Range, customFrom?: string): Date {
  const now = Date.now();
  switch (range) {
    case 'live': return new Date(now - 60 * 60 * 1000);
    case '24h': return new Date(now - 24 * 60 * 60 * 1000);
    case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case 'custom': return customFrom ? new Date(customFrom) : new Date(now - 7 * 24 * 60 * 60 * 1000);
  }
}

export default function AIUsageTab({ organizationId }: { organizationId: string | null }) {
  const [range, setRange] = useState<Range>('live');
  const [customFrom, setCustomFrom] = useState(() =>
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  );
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [customError, setCustomError] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const [feature, setFeature] = useState<string>('all');
  const [plan, setPlan] = useState<string>('all');
  const [domain, setDomain] = useState<string>('all');
  const [user, setUser] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');

  const [rows, setRows] = useState<UsageRow[]>([]);
  const [lookup, setLookup] = useState<Lookup>({ users: {}, groups: {}, domains: {} });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0); // re-render for relative times

  const filtersRef = useRef({ feature, plan, domain, user, status });
  filtersRef.current = { feature, plan, domain, user, status };

  // Tick for relative time updates
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // Load lookup tables (users/groups/domains)
  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      const [u, g, d] = await Promise.all([
        supabase.rpc('get_org_user_directory', { _organization_id: organizationId }),
        supabase.from('permission_groups').select('id, name').eq('organization_id', organizationId),
        supabase.from('allowed_domains').select('id, domain').eq('is_active', true),
      ]);
      const formatName = (full: string | null, email: string | null) => {
        const src = (full || '').trim();
        if (src) {
          const parts = src.split(/\s+/);
          const first = parts[0];
          const lastInitial = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : '';
          return lastInitial ? `${first} ${lastInitial}.` : first;
        }
        return (email || '').split('@')[0] || '';
      };
      const users: Lookup['users'] = {};
      (u.data ?? []).forEach((p: any) => {
        users[p.user_id] = { name: formatName(p.full_name, p.email), email: p.email || '' };
      });
      const groups: Lookup['groups'] = {};
      (g.data ?? []).forEach((p: any) => { groups[p.id] = p.name; });
      const domains: Lookup['domains'] = {};
      (d.data ?? []).forEach((p: any) => { domains[p.id] = p.domain; });
      setLookup({ users, groups, domains });
    })();
  }, [organizationId]);

  const fetchRows = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const start = rangeStart(range, customFrom);
    const end = range === 'custom' ? new Date(`${customTo}T23:59:59`) : new Date();

    let q = supabase
      .from('ai_usage_logs')
      .select('id,user_id,organization_id,domain_id,group_id,action,model,provider,prompt_tokens,completion_tokens,total_tokens,cost_usd,status,block_reason,error_message,latency_ms,created_at')
      .eq('organization_id', organizationId)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .limit(range === 'live' ? 50 : 500);

    const f = filtersRef.current;
    if (f.feature !== 'all') q = q.eq('action', f.feature);
    if (f.plan !== 'all') q = q.eq('group_id', f.plan);
    if (f.domain !== 'all') q = q.eq('domain_id', f.domain);
    if (f.user !== 'all') q = q.eq('user_id', f.user);
    if (f.status !== 'all') q = q.eq('status', f.status);

    const { data } = await q;
    setRows((data as UsageRow[]) ?? []);
    setLoading(false);
  }, [organizationId, range, customFrom, customTo]);

  useEffect(() => { void fetchRows(); }, [fetchRows, feature, plan, domain, user, status]);

  // Polling for non-live ranges
  useEffect(() => {
    if (range === 'live' || range === 'custom') return;
    const interval = range === '24h' ? 30000 : 60000;
    const id = setInterval(() => void fetchRows(), interval);
    return () => clearInterval(id);
  }, [range, fetchRows]);

  // Realtime subscription for live mode
  useEffect(() => {
    if (range !== 'live' || !organizationId) return;
    const channel = supabase
      .channel('ai_usage_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ai_usage_logs', filter: `organization_id=eq.${organizationId}` },
        (payload) => {
          const r = payload.new as UsageRow;
          const f = filtersRef.current;
          if (f.feature !== 'all' && r.action !== f.feature) return;
          if (f.plan !== 'all' && r.group_id !== f.plan) return;
          if (f.domain !== 'all' && r.domain_id !== f.domain) return;
          if (f.user !== 'all' && r.user_id !== f.user) return;
          if (f.status !== 'all' && r.status !== f.status) return;
          setRows((prev) => [r, ...prev.filter((p) => p.id !== r.id)].slice(0, 50));
          setFlashing((prev) => new Set(prev).add(r.id));
          setTimeout(() => {
            setFlashing((prev) => { const n = new Set(prev); n.delete(r.id); return n; });
          }, 700);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [range, organizationId]);

  const totals = useMemo(() => {
    const calls = rows.length;
    const tokens = rows.reduce((s, r) => s + (r.total_tokens ?? r.prompt_tokens + r.completion_tokens), 0);
    const cost = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const activeUsers = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;
    const planCount = new Set(rows.map((r) => r.group_id).filter(Boolean)).size;
    const recent5min = rows.filter((r) => Date.now() - new Date(r.created_at).getTime() < 5 * 60 * 1000).length;
    return { calls, tokens, cost, activeUsers, planCount, recent5min };
  }, [rows]);

  const userOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; name: string }> = [];
    for (const r of rows) {
      if (r.user_id && !seen.has(r.user_id)) {
        seen.add(r.user_id);
        list.push({ id: r.user_id, name: lookup.users[r.user_id]?.name || 'Unknown' });
        if (list.length >= 50) break;
      }
    }
    return list;
  }, [rows, lookup]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const applyCustom = () => {
    const f = new Date(customFrom);
    const t = new Date(customTo);
    if (f > t) { setCustomError('From cannot be after To'); return; }
    if ((t.getTime() - f.getTime()) / 86400000 > 90) { setCustomError('Range cannot exceed 90 days'); return; }
    setCustomError(null);
    setRange('custom');
    setPopoverOpen(false);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const cols = ['timestamp_iso', 'user_name', 'user_email', 'feature', 'model', 'input_tokens', 'output_tokens', 'total_tokens', 'cost', 'status', 'block_reason', 'error_message', 'latency_ms', 'plan', 'domain'];
      const lines = [cols.join(',')];
      for (const r of rows) {
        const u = r.user_id ? lookup.users[r.user_id] : null;
        const vals = [
          r.created_at,
          u?.name ?? '',
          u?.email ?? '',
          featureLabel(r.action),
          r.model,
          r.prompt_tokens,
          r.completion_tokens,
          r.total_tokens ?? r.prompt_tokens + r.completion_tokens,
          Number(r.cost_usd).toFixed(6),
          r.status ?? 'success',
          r.block_reason ?? '',
          r.error_message ?? '',
          r.latency_ms ?? '',
          r.group_id ? lookup.groups[r.group_id] ?? '' : '',
          r.domain_id ? lookup.domains[r.domain_id] ?? '' : '',
        ];
        lines.push(vals.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-usage-${range}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const subtitle = range === 'live'
    ? `Showing ${rows.length} most recent · auto-refresh via Realtime`
    : range === 'custom'
      ? `Showing ${rows.length} entries · custom range`
      : `Showing ${rows.length} entries · last ${range}`;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">AI Usage</h2>
            <p className="text-[12.5px] text-muted-foreground">Every AI call across email, Teams, chat — with tokens and cost.</p>
          </div>
          {range === 'live' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-medium rounded-full bg-destructive/10 text-destructive">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
              Live
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting || rows.length === 0}>
          {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
          Export CSV
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Calls (period)" value={totals.calls.toLocaleString()} sub={`${totals.recent5min} in last 5 min`} />
        <Kpi label="Total tokens" value={totals.tokens.toLocaleString()} sub={`avg ${totals.calls ? Math.round(totals.tokens / totals.calls).toLocaleString() : 0} / call`} />
        <Kpi label="Cost (period)" value={`$${totals.cost.toFixed(2)}`} sub={`$${totals.calls ? (totals.cost / totals.calls).toFixed(3) : '0.000'} / call avg`} accent />
        <Kpi label="Active users" value={totals.activeUsers.toString()} sub={`across ${totals.planCount} plan${totals.planCount === 1 ? '' : 's'}`} />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap p-2.5 bg-muted/50 rounded-md">
        <div className="inline-flex p-0.5 bg-muted rounded-md gap-0.5">
          {(['live', '24h', '7d', '30d'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                range === r ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r === 'live' ? 'Live' : r}
            </button>
          ))}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  range === 'custom' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Custom
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">From</label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">To</label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs" />
              </div>
              {customError && <p className="text-xs text-destructive">{customError}</p>}
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setPopoverOpen(false)}>Cancel</Button>
                <Button size="sm" variant="outline" onClick={applyCustom}>Apply</Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <span className="w-px h-5 bg-border mx-1" />

        <FilterSelect value={feature} onChange={setFeature} placeholder="All features"
          options={[{ value: 'all', label: 'All features' }, ...FEATURES]} />
        <FilterSelect value={plan} onChange={setPlan} placeholder="All plans"
          options={[{ value: 'all', label: 'All plans' }, ...Object.entries(lookup.groups).map(([id, name]) => ({ value: id, label: name }))]} />
        <FilterSelect value={domain} onChange={setDomain} placeholder="All domains"
          options={[{ value: 'all', label: 'All domains' }, ...Object.entries(lookup.domains).map(([id, d]) => ({ value: id, label: d }))]} />
        <FilterSelect value={user} onChange={setUser} placeholder="All users"
          options={[{ value: 'all', label: 'All users' }, ...userOptions.map((u) => ({ value: u.id, label: u.name }))]} />
        <FilterSelect value={status} onChange={setStatus} placeholder="All statuses"
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'success', label: 'Success' },
            { value: 'blocked', label: 'Blocked' },
            { value: 'error', label: 'Error' },
          ]} />
      </div>

      {/* Activity feed */}
      <div className="bg-background border rounded-lg overflow-hidden">
        <div className="flex justify-between items-center gap-2.5 px-4 py-3 border-b">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[15px] font-semibold">Activity feed</h3>
            <span className="text-[11.5px] text-muted-foreground">{subtitle}</span>
          </div>
        </div>

        <div
          className="grid gap-2.5 px-4 py-2 bg-muted/50 border-b text-[10.5px] text-muted-foreground font-medium uppercase tracking-wide"
          style={{ gridTemplateColumns: '92px minmax(0, 1.4fr) minmax(0, 1.2fr) minmax(0, 1fr) 70px 80px 80px 30px' }}
        >
          <div>Time</div><div>User</div><div>Feature</div><div>Model</div>
          <div className="text-right">Tokens</div><div className="text-right">Cost</div><div>Status</div><div />
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {feature !== 'all' || plan !== 'all' || domain !== 'all' || user !== 'all' || status !== 'all'
              ? 'No matches — try clearing filters'
              : 'No usage in this period'}
          </div>
        ) : (
          rows.map((r) => {
            const isExp = expanded.has(r.id);
            const isFlash = flashing.has(r.id);
            const u = r.user_id ? lookup.users[r.user_id] : null;
            const name = u?.name || 'Unknown';
            const tokens = r.total_tokens ?? r.prompt_tokens + r.completion_tokens;
            const st = r.status || 'success';
            return (
              <div key={r.id}>
                <div
                  onClick={() => toggleExpand(r.id)}
                  className={`grid gap-2.5 px-4 py-2.5 border-b text-xs items-center cursor-pointer hover:bg-muted/40 transition-colors ${isFlash ? 'bg-primary/10' : ''}`}
                  style={{ gridTemplateColumns: '92px minmax(0, 1.4fr) minmax(0, 1.2fr) minmax(0, 1fr) 70px 80px 80px 30px' }}
                >
                  <div className="text-[11px] text-muted-foreground tabular-nums">{relTime(r.created_at)}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0">
                      {initials(name)}
                    </div>
                    <div className="font-medium truncate">{name}</div>
                  </div>
                  <div>
                    <span className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-muted text-muted-foreground">
                      {featureLabel(r.action)}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-muted-foreground truncate">{modelLabel(r.model)}</div>
                  <div className="text-right tabular-nums">{tokens.toLocaleString()}</div>
                  <div className="text-right tabular-nums">${Number(r.cost_usd).toFixed(4)}</div>
                  <div>
                    <span className={`inline-flex px-2 py-0.5 text-[10.5px] font-medium rounded ${
                      st === 'success' ? 'bg-emerald-500/10 text-emerald-600'
                      : st === 'blocked' ? 'bg-destructive/10 text-destructive'
                      : 'bg-amber-500/10 text-amber-600'
                    }`}>{st}</span>
                  </div>
                  <div className={`text-muted-foreground text-[10px] text-center transition-transform ${isExp ? 'rotate-90' : ''}`}>▸</div>
                </div>
                {isExp && (
                  <div className="bg-muted/50 border-b text-[11.5px]" style={{ padding: '12px 16px 14px 56px' }}>
                    <div className="grid gap-y-1 gap-x-3" style={{ gridTemplateColumns: '110px 1fr' }}>
                      <div className="text-muted-foreground">Input tokens</div>
                      <div className="tabular-nums">{r.prompt_tokens.toLocaleString()}</div>
                      <div className="text-muted-foreground">Output tokens</div>
                      <div className="tabular-nums">{r.completion_tokens.toLocaleString()}</div>
                      <div className="text-muted-foreground">Total tokens</div>
                      <div className="tabular-nums">{tokens.toLocaleString()}</div>
                      <div className="text-muted-foreground">Cost</div>
                      <div className="tabular-nums">${Number(r.cost_usd).toFixed(4)}</div>
                      {r.latency_ms != null && (<>
                        <div className="text-muted-foreground">Latency</div>
                        <div className="tabular-nums">{r.latency_ms.toLocaleString()} ms</div>
                      </>)}
                      {r.group_id && (<>
                        <div className="text-muted-foreground">Plan</div>
                        <div>{lookup.groups[r.group_id] ?? '—'}</div>
                      </>)}
                      {r.domain_id && (<>
                        <div className="text-muted-foreground">Domain</div>
                        <div>{lookup.domains[r.domain_id] ?? '—'}</div>
                      </>)}
                      {st === 'blocked' && r.block_reason && (<>
                        <div className="text-muted-foreground">Block reason</div>
                        <div className="text-destructive">{r.block_reason}</div>
                      </>)}
                      {st === 'error' && r.error_message && (<>
                        <div className="text-muted-foreground">Error</div>
                        <div className="text-amber-600">{r.error_message}</div>
                      </>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11.5px] text-muted-foreground pt-2 border-t">
        Live feed reads ai_usage_logs · auto-refresh via Supabase Realtime · click any row to expand details
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="bg-muted/50 rounded-md px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`font-medium tabular-nums ${accent ? 'text-[21px] text-primary' : 'text-[17px]'}`}>{value}</div>
      <div className="text-[10.5px] text-muted-foreground/70 mt-0.5 tabular-nums">{sub}</div>
    </div>
  );
}

function FilterSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-[30px] w-auto min-w-[130px] text-xs px-2"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

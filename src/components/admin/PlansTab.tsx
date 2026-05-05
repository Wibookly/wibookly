import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Loader2, Plus, MoreHorizontal, Trash2, Copy, Globe, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

/* ------------------------------------------------------------------
 * Plans tab — full redesign per `lovable-prompt-plans-section-redesign-v4.md`
 * Visual fidelity target: `plans-v4-visual-reference.html`.
 * Uses inline CSS variables so the dense visual palette doesn't bleed
 * into the rest of the app theme.
 * ------------------------------------------------------------------ */

const FEATURE_LABELS: Record<string, string> = {
  ai_draft: 'AI Draft',
  ai_auto_reply: 'AI Auto-Reply',
  ai_chat: 'AI Chat',
  daily_brief: 'Daily Brief',
  activity_reports: 'Activity Reports',
  email_agent: 'Email Agent',
  teams_agent: 'Teams Agent',
  follow_up_reminder: 'No-Reply Tracker',
  documents: 'Documents (PDF/Word)',
  powerpoints: 'PowerPoints',
  excel: 'Excel files',
  file_review: 'File review',
};

const FEATURE_ORDER = [
  'ai_draft', 'ai_auto_reply', 'ai_chat', 'daily_brief', 'activity_reports',
  'email_agent', 'teams_agent', 'follow_up_reminder', 'documents', 'powerpoints',
  'excel', 'file_review',
];

const ALLOWED_MODELS: Record<string, string[]> = {
  ai_draft: ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  ai_auto_reply: ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.5'],
  ai_chat: ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.5'],
  daily_brief: ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  activity_reports: ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.5'],
  email_agent: ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.5'],
  teams_agent: ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.5'],
  follow_up_reminder: ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  documents: ['claude-sonnet-4.5', 'gpt-4.1', 'llama-3.3-70b'],
  powerpoints: ['claude-sonnet-4.5', 'gpt-4.1', 'llama-3.3-70b'],
  excel: ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.5'],
  file_review: ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.5'],
};

const MODEL_LABELS: Record<string, string> = {
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1-mini',
  'phi-4': 'Phi-4',
  'claude-sonnet-4.5': 'Sonnet 4.5',
  'llama-3.3-70b': 'Llama 3.3-70B',
};

const PLAN_DOTS: Record<string, string> = {
  Chat: 'var(--text-secondary)',
  Standard: 'var(--text-info)',
  'Power User': 'var(--text-success)',
  Executive: 'var(--text-warning)',
};

interface Plan {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  domain_id: string | null;
  scope_domain: string | null;
  price_per_user_mo: number;
  max_categories: number;
  display_order: number | null;
}
interface FeatureRow {
  id?: string;
  group_id: string;
  feature_key: string;
  is_enabled: boolean;
  daily_limit: number;
  model_assignment: string | null;
  limit_term: 'daily' | 'weekly';
  rollover: 'none' | 'next_day';
}
interface PricingRow { feature_id: string; model_id: string; dollar_per_task: number; last_updated: string }
interface DomainRow { id: string; domain: string; organization_name: string | null; last_directory_sync_at: string | null }
interface ActiveUser {
  user_id: string; email: string; display_name: string;
  group_id: string;
  monthly_tasks: number;
  monthly_spend: number;
  last_activity: string | null;
}

const ROOT_STYLE: React.CSSProperties = {
  // Dense visual palette (scoped to this component only).
  ['--bg-primary' as any]: '#ffffff',
  ['--bg-secondary' as any]: '#f5f6f8',
  ['--bg-info' as any]: '#e0f2fe',
  ['--bg-success' as any]: '#dcfce7',
  ['--text-primary' as any]: '#0f172a',
  ['--text-secondary' as any]: '#475569',
  ['--text-tertiary' as any]: '#94a3b8',
  ['--text-info' as any]: '#0284c7',
  ['--text-success' as any]: '#16a34a',
  ['--text-warning' as any]: '#d97706',
  ['--text-error' as any]: '#dc2626',
  ['--border-tertiary' as any]: '#e5e7eb',
  ['--border-secondary' as any]: '#d1d5db',
  ['--radius-md' as any]: '8px',
  ['--radius-lg' as any]: '12px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: 'var(--text-primary)',
};

function dailyTasks(cfg: FeatureRow): number {
  if (!cfg.is_enabled) return 0;
  return cfg.limit_term === 'weekly' ? (cfg.daily_limit || 0) / 5 : (cfg.daily_limit || 0);
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string, email: string): string {
  const src = (name || email || '').trim();
  const parts = src.split(/\s+|[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (src.slice(0, 2) || '??').toUpperCase();
}

// ------------------------------------------------------------------

export default function PlansTab() {
  const { profile, organization } = useAuth();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [pricing, setPricing] = useState<PricingRow[]>([]);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [memberships, setMemberships] = useState<{ user_id: string; group_id: string }[]>([]);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [discoveredCount, setDiscoveredCount] = useState(0);

  const [viewDomain, setViewDomain] = useState<string>('all'); // domain id, 'admin', 'all'
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      const [p, d, pr] = await Promise.all([
        supabase.from('permission_groups').select('*').eq('organization_id', organization.id).order('display_order'),
        supabase.from('allowed_domains').select('id, domain, organization_name, last_directory_sync_at, is_active').eq('is_active', true).order('domain'),
        supabase.from('feature_model_pricing').select('*'),
      ]);
      const planRows = (p.data || []) as Plan[];
      setPlans(planRows);
      setDomains(((d.data || []) as DomainRow[]));
      setPricing((pr.data || []) as PricingRow[]);
      if (planRows.length && !planRows.find(x => x.id === selectedPlanId)) {
        setSelectedPlanId(planRows[0].id);
      }
      const ids = planRows.map(x => x.id);
      if (ids.length) {
        const [f, m] = await Promise.all([
          supabase.from('group_features').select('*').in('group_id', ids),
          supabase.from('user_group_memberships').select('user_id, group_id').in('group_id', ids),
        ]);
        setFeatures((f.data || []) as FeatureRow[]);
        setMemberships(m.data || []);

        // Active users: those in user_group_memberships, joined to user_profiles + monthly usage
        const userIds = (m.data || []).map(r => r.user_id);
        if (userIds.length) {
          const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
          const [up, logs] = await Promise.all([
            supabase.from('user_profiles').select('user_id, email, full_name').in('user_id', userIds),
            supabase.from('ai_usage_logs').select('user_id, cost_usd, created_at').in('user_id', userIds).gte('created_at', monthStart.toISOString()),
          ]);
          const profileById = new Map((up.data || []).map((u: any) => [u.user_id, u]));
          const logsByUser = new Map<string, { tasks: number; spend: number; last: string | null }>();
          (logs.data || []).forEach((l: any) => {
            const cur = logsByUser.get(l.user_id) || { tasks: 0, spend: 0, last: null };
            cur.tasks += 1;
            cur.spend += Number(l.cost_usd || 0);
            if (!cur.last || l.created_at > cur.last) cur.last = l.created_at;
            logsByUser.set(l.user_id, cur);
          });
          const rows: ActiveUser[] = (m.data || []).map(mm => {
            const u: any = profileById.get(mm.user_id);
            const usage = logsByUser.get(mm.user_id) || { tasks: 0, spend: 0, last: null };
            return {
              user_id: mm.user_id,
              email: u?.email || '',
              display_name: u?.full_name || u?.email || 'Unknown',
              group_id: mm.group_id,
              monthly_tasks: usage.tasks,
              monthly_spend: usage.spend,
              last_activity: usage.last,
            };
          });
          setActiveUsers(rows);
        } else {
          setActiveUsers([]);
        }
      } else {
        setFeatures([]); setMemberships([]); setActiveUsers([]);
      }

      // Discovered count
      const dc = await supabase
        .from('discovered_tenant_users')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .is('invited_user_id', null);
      setDiscoveredCount(dc.count || 0);
    } finally {
      setLoading(false);
    }
  }, [organization?.id, selectedPlanId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const pricingMap = useMemo(() => {
    const m = new Map<string, number>();
    pricing.forEach(p => m.set(`${p.feature_id}:${p.model_id}`, Number(p.dollar_per_task)));
    return m;
  }, [pricing]);
  const dollarPerTask = (feature: string, model: string) => pricingMap.get(`${feature}:${model}`) ?? 0;

  const lastPricingSync = useMemo(() => {
    if (!pricing.length) return null;
    return pricing.reduce((max, p) => p.last_updated > max ? p.last_updated : max, pricing[0].last_updated);
  }, [pricing]);
  const lastM365Sync = useMemo(() => {
    const filtered = viewDomain === 'all' || viewDomain === 'admin'
      ? domains
      : domains.filter(d => d.id === viewDomain);
    const stamps = filtered.map(d => d.last_directory_sync_at).filter(Boolean) as string[];
    if (!stamps.length) return null;
    return stamps.reduce((max, s) => s > max ? s : max);
  }, [domains, viewDomain]);

  // active = users assigned (member_count > 0) — for view-domain filtering, filter plans by domain_id
  const visiblePlans = useMemo(() => {
    if (viewDomain === 'all' || viewDomain === 'admin') return plans;
    return plans.filter(p => !p.domain_id || p.domain_id === viewDomain);
  }, [plans, viewDomain]);

  useEffect(() => {
    if (visiblePlans.length && !visiblePlans.find(p => p.id === selectedPlanId)) {
      setSelectedPlanId(visiblePlans[0].id);
    }
  }, [visiblePlans, selectedPlanId]);

  const activeMembersForPlan = (planId: string) =>
    memberships.filter(m => m.group_id === planId).length;

  const planMonthlyCostPerUser = useCallback((planId: string): number => {
    const rows = features.filter(f => f.group_id === planId);
    let dailyCost = 0;
    rows.forEach(r => {
      const model = r.model_assignment || ALLOWED_MODELS[r.feature_key]?.[0] || '';
      dailyCost += dailyTasks(r) * dollarPerTask(r.feature_key, model);
    });
    return dailyCost * 22;
  }, [features, dollarPerTask]);

  const totalActive = visiblePlans.reduce((s, p) => s + activeMembersForPlan(p.id), 0);
  const monthlyOrgCost = visiblePlans.reduce((s, p) => s + planMonthlyCostPerUser(p.id) * activeMembersForPlan(p.id), 0);
  const dailyOrgCost = monthlyOrgCost / 22;
  const avgPerActiveUser = totalActive > 0 ? monthlyOrgCost / totalActive : 0;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const togglePlanRow = (id: string) => {
    setExpandedPlans(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sumCost = visiblePlans.reduce((s, p) => s + planMonthlyCostPerUser(p.id) * activeMembersForPlan(p.id), 0);
  const summaryRows = visiblePlans.map(p => {
    const members = activeMembersForPlan(p.id);
    const perUser = planMonthlyCostPerUser(p.id);
    const total = perUser * members;
    return {
      plan: p,
      members,
      perUser,
      total,
      share: sumCost > 0 ? (total / sumCost) * 100 : 0,
    };
  });
  const sortedByPerUser = [...summaryRows].sort((a, b) => b.perUser - a.perUser);
  const highest = sortedByPerUser[0];
  const lowest = sortedByPerUser[sortedByPerUser.length - 1];

  const adminDomain = profile?.email?.split('@')[1] || '';

  return (
    <div style={ROOT_STYLE}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Viewing domain:</label>
          <select
            value={viewDomain}
            onChange={(e) => setViewDomain(e.target.value)}
            style={{ fontSize: 13, padding: '3px 8px', height: 28, border: '1px solid var(--border-secondary)', borderRadius: 4, background: 'white', color: 'var(--text-primary)' }}
          >
            <option value="admin">{adminDomain} (admin)</option>
            {domains.map(d => (
              <option key={d.id} value={d.id}>
                {d.domain}{d.organization_name ? ` (${d.organization_name})` : ''}
              </option>
            ))}
            <option value="all">All domains</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <SyncPill label={`Pricing · ${lastPricingSync ? relativeTime(lastPricingSync) : 'never'}`} />
          <SyncPill label={`M365 · ${lastM365Sync ? relativeTime(lastM365Sync) : 'never'}`} />
        </div>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 600 }}>Plans</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0 }}>
            Select a plan to configure. Costs project from active M365 users only. Daily limits apply business days only.
          </p>
        </div>
        <NewPlanButton domains={domains} adminDomainId={domains.find(d => d.domain === adminDomain)?.id || null} onCreated={fetchAll} />
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginBottom: '1rem' }}>
        <KpiCard label="Active users" value={String(totalActive)} sub={`${discoveredCount} discovered in M365`} />
        <KpiCard label="Daily projected" value={fmtUSD(dailyOrgCost, 0)} sub="based on active" />
        <KpiCard label="Monthly projected" value={fmtUSD(monthlyOrgCost, 0)} sub="22 business days" large />
        <KpiCard label="Avg / active user" value={fmtUSD(avgPerActiveUser, 0)} sub="per month" />
      </div>

      {/* Plan pills */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap', marginBottom: 14 }}>
        {visiblePlans.map(p => {
          const isSel = p.id === selectedPlanId;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedPlanId(p.id)}
              style={{
                padding: '6px 14px', fontSize: 13, borderRadius: 'var(--radius-md)',
                border: isSel ? '0.5px solid var(--border-secondary)' : '0.5px solid transparent',
                background: isSel ? 'var(--bg-primary)' : 'transparent',
                color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: PLAN_DOTS[p.name] || 'var(--text-info)', flexShrink: 0 }} />
              {p.name}
              <span style={{ fontSize: 11, color: isSel ? 'var(--text-secondary)' : 'var(--text-tertiary)', fontWeight: 400 }}>
                {fmtUSD(p.price_per_user_mo, 0)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected plan card */}
      {selectedPlanId && (
        <PlanCard
          key={selectedPlanId}
          plan={plans.find(p => p.id === selectedPlanId)!}
          features={features.filter(f => f.group_id === selectedPlanId)}
          activeMembers={activeMembersForPlan(selectedPlanId)}
          domains={domains}
          dollarPerTask={dollarPerTask}
          onSaved={fetchAll}
          allPlans={plans}
        />
      )}

      {/* Org Summary */}
      <div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border-tertiary)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginTop: '1.25rem' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Organization summary</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
          Click a plan row to expand the active user list and their current usage.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 10 }}>
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th align="right">Active</Th>
              <Th align="right">Cost / user / mo</Th>
              <Th align="right">Total / mo</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map(row => {
              const empty = row.members === 0;
              const expanded = expandedPlans.has(row.plan.id);
              const planUsers = activeUsers.filter(u => u.group_id === row.plan.id);
              return (
                <FragmentRow
                  key={row.plan.id}
                  row={row}
                  empty={empty}
                  expanded={expanded}
                  planUsers={planUsers}
                  togglePlanRow={togglePlanRow}
                />
              );
            })}
            <tr style={{ fontWeight: 500 }}>
              <td style={{ padding: 8, borderTop: '0.5px solid var(--border-secondary)' }}>Total</td>
              <td style={{ padding: 8, borderTop: '0.5px solid var(--border-secondary)', textAlign: 'right' }}>{totalActive}</td>
              <td style={{ padding: 8, borderTop: '0.5px solid var(--border-secondary)', textAlign: 'right' }}>—</td>
              <td style={{ padding: 8, borderTop: '0.5px solid var(--border-secondary)', textAlign: 'right' }}>{fmtUSD(monthlyOrgCost, 0)}</td>
              <td style={{ padding: 8, borderTop: '0.5px solid var(--border-secondary)', textAlign: 'right' }}>100%</td>
            </tr>
          </tbody>
        </table>

        {/* Highlight cards */}
        {summaryRows.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginTop: 14 }}>
            <HighlightCard label="Highest cost / active user" value={highest?.plan.name || '—'} detail={`${fmtUSD(highest?.perUser ?? 0, 0)} / mo per active user`} />
            <HighlightCard label="Lowest cost / active user" value={lowest?.plan.name || '—'} detail={`${fmtUSD(lowest?.perUser ?? 0, 0)} / mo per active user`} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Small bits ----------

function SyncPill({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
      color: 'var(--text-secondary)', padding: '3px 9px', background: 'var(--bg-secondary)',
      borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-success)', flexShrink: 0 }} />
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub, large }: { label: string; value: string; sub: string; large?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '9px 11px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
      <div style={{
        fontSize: large ? 21 : 17, fontWeight: 500,
        color: large ? 'var(--text-info)' : 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function HighlightCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{detail}</div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th style={{
      fontWeight: 500, color: 'var(--text-tertiary)', fontSize: 11,
      padding: '6px 8px', textAlign: align || 'left',
      borderBottom: '0.5px solid var(--border-secondary)',
    }}>{children}</th>
  );
}
function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td style={{
      padding: 8, borderBottom: '0.5px solid var(--border-tertiary)',
      fontVariantNumeric: 'tabular-nums', verticalAlign: 'middle',
      textAlign: align || 'left',
    }}>{children}</td>
  );
}

function fmtUSD(n: number, digits = 2): string {
  if (!isFinite(n)) return '$0';
  if (digits === 0) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

// ---------- Plan card (single visible plan editor) ----------

function PlanCard({
  plan, features, activeMembers, domains, dollarPerTask, onSaved, allPlans,
}: {
  plan: Plan;
  features: FeatureRow[];
  activeMembers: number;
  domains: DomainRow[];
  dollarPerTask: (f: string, m: string) => number;
  onSaved: () => void;
  allPlans: Plan[];
}) {
  // Working rows: ensure all 12 features present
  const initRows: FeatureRow[] = useMemo(() => FEATURE_ORDER.map(key => {
    const existing = features.find(f => f.feature_key === key);
    return existing || {
      group_id: plan.id, feature_key: key, is_enabled: false, daily_limit: 0,
      model_assignment: ALLOWED_MODELS[key]?.[0] || null,
      limit_term: 'daily', rollover: 'none',
    };
  }), [features, plan.id]);

  const [rows, setRows] = useState<FeatureRow[]>(initRows);
  const [maxCats, setMaxCats] = useState<number>(plan.max_categories || 0);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setRows(initRows);
    setMaxCats(plan.max_categories || 0);
  }, [initRows, plan.id, plan.max_categories]);

  const updateRow = (key: string, patch: Partial<FeatureRow>) => {
    setRows(rs => rs.map(r => r.feature_key === key ? { ...r, ...patch } : r));
  };

  const totals = useMemo(() => {
    let dailyTasksSum = 0, dailyCostSum = 0;
    rows.forEach(r => {
      const dt = dailyTasks(r);
      dailyTasksSum += dt;
      const m = r.model_assignment || ALLOWED_MODELS[r.feature_key]?.[0] || '';
      dailyCostSum += dt * dollarPerTask(r.feature_key, m);
    });
    return {
      dailyTasks: dailyTasksSum,
      weeklyTasks: dailyTasksSum * 5,
      monthlyTasks: dailyTasksSum * 22,
      groupMonthlyTasks: dailyTasksSum * 22 * activeMembers,
      dailyCost: dailyCostSum,
      weeklyCost: dailyCostSum * 5,
      monthlyCost: dailyCostSum * 22,
      groupMonthlyCost: dailyCostSum * 22 * activeMembers,
    };
  }, [rows, dollarPerTask, activeMembers]);

  const dirty = useMemo(() => {
    if (Number(plan.max_categories || 0) !== Number(maxCats)) return true;
    for (const r of rows) {
      const orig = features.find(f => f.feature_key === r.feature_key);
      if (!orig) {
        if (r.is_enabled) return true;
        continue;
      }
      if (orig.is_enabled !== r.is_enabled) return true;
      if ((orig.daily_limit || 0) !== (r.daily_limit || 0)) return true;
      if ((orig.model_assignment || '') !== (r.model_assignment || '')) return true;
      if ((orig.limit_term || 'daily') !== (r.limit_term || 'daily')) return true;
      if ((orig.rollover || 'none') !== (r.rollover || 'none')) return true;
    }
    return false;
  }, [rows, features, plan.max_categories, maxCats]);

  const reset = () => {
    setRows(initRows);
    setMaxCats(plan.max_categories || 0);
  };

  const applyChanges = async () => {
    setSaving(true);
    try {
      const upsertRows = rows.map(r => ({
        group_id: plan.id,
        feature_key: r.feature_key,
        is_enabled: r.is_enabled,
        daily_limit: r.daily_limit || 0,
        model_assignment: r.model_assignment,
        limit_term: r.limit_term || 'daily',
        rollover: r.rollover || 'none',
      }));
      const { error: e1 } = await supabase.from('group_features').upsert(upsertRows, { onConflict: 'group_id,feature_key' });
      if (e1) throw e1;
      if (Number(plan.max_categories || 0) !== Number(maxCats)) {
        const { error: e2 } = await supabase.from('permission_groups').update({ max_categories: maxCats }).eq('id', plan.id);
        if (e2) throw e2;
      }
      await supabase.from('admin_audit_log').insert({
        action: 'update_plan_features',
        organization_id: plan.organization_id,
        group_id: plan.id,
        details: { plan: plan.name } as any,
      });
      toast.success('Plan updated');
      setConfirmOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const scopeBadge = plan.domain_id || plan.scope_domain
    ? { kind: 'domain' as const, label: `Domain · ${domains.find(d => d.id === plan.domain_id)?.domain || plan.scope_domain}` }
    : { kind: 'global' as const, label: 'Global · all domains' };

  const dot = PLAN_DOTS[plan.name] || 'var(--text-info)';

  return (
    <div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border-tertiary)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{plan.name}</h3>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{fmtUSD(plan.price_per_user_mo, 0)} / user / mo</span>
          <ScopeBadge kind={scopeBadge.kind} label={scopeBadge.label} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5 }}>
          {activeMembers > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', fontSize: 11, fontWeight: 500, borderRadius: 999, background: 'var(--bg-success)', color: 'var(--text-success)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-success)' }} />
              {activeMembers} active
            </span>
          ) : (
            <span style={{ color: 'var(--text-tertiary)' }}>No active users yet</span>
          )}
          <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(totals.groupMonthlyCost, 0)}/mo</span>
        </div>
      </div>
      {plan.description && (
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 10px' }}>{plan.description}</p>
      )}

      {/* Categories quota */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>Email categories allowed</span>
        <input
          type="number" min={0} max={10} value={maxCats}
          onChange={(e) => setMaxCats(Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))}
          style={{ width: 52, height: 28, fontSize: 12.5, padding: '2px 6px', border: '1px solid var(--border-secondary)', borderRadius: 4, background: 'white', color: 'var(--text-primary)' }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>of 10 · names live in Email Intelligence setup</span>
      </div>

      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) 30px 60px 56px minmax(0,1fr) 48px 56px 70px', gap: 5, padding: '4px 0', borderBottom: '0.5px solid var(--border-secondary)' }}>
        <ColHeader>Feature</ColHeader>
        <ColHeader>On</ColHeader>
        <ColHeader>Term</ColHeader>
        <ColHeader>Limit</ColHeader>
        <ColHeader>Model</ColHeader>
        <ColHeader align="right">$/task</ColHeader>
        <ColHeader align="right">Cost</ColHeader>
        <ColHeader>Rollover</ColHeader>
      </div>

      {/* Feature rows */}
      {rows.map(r => {
        const opts = ALLOWED_MODELS[r.feature_key] || [];
        const model = r.model_assignment || opts[0] || '';
        const perTask = dollarPerTask(r.feature_key, model);
        const cost = perTask * (r.daily_limit || 0);
        const disabled = !r.is_enabled;
        return (
          <div key={r.feature_key} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) 30px 60px 56px minmax(0,1fr) 48px 56px 70px',
            gap: 5, alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid var(--border-tertiary)', fontSize: 12.5,
          }}>
            <div style={{ fontWeight: 500, lineHeight: 1.3, opacity: disabled ? 0.45 : 1 }}>
              {FEATURE_LABELS[r.feature_key] || r.feature_key}
            </div>
            <Toggle checked={r.is_enabled} onChange={(v) => updateRow(r.feature_key, { is_enabled: v })} />
            <select
              value={r.limit_term || 'daily'}
              disabled={disabled}
              onChange={(e) => updateRow(r.feature_key, { limit_term: e.target.value as 'daily' | 'weekly' })}
              style={selectStyle}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <input
              type="number" min={0} max={999} value={r.daily_limit || 0}
              disabled={disabled}
              onChange={(e) => updateRow(r.feature_key, { daily_limit: Math.max(0, Math.min(999, parseInt(e.target.value) || 0)) })}
              style={{ ...inputStyle, width: '100%' }}
            />
            <select
              value={model}
              disabled={disabled}
              onChange={(e) => updateRow(r.feature_key, { model_assignment: e.target.value })}
              style={selectStyle}
            >
              {opts.map(o => <option key={o} value={o}>{MODEL_LABELS[o] || o}</option>)}
            </select>
            <div style={{ textAlign: 'right', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', opacity: disabled ? 0.45 : 1 }}>
              ${perTask.toFixed(4)}
            </div>
            <div style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums', opacity: disabled ? 0.45 : 1 }}>
              ${cost.toFixed(2)}
            </div>
            <select
              value={r.rollover || 'none'}
              disabled={disabled}
              onChange={(e) => updateRow(r.feature_key, { rollover: e.target.value as 'none' | 'next_day' })}
              style={selectStyle}
            >
              <option value="none">None</option>
              <option value="next_day">Next day</option>
            </select>
          </div>
        );
      })}

      {/* Per-user totals grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: '96px repeat(3, minmax(0,1fr)) 110px',
        gap: '0 12px', padding: '10px 0 4px', fontSize: 12, alignItems: 'center',
      }}>
        <div /><Cell tone="ch">Daily</Cell><Cell tone="ch">Weekly</Cell><Cell tone="ch">Monthly</Cell><Cell tone="ch" align="right">Group / mo</Cell>
        <Cell tone="cl">Tasks / user</Cell>
        <Cell tone="cv">{Math.round(totals.dailyTasks).toLocaleString()}</Cell>
        <Cell tone="cv">{Math.round(totals.weeklyTasks).toLocaleString()}</Cell>
        <Cell tone="cv">{Math.round(totals.monthlyTasks).toLocaleString()}</Cell>
        <Cell tone="cv-group" align="right">{Math.round(totals.groupMonthlyTasks).toLocaleString()} tasks</Cell>
        <Cell tone="cl">Cost / user</Cell>
        <Cell tone="cv">{fmtUSD(totals.dailyCost, 2)}</Cell>
        <Cell tone="cv">{fmtUSD(totals.weeklyCost, 2)}</Cell>
        <Cell tone="cv">{fmtUSD(totals.monthlyCost, 0)}</Cell>
        <Cell tone="cv-group" align="right">{fmtUSD(totals.groupMonthlyCost, 0)}</Cell>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--border-tertiary)' }}>
        <button onClick={reset} disabled={!dirty} style={btnStyle(false, !dirty)}>Reset</button>
        <button onClick={() => setConfirmOpen(true)} disabled={!dirty} style={btnStyle(true, !dirty)}>Apply changes</button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button style={{ ...btnStyle(false, false), padding: '5px 8px' }}>
              <MoreHorizontal style={{ width: 14, height: 14 }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setApplyOpen(true)}>
              <Globe className="w-4 h-4 mr-2" /> Apply to other domains…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toast.info('Duplicate plan: open the “New plan” dialog and pick this as a base.')}>
              <Copy className="w-4 h-4 mr-2" /> Duplicate plan…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive">
              <Trash2 className="w-4 h-4 mr-2" /> Delete plan…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Diff confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply changes to {plan.name}</DialogTitle>
            <DialogDescription>
              Changes apply immediately to {activeMembers} active member{activeMembers === 1 ? '' : 's'}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setConfirmOpen(false)} style={btnStyle(false, false)}>Cancel</button>
            <button onClick={applyChanges} disabled={saving} style={btnStyle(true, saving)}>
              {saving ? 'Applying…' : 'Apply changes'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply to other domains */}
      <ApplyToDomainsDialog
        open={applyOpen} onOpenChange={setApplyOpen}
        plan={plan} rows={rows} domains={domains} onDone={onSaved}
      />

      {/* Delete plan */}
      <DeletePlanDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        plan={plan} activeMembers={activeMembers} otherPlans={allPlans.filter(p => p.id !== plan.id)} onDone={onSaved}
      />
    </div>
  );
}

function ScopeBadge({ kind, label }: { kind: 'global' | 'domain'; label: string }) {
  const palette = kind === 'global'
    ? { bg: 'var(--bg-info)', fg: 'var(--text-info)' }
    : { bg: 'var(--bg-success)', fg: 'var(--text-success)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
      borderRadius: 999, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      background: palette.bg, color: palette.fg,
    }}>{label}</span>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 28, height: 16, flexShrink: 0, verticalAlign: 'middle', cursor: 'pointer' }}>
      <input
        type="checkbox" checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
      />
      <span style={{
        position: 'absolute', inset: 0, transition: '0.15s', borderRadius: 9,
        background: checked ? 'var(--text-info)' : 'rgba(140,140,140,0.35)',
      }}>
        <span style={{
          position: 'absolute', height: 12, width: 12, left: 2, top: 2,
          background: 'white', transition: '0.15s', borderRadius: '50%',
          transform: checked ? 'translateX(12px)' : 'none',
        }} />
      </span>
    </label>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 11, padding: '2px 4px', height: 26, border: '1px solid var(--border-secondary)',
  borderRadius: 4, background: 'white', color: 'var(--text-primary)',
};
const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '2px 4px', height: 26, border: '1px solid var(--border-secondary)',
  borderRadius: 4, background: 'white', color: 'var(--text-primary)',
};

function ColHeader({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', fontWeight: 500, padding: '4px 0', textAlign: align || 'left' }}>
      {children}
    </div>
  );
}

function Cell({ children, tone, align }: {
  children: React.ReactNode;
  tone: 'ch' | 'cl' | 'cv' | 'cv-group';
  align?: 'right';
}) {
  const styles: Record<string, React.CSSProperties> = {
    ch: { fontSize: 10.5, color: 'var(--text-tertiary)', fontWeight: 500, padding: '0 0 4px', borderBottom: '0.5px solid var(--border-tertiary)' },
    cl: { color: 'var(--text-secondary)', fontSize: 11.5, padding: '4px 0' },
    cv: { fontWeight: 500, fontVariantNumeric: 'tabular-nums', padding: '4px 0' },
    'cv-group': { fontWeight: 500, color: 'var(--text-info)', fontVariantNumeric: 'tabular-nums', padding: '4px 0' },
  };
  return <div style={{ ...styles[tone], textAlign: align || 'left' }}>{children}</div>;
}

function btnStyle(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '5px 11px', fontSize: 12.5, borderRadius: 'var(--radius-md)',
    border: primary ? '0.5px solid var(--text-info)' : '0.5px solid var(--border-secondary)',
    background: primary ? 'var(--text-info)' : 'transparent',
    color: primary ? 'white' : 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}

// ---------- User breakdown ----------

function UserBreakdown({ users, planMonthlyCostPerUser }: { users: ActiveUser[]; planMonthlyCostPerUser: number }) {
  if (!users.length) {
    return (
      <div style={{ padding: '12px 8px 8px 32px', fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: 12 }}>
        No active users assigned to this plan yet.
      </div>
    );
  }
  return (
    <div style={{ padding: '8px 16px 12px 32px' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 70px 70px 80px 90px',
        gap: 12, padding: '6px 8px', borderBottom: '0.5px solid var(--border-tertiary)',
      }}>
        <div style={hdr}>User</div>
        <div style={{ ...hdr, textAlign: 'right' }}>Tasks (mo)</div>
        <div style={{ ...hdr, textAlign: 'right' }}>Spend (mo)</div>
        <div style={{ ...hdr, textAlign: 'right' }}>Cap used</div>
        <div style={{ ...hdr, textAlign: 'right' }}>Last activity</div>
      </div>
      {users.map((u, i) => {
        const cap = planMonthlyCostPerUser > 0 ? Math.min(100, (u.monthly_spend / planMonthlyCostPerUser) * 100) : 0;
        const fillColor = cap >= 90 ? 'var(--text-error)' : cap >= 70 ? 'var(--text-warning)' : 'var(--text-info)';
        return (
          <div key={u.user_id} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 70px 70px 80px 90px',
            gap: 12, padding: '7px 8px',
            borderBottom: i === users.length - 1 ? 'none' : '0.5px solid var(--border-tertiary)',
            alignItems: 'center', fontSize: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', background: 'var(--bg-info)',
                color: 'var(--text-info)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600, flexShrink: 0,
              }}>{initials(u.display_name, u.email)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 500, lineHeight: 1.2 }}>{u.display_name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.2 }}>{u.email}</div>
                <div style={{ width: '100%', height: 4, background: 'var(--border-tertiary)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
                  <div style={{ height: '100%', background: fillColor, width: `${Math.min(100, cap)}%`, transition: 'width 0.2s' }} />
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.monthly_tasks.toLocaleString()}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${u.monthly_spend.toFixed(2)}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cap.toFixed(0)}%</div>
            <div style={{ textAlign: 'right', color: 'var(--text-tertiary)' }}>{relativeTime(u.last_activity)}</div>
          </div>
        );
      })}
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 10.5, color: 'var(--text-tertiary)', fontWeight: 500 };

// ---------- New plan dialog ----------

function NewPlanButton({ domains, adminDomainId, onCreated }: {
  domains: DomainRow[]; adminDomainId: string | null; onCreated: () => void;
}) {
  const { profile, organization } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [maxCats, setMaxCats] = useState<number>(3);
  const [makeGlobal, setMakeGlobal] = useState(false);
  const [domainId, setDomainId] = useState<string>('');
  const [copyFromId, setCopyFromId] = useState<string>('');
  const [allPlans, setAllPlans] = useState<Plan[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(''); setDescription(''); setPrice(0); setMaxCats(3); setMakeGlobal(false);
    setDomainId(adminDomainId || domains[0]?.id || '');
    setCopyFromId('');
    if (organization?.id) {
      supabase.from('permission_groups').select('*').eq('organization_id', organization.id).then(({ data }) => {
        setAllPlans((data || []) as Plan[]);
      });
    }
  }, [open, adminDomainId, organization?.id]);

  const submit = async () => {
    if (!name.trim() || !organization?.id) return;
    if (!makeGlobal && !domainId) {
      toast.error('Pick a domain or switch to Global.'); return;
    }
    setSaving(true);
    try {
      const { data: ins, error } = await supabase.from('permission_groups').insert({
        name: name.trim(),
        description: description.trim() || null,
        organization_id: organization.id,
        domain_id: makeGlobal ? null : domainId,
        scope_domain: makeGlobal ? null : domains.find(d => d.id === domainId)?.domain || null,
        price_per_user_mo: price,
        max_categories: Math.max(0, Math.min(10, maxCats)),
        created_by: profile?.user_id || null,
      } as any).select('id').single();
      if (error) throw error;
      const newId = ins.id as string;

      // Seed 12 group_features rows (copy from source if specified)
      let baseRows: FeatureRow[] = [];
      if (copyFromId) {
        const { data: src } = await supabase.from('group_features').select('*').eq('group_id', copyFromId);
        baseRows = (src || []) as FeatureRow[];
      }
      const baseByKey = new Map(baseRows.map(r => [r.feature_key, r]));
      const newRows = FEATURE_ORDER.map(key => {
        const src = baseByKey.get(key);
        return {
          group_id: newId,
          feature_key: key,
          is_enabled: src?.is_enabled ?? false,
          daily_limit: src?.daily_limit ?? 0,
          model_assignment: src?.model_assignment ?? ALLOWED_MODELS[key]?.[0] ?? null,
          limit_term: src?.limit_term ?? 'daily',
          rollover: src?.rollover ?? 'none',
        };
      });
      const { error: e2 } = await supabase.from('group_features').insert(newRows);
      if (e2) throw e2;

      await supabase.from('admin_audit_log').insert({
        action: 'create_plan',
        organization_id: organization.id,
        group_id: newId,
        details: { name, scope: makeGlobal ? 'global' : 'domain', domain_id: makeGlobal ? null : domainId, price, max_categories: maxCats, copied_from: copyFromId || null } as any,
      });
      toast.success(`Plan "${name}" created`);
      setOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message || 'Create failed');
    } finally { setSaving(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} style={btnStyle(false, false)}>
        <Plus style={{ width: 12, height: 12 }} /> New plan
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new plan</DialogTitle>
            <DialogDescription>Plans bundle features, limits, and price.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Plan name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Power User" /></div>
            <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Price / user / mo ($)</Label><Input type="number" step="0.01" value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} /></div>
              <div><Label>Max categories (0–10)</Label><Input type="number" min={0} max={10} value={maxCats} onChange={(e) => setMaxCats(Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={makeGlobal} onCheckedChange={setMakeGlobal} id="mkglobal" />
              <Label htmlFor="mkglobal" className="text-sm">Make global (apply to all domains)</Label>
            </div>
            {!makeGlobal && (
              <div>
                <Label>Domain</Label>
                <select value={domainId} onChange={(e) => setDomainId(e.target.value)} style={{ ...selectStyle, width: '100%', height: 32, fontSize: 13 }}>
                  {domains.map(d => <option key={d.id} value={d.id}>@{d.domain}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label>Copy features from (optional)</Label>
              <select value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)} style={{ ...selectStyle, width: '100%', height: 32, fontSize: 13 }}>
                <option value="">— None (all features off) —</option>
                {allPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} style={btnStyle(false, false)}>Cancel</button>
            <button onClick={submit} disabled={saving || !name.trim()} style={btnStyle(true, saving || !name.trim())}>
              {saving ? 'Creating…' : 'Create plan'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------- Apply to other domains ----------

function ApplyToDomainsDialog({
  open, onOpenChange, plan, rows, domains, onDone,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  plan: Plan; rows: FeatureRow[]; domains: DomainRow[]; onDone: () => void;
}) {
  const { profile } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setSelected(new Set()); }, [open]);

  const targets = domains.filter(d => d.id !== plan.domain_id);

  const apply = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      for (const did of selected) {
        const dom = domains.find(d => d.id === did);
        const { data: ins, error } = await supabase.from('permission_groups').insert({
          name: plan.name,
          description: plan.description,
          organization_id: plan.organization_id,
          domain_id: did,
          scope_domain: dom?.domain || null,
          price_per_user_mo: plan.price_per_user_mo,
          max_categories: plan.max_categories,
          display_order: plan.display_order,
          created_by: profile?.user_id || null,
        } as any).select('id').single();
        if (error) throw error;
        const newId = ins.id as string;
        const newRows = rows.map(r => ({
          group_id: newId,
          feature_key: r.feature_key,
          is_enabled: r.is_enabled,
          daily_limit: r.daily_limit || 0,
          model_assignment: r.model_assignment,
          limit_term: r.limit_term || 'daily',
          rollover: r.rollover || 'none',
        }));
        await supabase.from('group_features').insert(newRows);
      }
      await supabase.from('admin_audit_log').insert({
        action: 'apply_plan_to_domains',
        organization_id: plan.organization_id,
        group_id: plan.id,
        details: { source_plan: plan.name, target_domain_ids: Array.from(selected) } as any,
      });
      toast.success(`Applied to ${selected.size} domain(s)`);
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e.message || 'Apply failed');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply {plan.name} to other domains</DialogTitle>
          <DialogDescription>
            Selecting a domain creates a copy of this plan scoped to that domain. Users on the new domain
            will not be affected until you assign them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-auto">
          {targets.length === 0 && <p className="text-sm text-muted-foreground">No other domains available.</p>}
          {targets.map(d => (
            <label key={d.id} className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:bg-muted/30">
              <Checkbox
                checked={selected.has(d.id)}
                onCheckedChange={(v) => {
                  setSelected(prev => {
                    const next = new Set(prev);
                    v ? next.add(d.id) : next.delete(d.id);
                    return next;
                  });
                }}
              />
              <span className="text-sm font-medium">@{d.domain}</span>
              {d.organization_name && <span className="text-xs text-muted-foreground">({d.organization_name})</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} style={btnStyle(false, false)}>Cancel</button>
          <button onClick={apply} disabled={busy || !selected.size} style={btnStyle(true, busy || !selected.size)}>
            {busy ? 'Applying…' : `Apply to ${selected.size} domain${selected.size === 1 ? '' : 's'}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Delete plan ----------

function DeletePlanDialog({
  open, onOpenChange, plan, activeMembers, otherPlans, onDone,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  plan: Plan; activeMembers: number; otherPlans: Plan[]; onDone: () => void;
}) {
  const [reassignTo, setReassignTo] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const std = otherPlans.find(p => p.name === 'Standard');
    setReassignTo(std?.id || '');
  }, [open, otherPlans]);

  const submit = async () => {
    setBusy(true);
    try {
      if (reassignTo && activeMembers > 0) {
        await supabase.from('user_group_memberships').update({ group_id: reassignTo }).eq('group_id', plan.id);
      } else if (activeMembers > 0) {
        await supabase.from('user_group_memberships').delete().eq('group_id', plan.id);
      }
      await supabase.from('group_features').delete().eq('group_id', plan.id);
      await supabase.from('permission_group_domain_assignments').delete().eq('group_id', plan.id);
      const { error } = await supabase.from('permission_groups').delete().eq('id', plan.id);
      if (error) throw error;
      await supabase.from('admin_audit_log').insert({
        action: 'delete_plan',
        organization_id: plan.organization_id,
        group_id: plan.id,
        details: { name: plan.name, active_members: activeMembers, reassigned_to: reassignTo || null } as any,
      });
      toast.success(`Plan "${plan.name}" deleted`);
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {plan.name}?</DialogTitle>
          <DialogDescription>
            {activeMembers} active user{activeMembers === 1 ? '' : 's'} assigned to this plan.
          </DialogDescription>
        </DialogHeader>
        {activeMembers > 0 && (
          <div>
            <Label>Reassign affected users to</Label>
            <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} style={{ ...selectStyle, width: '100%', height: 32, fontSize: 13 }}>
              <option value="">— Unassigned —</option>
              {otherPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} style={btnStyle(false, false)}>Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            style={{ ...btnStyle(true, busy), background: '#dc2626', borderColor: '#dc2626' }}
          >
            {busy ? 'Deleting…' : 'Delete plan'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

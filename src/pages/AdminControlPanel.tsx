import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Loader2, Save, Plus, Trash2, AlertTriangle, Activity, Users, Building2, Settings as SettingsIcon, ChevronRight } from 'lucide-react';
import {
  ALL_FEATURES, MODEL_OPTIONS_BY_FEATURE, costPerTask, fmtUSD, MODEL_COSTS,
} from '@/lib/costEstimation';

const GROUP_COLORS: Record<string, string> = {
  Chat: 'border-teal-500 bg-teal-500/5',
  Standard: 'border-slate-500 bg-slate-500/5',
  'Power User': 'border-blue-500 bg-blue-500/5',
  Executive: 'border-amber-500 bg-amber-500/5',
};

interface PermissionGroup {
  id: string;
  name: string;
  monthly_price: number | null;
  display_order: number;
  organization_id: string;
}
interface GroupFeatureRow {
  id?: string;
  group_id: string;
  feature_key: string;
  is_enabled: boolean;
  daily_limit: number;
  weekly_limit: number | null;
  monthly_limit: number | null;
  model_assignment: string | null;
}
interface GroupCostCap {
  group_id: string;
  per_request_usd: number | null;
  per_user_daily_usd: number | null;
  per_user_weekly_usd: number | null;
  per_user_monthly_usd: number | null;
}
interface OrgBudget {
  organization_id: string;
  daily_usd_cap: number;
  monthly_usd_cap: number;
  max_concurrent_runs: number;
  paused: boolean;
  spent_today_usd: number;
  spent_month_usd: number;
  auto_pause_enabled: boolean;
  alert_thresholds: number[];
  alert_email: string | null;
}

export default function AdminControlPanel() {
  const { profile, organization, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [features, setFeatures] = useState<GroupFeatureRow[]>([]);
  const [caps, setCaps] = useState<GroupCostCap[]>([]);
  const [memberships, setMemberships] = useState<{ user_id: string; group_id: string }[]>([]);
  const [orgBudget, setOrgBudget] = useState<OrgBudget | null>(null);

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'org');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // KPI
  const [todaySpend, setTodaySpend] = useState(0);
  const [monthSpend, setMonthSpend] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!isSuperAdmin) {
      navigate('/integrations', { replace: true });
    }
  }, [isSuperAdmin, authLoading, navigate]);

  useEffect(() => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('tab', activeTab);
      return p;
    }, { replace: true });
  }, [activeTab, setSearchParams]);

  const orgId = organization?.id;

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      // Super admin sees all permission groups across orgs
      const groupsQuery = isSuperAdmin
        ? supabase.from('permission_groups').select('*').order('display_order')
        : supabase.from('permission_groups').select('*').eq('organization_id', orgId).order('display_order');
      const [g, b] = await Promise.all([
        groupsQuery,
        supabase.from('org_agent_budget').select('*').eq('organization_id', orgId).maybeSingle(),
      ]);
      const groupRows = (g.data || []) as PermissionGroup[];
      setGroups(groupRows);
      if (!selectedGroupId && groupRows.length) setSelectedGroupId(groupRows[0].id);

      if (b.data) {
        setOrgBudget({
          organization_id: orgId,
          daily_usd_cap: Number(b.data.daily_usd_cap) || 0,
          monthly_usd_cap: Number(b.data.monthly_usd_cap) || 0,
          max_concurrent_runs: b.data.max_concurrent_runs || 5,
          paused: !!b.data.paused,
          spent_today_usd: Number(b.data.spent_today_usd) || 0,
          spent_month_usd: Number(b.data.spent_month_usd) || 0,
          auto_pause_enabled: b.data.auto_pause_enabled ?? true,
          alert_thresholds: b.data.alert_thresholds || [50, 75, 90, 100],
          alert_email: b.data.alert_email || profile?.email || '',
        });
      } else {
        setOrgBudget({
          organization_id: orgId, daily_usd_cap: 300, monthly_usd_cap: 6600,
          max_concurrent_runs: 10, paused: false, spent_today_usd: 0, spent_month_usd: 0,
          auto_pause_enabled: true, alert_thresholds: [50, 75, 90, 100], alert_email: profile?.email || '',
        });
      }

      if (groupRows.length) {
        const ids = groupRows.map(x => x.id);
        const [f, c, m] = await Promise.all([
          supabase.from('group_features').select('*').in('group_id', ids),
          supabase.from('group_cost_caps').select('*').in('group_id', ids),
          supabase.from('user_group_memberships').select('user_id, group_id').in('group_id', ids),
        ]);
        setFeatures((f.data || []) as GroupFeatureRow[]);
        setCaps((c.data || []) as GroupCostCap[]);
        setMemberships(m.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, profile?.email, selectedGroupId, isSuperAdmin]);

  useEffect(() => { fetchAll(); }, [orgId]); // eslint-disable-line

  // KPI fetch + auto-refresh
  const fetchKPIs = useCallback(async () => {
    if (!orgId) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [t, m, a] = await Promise.all([
      supabase.from('ai_usage_logs').select('cost_usd').eq('organization_id', orgId).gte('created_at', today.toISOString()),
      supabase.from('ai_usage_logs').select('cost_usd').eq('organization_id', orgId).gte('created_at', monthStart.toISOString()),
      supabase.from('ai_usage_logs').select('user_id').eq('organization_id', orgId).gte('created_at', hourAgo.toISOString()),
    ]);
    setTodaySpend((t.data || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0));
    setMonthSpend((m.data || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0));
    setActiveUsers(new Set((a.data || []).map(r => r.user_id)).size);
  }, [orgId]);

  useEffect(() => {
    fetchKPIs();
    const id = setInterval(fetchKPIs, 30_000);
    return () => clearInterval(id);
  }, [fetchKPIs]);

  const projectedMonth = useMemo(() => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (dayOfMonth === 0) return monthSpend;
    const avg = monthSpend / dayOfMonth;
    return monthSpend + avg * (daysInMonth - dayOfMonth);
  }, [monthSpend]);

  if (authLoading || !isSuperAdmin) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-[1600px]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Control Panel</h1>
          <p className="text-muted-foreground text-sm">Org → Group → User cascading controls</p>
        </div>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sticky top-0 z-10 bg-background pt-2 pb-2">
        <KpiCard label="TODAY" value={fmtUSD(todaySpend)} sub={orgBudget ? `${((todaySpend / Math.max(orgBudget.daily_usd_cap, 0.01)) * 100).toFixed(0)}% of cap` : ''} />
        <KpiCard label="MONTH" value={fmtUSD(monthSpend)} sub={orgBudget ? `${((monthSpend / Math.max(orgBudget.monthly_usd_cap, 0.01)) * 100).toFixed(0)}% of cap` : ''} />
        <KpiCard label="PROJECTED EOM" value={fmtUSD(projectedMonth)} sub="based on today's avg" />
        <KpiCard label="ACTIVE USERS" value={String(activeUsers)} sub="last hour" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="org"><Building2 className="w-4 h-4 mr-2" />Org</TabsTrigger>
          <TabsTrigger value="groups"><SettingsIcon className="w-4 h-4 mr-2" />Groups</TabsTrigger>
          <TabsTrigger value="users"><Users className="w-4 h-4 mr-2" />Users</TabsTrigger>
          <TabsTrigger value="activity"><Activity className="w-4 h-4 mr-2" />Live Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="org" className="mt-6">
          {orgBudget && <OrgSettingsTab budget={orgBudget} setBudget={setOrgBudget} todaySpend={todaySpend} monthSpend={monthSpend} onSaved={fetchAll} />}
        </TabsContent>

        <TabsContent value="groups" className="mt-6">
          <GroupsTab
            groups={groups} features={features} caps={caps} memberships={memberships}
            selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId}
            onSaved={fetchAll}
          />
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <UsersTab
            orgId={orgId!} groups={groups} memberships={memberships}
            selectedUserId={selectedUserId} setSelectedUserId={setSelectedUserId}
            features={features}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <LiveActivityTab orgId={orgId!} groups={groups} memberships={memberships}
            jumpToGroup={(gid) => { setSelectedGroupId(gid); setActiveTab('groups'); }}
            jumpToUser={(uid) => { setSelectedUserId(uid); setActiveTab('users'); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground font-semibold tracking-wide">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * TAB 1: ORG SETTINGS
 * ============================================================ */
function OrgSettingsTab({
  budget, setBudget, todaySpend, monthSpend, onSaved,
}: {
  budget: OrgBudget; setBudget: (b: OrgBudget) => void;
  todaySpend: number; monthSpend: number; onSaved: () => void;
}) {
  const [original] = useState<OrgBudget>(budget);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const diff = useMemo(() => {
    const d: { field: string; from: any; to: any }[] = [];
    (['daily_usd_cap', 'monthly_usd_cap', 'max_concurrent_runs', 'auto_pause_enabled', 'alert_email'] as const).forEach(k => {
      if (String(original[k] ?? '') !== String(budget[k] ?? '')) d.push({ field: k, from: original[k], to: budget[k] });
    });
    if (JSON.stringify(original.alert_thresholds) !== JSON.stringify(budget.alert_thresholds))
      d.push({ field: 'alert_thresholds', from: original.alert_thresholds.join(','), to: budget.alert_thresholds.join(',') });
    return d;
  }, [budget, original]);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('org_agent_budget').upsert({
        organization_id: budget.organization_id,
        daily_usd_cap: budget.daily_usd_cap,
        monthly_usd_cap: budget.monthly_usd_cap,
        max_concurrent_runs: budget.max_concurrent_runs,
        auto_pause_enabled: budget.auto_pause_enabled,
        alert_thresholds: budget.alert_thresholds,
        alert_email: budget.alert_email,
      } as any);
      if (error) throw error;
      await supabase.from('admin_audit_log').insert({
        action: 'update_org_budget',
        organization_id: budget.organization_id,
        details: { diff } as any,
      });
      toast.success('Org settings saved');
      setConfirmOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const toggleThreshold = (n: number) => {
    const set = new Set(budget.alert_thresholds);
    set.has(n) ? set.delete(n) : set.add(n);
    setBudget({ ...budget, alert_thresholds: [...set].sort((a, b) => a - b) });
  };

  return (
    <Card>
      <CardHeader><CardTitle>Organization Settings</CardTitle></CardHeader>
      <CardContent className="space-y-6 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Daily budget (USD)</Label>
            <Input type="number" step="0.01" value={budget.daily_usd_cap}
              onChange={e => setBudget({ ...budget, daily_usd_cap: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Monthly budget (USD)</Label>
            <Input type="number" step="0.01" value={budget.monthly_usd_cap}
              onChange={e => setBudget({ ...budget, monthly_usd_cap: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Max concurrent runs</Label>
            <Input type="number" value={budget.max_concurrent_runs}
              onChange={e => setBudget({ ...budget, max_concurrent_runs: parseInt(e.target.value) || 0 })} />
          </div>
          <div className="flex items-end gap-3">
            <Switch checked={budget.auto_pause_enabled} onCheckedChange={v => setBudget({ ...budget, auto_pause_enabled: v })} />
            <Label>Auto-pause when budget hit</Label>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Alert thresholds (% of cap)</Label>
          <div className="flex gap-4">
            {[50, 75, 90, 100].map(t => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <Checkbox checked={budget.alert_thresholds.includes(t)} onCheckedChange={() => toggleThreshold(t)} />
                {t}%
              </label>
            ))}
          </div>
          <div>
            <Label className="mt-3 block">Alert email</Label>
            <Input value={budget.alert_email || ''} onChange={e => setBudget({ ...budget, alert_email: e.target.value })} />
          </div>
        </div>

        <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/30">
          <div>Today's spend: <strong>{fmtUSD(todaySpend)}</strong> ({((todaySpend / Math.max(budget.daily_usd_cap, 0.01)) * 100).toFixed(1)}% of daily cap)</div>
          <div>Month's spend: <strong>{fmtUSD(monthSpend)}</strong> ({((monthSpend / Math.max(budget.monthly_usd_cap, 0.01)) * 100).toFixed(1)}% of monthly cap)</div>
        </div>

        <Button disabled={diff.length === 0} onClick={() => setConfirmOpen(true)}>
          <Save className="w-4 h-4 mr-2" />Save Org Settings
        </Button>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Confirm changes</DialogTitle>
              <DialogDescription>The following changes will be applied to your organization.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1 text-sm">
              {diff.map(d => (
                <div key={d.field} className="font-mono text-xs">
                  <strong>{d.field}:</strong> {String(d.from)} → {String(d.to)}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Apply</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * TAB 2: GROUPS — Full calculator dashboard
 * ============================================================ */

// localStorage helpers for calculator-only state (markup, $/task overrides, headcount projections)
const lsGet = (key: string, def: any) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
};
const lsSet = (key: string, v: any) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };

function GroupsTab({
  groups, features, caps, memberships, selectedGroupId, setSelectedGroupId, onSaved,
}: {
  groups: PermissionGroup[]; features: GroupFeatureRow[]; caps: GroupCostCap[];
  memberships: { user_id: string; group_id: string }[];
  selectedGroupId: string | null; setSelectedGroupId: (id: string) => void;
  onSaved: () => void;
}) {
  const memberCount = (gid: string) => memberships.filter(m => m.group_id === gid).length;

  // Per-group $/task overrides (calculator local state)
  const [taskCostOverrides, setTaskCostOverrides] = useState<Record<string, number>>(
    () => lsGet('admin_task_cost_overrides', {})
  );
  const setTaskCost = (groupId: string, featureKey: string, val: number | null) => {
    const k = `${groupId}:${featureKey}`;
    setTaskCostOverrides(prev => {
      const next = { ...prev };
      if (val === null || isNaN(val)) delete next[k]; else next[k] = val;
      lsSet('admin_task_cost_overrides', next);
      return next;
    });
  };
  const effectiveTaskCost = (groupId: string, featureKey: string, model: string) => {
    const k = `${groupId}:${featureKey}`;
    return taskCostOverrides[k] ?? costPerTask(featureKey, model);
  };

  const dailyCostForGroup = (gid: string) => {
    return features.filter(f => f.group_id === gid && f.is_enabled).reduce((sum, f) => {
      const m = f.model_assignment || MODEL_OPTIONS_BY_FEATURE[f.feature_key]?.[0] || 'gpt-4.1-mini';
      return sum + effectiveTaskCost(gid, f.feature_key, m) * (f.daily_limit || 0);
    }, 0);
  };

  // Headcount projection (per plan), local-only
  const [headcounts, setHeadcounts] = useState<Record<string, number>>(
    () => lsGet('admin_headcount_projection', {})
  );
  const setHeadcount = (gid: string, n: number) => {
    setHeadcounts(prev => {
      const next = { ...prev, [gid]: n };
      lsSet('admin_headcount_projection', next);
      return next;
    });
  };
  // Default headcount = actual member count
  useEffect(() => {
    const next = { ...headcounts };
    let changed = false;
    groups.forEach(g => { if (next[g.id] == null) { next[g.id] = memberCount(g.id); changed = true; } });
    if (changed) { setHeadcounts(next); lsSet('admin_headcount_projection', next); }
  }, [groups.length]); // eslint-disable-line

  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  // Org-wide cost from headcount projection
  const orgProjection = useMemo(() => {
    let monthly = 0;
    groups.forEach(g => {
      const n = headcounts[g.id] ?? 0;
      monthly += dailyCostForGroup(g.id) * 22 * n;
    });
    return monthly;
  }, [groups, headcounts, features, taskCostOverrides]);

  return (
    <div className="space-y-6">
      {/* Plan tabs */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Plans</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {groups.map(g => {
              const daily = dailyCostForGroup(g.id);
              const n = memberCount(g.id);
              const isSel = g.id === selectedGroupId;
              return (
                <button key={g.id} onClick={() => setSelectedGroupId(g.id)}
                  className={`text-left rounded-lg border-2 p-4 transition-all ${GROUP_COLORS[g.name] || 'border-muted'} ${isSel ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}>
                  <div className="font-bold">{g.name} · {n} user{n !== 1 ? 's' : ''}</div>
                  <div className="text-xl font-bold mt-1">{fmtUSD(daily * 22 * n)}/mo</div>
                  <div className="text-xs text-muted-foreground mt-1">{fmtUSD(daily)}/day per user</div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selectedGroup && (
        <GroupEditor
          key={selectedGroup.id}
          group={selectedGroup}
          allGroups={groups}
          features={features.filter(f => f.group_id === selectedGroup.id)}
          cap={caps.find(c => c.group_id === selectedGroup.id) || { group_id: selectedGroup.id, per_request_usd: null, per_user_daily_usd: null, per_user_weekly_usd: null, per_user_monthly_usd: null }}
          memberCount={memberCount(selectedGroup.id)}
          memberCounts={Object.fromEntries(groups.map(g => [g.id, memberCount(g.id)]))}
          headcounts={headcounts}
          setHeadcount={setHeadcount}
          orgProjection={orgProjection}
          taskCostOverrides={taskCostOverrides}
          setTaskCost={setTaskCost}
          effectiveTaskCost={effectiveTaskCost}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function GroupEditor({
  group, allGroups, features, cap, memberCount, memberCounts, headcounts, setHeadcount,
  orgProjection, taskCostOverrides, setTaskCost, effectiveTaskCost, onSaved,
}: {
  group: PermissionGroup; allGroups: PermissionGroup[]; features: GroupFeatureRow[]; cap: GroupCostCap;
  memberCount: number;
  memberCounts: Record<string, number>;
  headcounts: Record<string, number>;
  setHeadcount: (gid: string, n: number) => void;
  orgProjection: number;
  taskCostOverrides: Record<string, number>;
  setTaskCost: (groupId: string, featureKey: string, val: number | null) => void;
  effectiveTaskCost: (groupId: string, featureKey: string, model: string) => number;
  onSaved: () => void;
}) {
  // Editable rows: ensure every ALL_FEATURES key present
  const initRows: GroupFeatureRow[] = useMemo(() => ALL_FEATURES.map(f => {
    const existing = features.find(x => x.feature_key === f.key);
    return existing || {
      group_id: group.id, feature_key: f.key, is_enabled: false, daily_limit: 0,
      weekly_limit: null, monthly_limit: null, model_assignment: MODEL_OPTIONS_BY_FEATURE[f.key]?.[0] || null,
    };
  }), [features, group.id]);

  const [rows, setRows] = useState<GroupFeatureRow[]>(initRows);
  const [editCap, setEditCap] = useState<GroupCostCap>(cap);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [markup, setMarkup] = useState<number>(() => lsGet(`admin_markup_${group.id}`, 3.1));

  useEffect(() => { lsSet(`admin_markup_${group.id}`, markup); }, [markup, group.id]);
  useEffect(() => { setRows(initRows); setEditCap(cap); setConfirmText(''); }, [initRows, cap]);

  const updateRow = (key: string, patch: Partial<GroupFeatureRow>) => {
    setRows(rs => rs.map(r => r.feature_key === key ? { ...r, ...patch } : r));
  };

  const projection = useMemo(() => {
    let daily = 0;
    rows.forEach(r => {
      if (!r.is_enabled) return;
      const m = r.model_assignment || MODEL_OPTIONS_BY_FEATURE[r.feature_key]?.[0] || 'gpt-4.1-mini';
      daily += effectiveTaskCost(group.id, r.feature_key, m) * (r.daily_limit || 0);
    });
    return { daily, weekly: daily * 5, monthly: daily * 22, yearly: daily * 22 * 12 };
  }, [rows, group.id, taskCostOverrides, effectiveTaskCost]);

  const diff = useMemo(() => {
    const d: string[] = [];
    rows.forEach(r => {
      const orig = features.find(f => f.feature_key === r.feature_key);
      if (!orig) {
        if (r.is_enabled) d.push(`+ ${r.feature_key}: enable, ${r.daily_limit}/day, ${r.model_assignment}`);
        return;
      }
      if (orig.is_enabled !== r.is_enabled) d.push(`${r.feature_key} enabled: ${orig.is_enabled} → ${r.is_enabled}`);
      if (orig.daily_limit !== r.daily_limit) d.push(`${r.feature_key} daily_limit: ${orig.daily_limit} → ${r.daily_limit}`);
      if ((orig.weekly_limit ?? null) !== (r.weekly_limit ?? null)) d.push(`${r.feature_key} weekly_limit: ${orig.weekly_limit ?? 'auto'} → ${r.weekly_limit ?? 'auto'}`);
      if ((orig.monthly_limit ?? null) !== (r.monthly_limit ?? null)) d.push(`${r.feature_key} monthly_limit: ${orig.monthly_limit ?? 'auto'} → ${r.monthly_limit ?? 'auto'}`);
      if ((orig.model_assignment ?? null) !== (r.model_assignment ?? null)) d.push(`${r.feature_key} model: ${orig.model_assignment} → ${r.model_assignment}`);
    });
    (['per_request_usd', 'per_user_daily_usd', 'per_user_weekly_usd', 'per_user_monthly_usd'] as const).forEach(k => {
      if ((cap[k] ?? null) !== (editCap[k] ?? null)) d.push(`cap ${k}: ${cap[k] ?? 'none'} → ${editCap[k] ?? 'none'}`);
    });
    return d;
  }, [rows, features, cap, editCap]);

  const save = async () => {
    setSaving(true);
    try {
      // Upsert all rows
      const upsertRows = rows.map(r => ({
        group_id: group.id,
        feature_key: r.feature_key,
        is_enabled: r.is_enabled,
        daily_limit: r.daily_limit || 0,
        weekly_limit: r.weekly_limit,
        monthly_limit: r.monthly_limit,
        model_assignment: r.model_assignment,
      }));
      const { error: e1 } = await supabase.from('group_features').upsert(upsertRows, { onConflict: 'group_id,feature_key' });
      if (e1) throw e1;

      const { error: e2 } = await supabase.from('group_cost_caps').upsert({
        group_id: group.id,
        per_request_usd: editCap.per_request_usd,
        per_user_daily_usd: editCap.per_user_daily_usd,
        per_user_weekly_usd: editCap.per_user_weekly_usd,
        per_user_monthly_usd: editCap.per_user_monthly_usd,
      }, { onConflict: 'group_id' });
      if (e2) throw e2;

      await supabase.from('admin_audit_log').insert({
        action: 'update_group_features',
        organization_id: group.organization_id,
        group_id: group.id,
        details: { diff } as any,
      });
      toast.success(`Applied to ${memberCount} user(s)`);
      setConfirmOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const suggestedDailyCap = projection.daily * 1.5;
  const suggestedMonthlyCap = projection.monthly * 1.5;
  const customerPrice = projection.monthly * markup;
  const profit = customerPrice - projection.monthly;
  const marginPct = customerPrice > 0 ? (profit / customerPrice) * 100 : 0;

  const totalOrgUsers = Object.values(memberCounts).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-6">
      {/* Editor header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Editing: {group.name}</CardTitle>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Pricing markup</Label>
              <Input type="number" step="0.1" className="w-20"
                value={markup} onChange={e => setMarkup(parseFloat(e.target.value) || 1)} />
              <span className="text-xs text-muted-foreground">×</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Feature matrix */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Per day</TableHead>
                  <TableHead>Per week</TableHead>
                  <TableHead>Per month</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">$/task</TableHead>
                  <TableHead className="text-right">$/day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const opts = MODEL_OPTIONS_BY_FEATURE[r.feature_key] || Object.keys(MODEL_COSTS);
                  const model = r.model_assignment || opts[0];
                  const perTask = effectiveTaskCost(group.id, r.feature_key, model);
                  return (
                    <TableRow key={r.feature_key} className={!r.is_enabled ? 'opacity-60' : ''}>
                      <TableCell>
                        <div className="font-medium">{ALL_FEATURES.find(a => a.key === r.feature_key)?.label || r.feature_key}</div>
                        <div className="text-[10px] text-muted-foreground">{model}</div>
                      </TableCell>
                      <TableCell><Switch checked={r.is_enabled} onCheckedChange={v => updateRow(r.feature_key, { is_enabled: v })} /></TableCell>
                      <TableCell><Input className="w-20" type="number" value={r.daily_limit} onChange={e => updateRow(r.feature_key, { daily_limit: parseInt(e.target.value) || 0 })} /></TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" placeholder={`auto:${(r.daily_limit || 0) * 5}`}
                          value={r.weekly_limit ?? ''} onChange={e => updateRow(r.feature_key, { weekly_limit: e.target.value === '' ? null : parseInt(e.target.value) })} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" placeholder={`auto:${(r.daily_limit || 0) * 22}`}
                          value={r.monthly_limit ?? ''} onChange={e => updateRow(r.feature_key, { monthly_limit: e.target.value === '' ? null : parseInt(e.target.value) })} />
                      </TableCell>
                      <TableCell>
                        <Select value={model} onValueChange={v => updateRow(r.feature_key, { model_assignment: v })}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>{opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtUSD(perTask, 4)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-semibold">{fmtUSD(perTask * (r.daily_limit || 0))}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2">
                  <TableCell colSpan={7} className="text-right font-semibold">Daily total:</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{fmtUSD(projection.daily)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Per-user cost summary */}
          <div>
            <h3 className="font-semibold mb-2">Per-user cost summary (current plan)</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <SummaryTile label="Daily / user" value={fmtUSD(projection.daily)} />
              <SummaryTile label="Weekly (5 biz days)" value={fmtUSD(projection.weekly)} />
              <SummaryTile label="Monthly (22 biz days)" value={fmtUSD(projection.monthly)} />
              <SummaryTile label="Yearly" value={fmtUSD(projection.yearly)} />
              <SummaryTile label="Suggested daily cap" value={fmtUSD(suggestedDailyCap)} />
              <SummaryTile label="Suggested monthly cap" value={fmtUSD(suggestedMonthlyCap)} />
            </div>
          </div>

          {/* Suggested customer pricing */}
          <div>
            <h3 className="font-semibold mb-2">Suggested customer pricing</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <SummaryTile label="Your cost / user / mo" value={fmtUSD(projection.monthly)} />
              <SummaryTile label={`Charge customer (${markup}× markup)`} value={fmtUSD(customerPrice)} />
              <SummaryTile label="Profit / margin" value={`${fmtUSD(profit)} · ${marginPct.toFixed(0)}%`} />
            </div>
          </div>

          {/* Organization cost — headcount per plan */}
          <div>
            <h3 className="font-semibold mb-2">Organization cost — set headcount per plan</h3>
            <div className="rounded-md border divide-y">
              {allGroups.map(g => {
                const n = headcounts[g.id] ?? 0;
                const dailyForG = g.id === group.id
                  ? projection.daily
                  : (() => {
                      // approximate from saved features (use original per-group daily)
                      const fs = features.filter(f => f.group_id === g.id);
                      let d = 0;
                      fs.forEach(r => {
                        if (!r.is_enabled) return;
                        const m = r.model_assignment || MODEL_OPTIONS_BY_FEATURE[r.feature_key]?.[0] || 'gpt-4.1-mini';
                        d += effectiveTaskCost(g.id, r.feature_key, m) * (r.daily_limit || 0);
                      });
                      return d;
                    })();
                const monthly = dailyForG * 22 * n;
                return (
                  <div key={g.id} className="flex items-center justify-between p-3">
                    <span className="font-medium">{g.name}</span>
                    <div className="flex items-center gap-4">
                      <Input type="number" className="w-20"
                        value={n} onChange={e => setHeadcount(g.id, parseInt(e.target.value) || 0)} />
                      <span className="font-semibold tabular-nums w-28 text-right">{fmtUSD(monthly)}/mo</span>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between p-3 bg-muted/30">
                <span className="font-bold">Total org cost ({totalOrgUsers} users)</span>
                <span className="font-bold tabular-nums">{fmtUSD(orgProjection)}/mo</span>
              </div>
              <div className="flex items-center justify-between p-3 text-sm text-muted-foreground">
                <span>Revenue at current markup</span>
                <span className="text-right">
                  {fmtUSD(orgProjection * markup)}/mo · profit {fmtUSD(orgProjection * (markup - 1))}
                </span>
              </div>
            </div>
          </div>

          {/* Cost caps */}
          <div>
            <h3 className="font-semibold mb-2">Hard cost caps (enforced)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label>Per request ($)</Label><Input type="number" step="0.01" value={editCap.per_request_usd ?? ''} onChange={e => setEditCap({ ...editCap, per_request_usd: e.target.value === '' ? null : parseFloat(e.target.value) })} /></div>
              <div><Label>Per user/day ($)</Label><Input type="number" step="0.01" value={editCap.per_user_daily_usd ?? ''} onChange={e => setEditCap({ ...editCap, per_user_daily_usd: e.target.value === '' ? null : parseFloat(e.target.value) })} /></div>
              <div><Label>Per user/week ($)</Label><Input type="number" step="0.01" value={editCap.per_user_weekly_usd ?? ''} onChange={e => setEditCap({ ...editCap, per_user_weekly_usd: e.target.value === '' ? null : parseFloat(e.target.value) })} /></div>
              <div><Label>Per user/month ($)</Label><Input type="number" step="0.01" value={editCap.per_user_monthly_usd ?? ''} onChange={e => setEditCap({ ...editCap, per_user_monthly_usd: e.target.value === '' ? null : parseFloat(e.target.value) })} /></div>
            </div>
          </div>

          {/* Adjust task costs (advanced) */}
          <details className="border rounded-md">
            <summary className="cursor-pointer p-3 font-semibold">Adjust task costs (advanced)</summary>
            <div className="p-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">$/task</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => {
                    const opts = MODEL_OPTIONS_BY_FEATURE[r.feature_key] || Object.keys(MODEL_COSTS);
                    const model = r.model_assignment || opts[0];
                    const k = `${group.id}:${r.feature_key}`;
                    const baseCost = costPerTask(r.feature_key, model);
                    const val = taskCostOverrides[k] ?? baseCost;
                    return (
                      <TableRow key={r.feature_key}>
                        <TableCell className="font-medium">{ALL_FEATURES.find(a => a.key === r.feature_key)?.label}</TableCell>
                        <TableCell className="text-xs">{model}</TableCell>
                        <TableCell className="text-right">
                          <Input type="number" step="0.0001" className="w-28 ml-auto"
                            value={val}
                            onChange={e => setTaskCost(group.id, r.feature_key, e.target.value === '' ? null : parseFloat(e.target.value))} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">
                Overrides only affect projections in this calculator. Actual billed cost still comes from real model usage.
              </p>
            </div>
          </details>

          <Button disabled={diff.length === 0} onClick={() => setConfirmOpen(true)}>
            <Save className="w-4 h-4 mr-2" />Save & Apply ({diff.length} change{diff.length !== 1 ? 's' : ''})
          </Button>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Apply changes to {group.name}</DialogTitle>
                <DialogDescription>This applies immediately to {memberCount} member(s).</DialogDescription>
              </DialogHeader>
              <div className="max-h-72 overflow-auto space-y-1 text-xs font-mono bg-muted/30 p-3 rounded">
                {diff.map((d, i) => <div key={i}>{d}</div>)}
              </div>
              <div>
                <Label>Type CONFIRM to apply</Label>
                <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                <Button disabled={saving || confirmText !== 'CONFIRM'} onClick={save}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Apply
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

/* ============================================================
 * TAB 3: USERS
 * ============================================================ */
interface UserRow { user_id: string; email: string; full_name: string | null; group_id: string | null; }
interface OverrideRow {
  id: string; user_id: string; feature_key: string | null; override_type: string;
  override_value: string; reason: string | null; expires_at: string | null; is_active: boolean;
}

function UsersTab({
  orgId, groups, memberships, selectedUserId, setSelectedUserId, features,
}: {
  orgId: string; groups: PermissionGroup[];
  memberships: { user_id: string; group_id: string }[];
  selectedUserId: string | null; setSelectedUserId: (id: string | null) => void;
  features: GroupFeatureRow[];
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [showOverridesOnly, setShowOverridesOnly] = useState(false);

  const fetchUsers = useCallback(async () => {
    const { data: profs } = await supabase.from('user_profiles').select('user_id, email, full_name').eq('organization_id', orgId);
    const { data: ovs } = await supabase.from('user_overrides').select('*').eq('organization_id', orgId).eq('is_active', true);
    const rows = (profs || []).map(p => ({
      user_id: p.user_id, email: p.email, full_name: p.full_name,
      group_id: memberships.find(m => m.user_id === p.user_id)?.group_id || null,
    }));
    setUsers(rows);
    setOverrides((ovs || []) as OverrideRow[]);
  }, [orgId, memberships]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filtered = users.filter(u => {
    if (search && !(`${u.email} ${u.full_name || ''}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (groupFilter !== 'all' && u.group_id !== groupFilter) return false;
    if (showOverridesOnly && !overrides.some(o => o.user_id === u.user_id)) return false;
    return true;
  });

  const selectedUser = users.find(u => u.user_id === selectedUserId);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <Input placeholder="Search by name or email" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showOverridesOnly} onCheckedChange={v => setShowOverridesOnly(!!v)} />
            Has overrides
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Active overrides</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(u => {
                const g = groups.find(gg => gg.id === u.group_id);
                const userOvs = overrides.filter(o => o.user_id === u.user_id);
                return (
                  <TableRow key={u.user_id}>
                    <TableCell>
                      <div className="font-medium">{u.full_name || u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>{g ? <Badge variant="outline">{g.name}</Badge> : <span className="text-muted-foreground text-xs">none</span>}</TableCell>
                    <TableCell>{userOvs.length === 0 ? <span className="text-muted-foreground text-xs">None</span> : <Badge>{userOvs.length} active</Badge>}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={() => setSelectedUserId(u.user_id)}>Edit</Button></TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No users</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedUser && (
        <UserOverridePanel
          orgId={orgId}
          user={selectedUser}
          group={groups.find(g => g.id === selectedUser.group_id) || null}
          overrides={overrides.filter(o => o.user_id === selectedUser.user_id)}
          features={features.filter(f => f.group_id === selectedUser.group_id)}
          onClose={() => setSelectedUserId(null)}
          onChange={fetchUsers}
        />
      )}
    </div>
  );
}

function UserOverridePanel({
  orgId, user, group, overrides, features, onClose, onChange,
}: {
  orgId: string; user: UserRow; group: PermissionGroup | null;
  overrides: OverrideRow[]; features: GroupFeatureRow[];
  onClose: () => void; onChange: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  const removeOverride = async (id: string) => {
    const { error } = await supabase.from('user_overrides').update({ is_active: false }).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Override removed'); onChange(); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">{user.full_name || user.email}</CardTitle>
          <p className="text-xs text-muted-foreground">{user.email} · {group?.name || 'No group'}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-1" />Add Override</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold mb-2">Active overrides</h4>
          {overrides.length === 0 && <p className="text-sm text-muted-foreground">None</p>}
          {overrides.map(o => (
            <div key={o.id} className="flex items-center justify-between border rounded p-3 mb-2">
              <div className="text-sm">
                <div><strong>{o.feature_key || 'all'}</strong> · {o.override_type}: <code>{o.override_value}</code></div>
                {o.reason && <div className="text-xs text-muted-foreground">Reason: {o.reason}</div>}
                <div className="text-xs text-muted-foreground">Expires: {o.expires_at ? new Date(o.expires_at).toLocaleString() : 'Never'}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => removeOverride(o.id)}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-2">Group defaults</h4>
          <div className="text-xs text-muted-foreground border rounded p-3 max-h-48 overflow-auto">
            {features.map(f => (
              <div key={f.feature_key} className="flex justify-between py-0.5">
                <span>{f.feature_key}</span>
                <span>{f.is_enabled ? `${f.daily_limit}/day · ${f.model_assignment || 'auto'}` : 'disabled'}</span>
              </div>
            ))}
          </div>
        </div>

        <AddOverrideDialog
          open={addOpen} onOpenChange={setAddOpen}
          orgId={orgId} userId={user.user_id} createdBy={user.user_id}
          onSaved={() => { setAddOpen(false); onChange(); }}
        />
      </CardContent>
    </Card>
  );
}

function AddOverrideDialog({
  open, onOpenChange, orgId, userId, createdBy, onSaved,
}: {
  open: boolean; onOpenChange: (b: boolean) => void;
  orgId: string; userId: string; createdBy: string; onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [featureKey, setFeatureKey] = useState<string>('ai_chat');
  const [overrideType, setOverrideType] = useState<string>('daily_limit');
  const [overrideValue, setOverrideValue] = useState<string>('');
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState<'never' | 'today' | 'week' | 'month' | 'custom'>('month');
  const [customDate, setCustomDate] = useState('');
  const [saving, setSaving] = useState(false);

  const resolveExpiry = (): string | null => {
    const now = new Date();
    if (expiry === 'never') return null;
    if (expiry === 'today') { now.setHours(23, 59, 59); return now.toISOString(); }
    if (expiry === 'week') { now.setDate(now.getDate() + (7 - now.getDay())); now.setHours(23, 59, 59); return now.toISOString(); }
    if (expiry === 'month') { const d = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); return d.toISOString(); }
    if (expiry === 'custom' && customDate) return new Date(customDate).toISOString();
    return null;
  };

  const submit = async () => {
    if (!overrideValue) { toast.error('Value required'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('user_overrides').insert({
        user_id: userId,
        organization_id: orgId,
        feature_key: featureKey,
        override_type: overrideType,
        override_value: overrideValue,
        reason: reason || null,
        expires_at: resolveExpiry(),
        created_by: profile?.user_id || createdBy,
        is_active: true,
      });
      if (error) throw error;
      await supabase.from('admin_audit_log').insert({
        action: 'add_user_override', organization_id: orgId, target_user_id: userId,
        details: { feature_key: featureKey, override_type: overrideType, override_value: overrideValue } as any,
      });
      toast.success('Override added');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add override</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Feature</Label>
            <Select value={featureKey} onValueChange={setFeatureKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_FEATURES.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Override type</Label>
            <Select value={overrideType} onValueChange={setOverrideType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily_limit">Set daily limit</SelectItem>
                <SelectItem value="weekly_limit">Set weekly limit</SelectItem>
                <SelectItem value="monthly_limit">Set monthly limit</SelectItem>
                <SelectItem value="model_assignment">Change model</SelectItem>
                <SelectItem value="per_request_usd">Per-request cap ($)</SelectItem>
                <SelectItem value="per_user_daily_usd">Per-user daily cap ($)</SelectItem>
                <SelectItem value="per_user_monthly_usd">Per-user monthly cap ($)</SelectItem>
                <SelectItem value="is_enabled">Enable/disable feature</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Value</Label>
            {overrideType === 'model_assignment' ? (
              <Select value={overrideValue} onValueChange={setOverrideValue}>
                <SelectTrigger><SelectValue placeholder="Pick a model" /></SelectTrigger>
                <SelectContent>{(MODEL_OPTIONS_BY_FEATURE[featureKey] || Object.keys(MODEL_COSTS)).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            ) : overrideType === 'is_enabled' ? (
              <Select value={overrideValue} onValueChange={setOverrideValue}>
                <SelectTrigger><SelectValue placeholder="true/false" /></SelectTrigger>
                <SelectContent><SelectItem value="true">Enable</SelectItem><SelectItem value="false">Disable</SelectItem></SelectContent>
              </Select>
            ) : (
              <Input value={overrideValue} onChange={e => setOverrideValue(e.target.value)} placeholder="e.g. 30 or 2.50" />
            )}
          </div>
          <div><Label>Reason</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div>
            <Label>Expires</Label>
            <Select value={expiry} onValueChange={(v: any) => setExpiry(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="today">End of today</SelectItem>
                <SelectItem value="week">End of week</SelectItem>
                <SelectItem value="month">End of month</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {expiry === 'custom' && <Input type="datetime-local" value={customDate} onChange={e => setCustomDate(e.target.value)} className="mt-2" />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Add Override</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
 * TAB 4: LIVE ACTIVITY
 * ============================================================ */
function LiveActivityTab({
  orgId, groups, memberships, jumpToGroup, jumpToUser,
}: {
  orgId: string; groups: PermissionGroup[];
  memberships: { user_id: string; group_id: string }[];
  jumpToGroup: (id: string) => void; jumpToUser: (id: string) => void;
}) {
  const [logs, setLogs] = useState<any[]>([]);
  const [users, setUsers] = useState<Record<string, { email: string; full_name: string | null }>>({});
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const { data } = await supabase.from('ai_usage_logs')
      .select('id, created_at, user_id, action, model, provider, cost_usd, prompt_tokens, completion_tokens, metadata')
      .eq('organization_id', orgId)
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(500);
    setLogs(data || []);
    const { data: profs } = await supabase.from('user_profiles').select('user_id, email, full_name').eq('organization_id', orgId);
    const map: Record<string, any> = {};
    (profs || []).forEach((p: any) => map[p.user_id] = { email: p.email, full_name: p.full_name });
    setUsers(map);
  }, [orgId]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0, 0, 0, 0);

  const groupBreakdown = groups.map(g => {
    const memberIds = new Set(memberships.filter(m => m.group_id === g.id).map(m => m.user_id));
    const gLogs = logs.filter(l => memberIds.has(l.user_id));
    const todayLogs = gLogs.filter(l => new Date(l.created_at) >= today);
    const weekLogs = gLogs.filter(l => new Date(l.created_at) >= weekStart);
    const sum = (xs: any[]) => xs.reduce((s, l) => s + Number(l.cost_usd || 0), 0);
    return {
      group: g, memberCount: memberIds.size,
      today: sum(todayLogs), week: sum(weekLogs), month: sum(gLogs),
    };
  });

  const featureSpend: Record<string, number> = {};
  const modelSpend: Record<string, number> = {};
  logs.forEach(l => {
    featureSpend[l.action] = (featureSpend[l.action] || 0) + Number(l.cost_usd || 0);
    modelSpend[l.model] = (modelSpend[l.model] || 0) + Number(l.cost_usd || 0);
  });
  const totalSpend = Object.values(featureSpend).reduce((a, b) => a + b, 0) || 1;

  const exportCSV = () => {
    const rows = [['time', 'user', 'feature', 'model', 'cost_usd', 'tokens_in', 'tokens_out']];
    logs.forEach(l => rows.push([l.created_at, users[l.user_id]?.email || l.user_id, l.action, l.model, String(l.cost_usd), String(l.prompt_tokens || 0), String(l.completion_tokens || 0)]));
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ai-activity.csv'; a.click();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Per-group breakdown</CardTitle>
            <Button size="sm" variant="outline" onClick={exportCSV}>Export CSV</Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Group</TableHead><TableHead>Members</TableHead><TableHead>Today</TableHead><TableHead>Week</TableHead><TableHead>Month</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {groupBreakdown.map(b => (
                  <GroupBreakdownRow key={b.group.id} b={b} expanded={expandedGroup === b.group.id}
                    onToggle={() => setExpandedGroup(expandedGroup === b.group.id ? null : b.group.id)}
                    jumpToGroup={jumpToGroup} jumpToUser={jumpToUser}
                    memberships={memberships} logs={logs} users={users} today={today} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Live activity feed</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Feature</TableHead><TableHead>Model</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {logs.slice(0, 50).map(l => {
                  const blocked = (l.metadata as any)?.blocked === true;
                  return (
                    <TableRow key={l.id} className={blocked ? 'bg-destructive/10' : ''}>
                      <TableCell className="text-xs">{new Date(l.created_at).toLocaleTimeString()}</TableCell>
                      <TableCell className="text-xs">{users[l.user_id]?.email || l.user_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{l.action}</TableCell>
                      <TableCell className="text-xs">{l.model}</TableCell>
                      <TableCell className="text-xs">{blocked ? <Badge variant="destructive">BLOCKED</Badge> : fmtUSD(Number(l.cost_usd || 0), 4)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Spend by feature (MTD)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {Object.entries(featureSpend).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between"><span>{k}</span><span>{((v / totalSpend) * 100).toFixed(0)}% · {fmtUSD(v, 4)}</span></div>
                <div className="h-1.5 bg-muted rounded"><div className="h-full bg-primary rounded" style={{ width: `${(v / totalSpend) * 100}%` }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Spend by model (MTD)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {Object.entries(modelSpend).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between"><span>{k || 'unknown'}</span><span>{((v / totalSpend) * 100).toFixed(0)}% · {fmtUSD(v, 4)}</span></div>
                <div className="h-1.5 bg-muted rounded"><div className="h-full bg-emerald-500 rounded" style={{ width: `${(v / totalSpend) * 100}%` }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Alerts</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <p>Auto-refreshing every 30 seconds.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GroupBreakdownRow({ b, expanded, onToggle, jumpToGroup, jumpToUser, memberships, logs, users, today }: any) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell><Button variant="link" size="sm" className="p-0 h-auto" onClick={(e) => { e.stopPropagation(); jumpToGroup(b.group.id); }}>{b.group.name}</Button></TableCell>
        <TableCell>{b.memberCount}</TableCell>
        <TableCell>{fmtUSD(b.today)}</TableCell>
        <TableCell>{fmtUSD(b.week)}</TableCell>
        <TableCell>{fmtUSD(b.month)}</TableCell>
        <TableCell><ChevronRight className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} /></TableCell>
      </TableRow>
      {expanded && (
        <TableRow><TableCell colSpan={6} className="bg-muted/30">
          <div className="space-y-1 text-sm py-2">
            {[...new Set(memberships.filter((m: any) => m.group_id === b.group.id).map((m: any) => m.user_id))].map((uid: any) => {
              const uLogs = logs.filter((l: any) => l.user_id === uid);
              const uToday = uLogs.filter((l: any) => new Date(l.created_at) >= today).reduce((s: number, l: any) => s + Number(l.cost_usd || 0), 0);
              return (
                <div key={uid} className="flex justify-between items-center">
                  <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => jumpToUser(uid)}>{users[uid]?.email || uid}</Button>
                  <span>{fmtUSD(uToday)} today · {fmtUSD(uLogs.reduce((s: number, l: any) => s + Number(l.cost_usd || 0), 0))} month</span>
                </div>
              );
            })}
          </div>
        </TableCell></TableRow>
      )}
    </>
  );
}

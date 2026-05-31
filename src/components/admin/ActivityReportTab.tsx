import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Download, Users, Sparkles, Coins, DollarSign, RefreshCw } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts';
import { useToast } from '@/hooks/use-toast';

type RangePreset = 'today' | '7d' | '14d' | '30d' | 'custom';

interface ReportRow {
  user_id: string;
  email: string;
  full_name: string | null;
  department: string | null;
  total_actions: number;
  ai_drafts: number;
  auto_replies: number;
  chats: number;
  daily_briefs: number;
  email_agent: number;
  meeting_copilot: number;
  follow_up: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  last_active: string | null;
}

interface TimeseriesRow {
  day: string;
  action: string;
  events: number;
  cost_usd: number;
}

interface DepartmentRow {
  department: string;
  user_count: number;
}

const ACTION_LABEL: Record<string, string> = {
  ai_draft: 'AI Drafts',
  ai_auto_reply: 'Auto Replies',
  ai_chat: 'Chat',
  daily_brief: 'Daily Brief',
  email_agent: 'Email Agent',
  meeting_copilot: 'Meeting Copilot',
  meeting_copilot_prep: 'Meeting Copilot',
  meeting_copilot_summary: 'Meeting Copilot',
  follow_up_reminder: 'Follow-Up',
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

function rangeBounds(preset: RangePreset, customStart: string, customEnd: string): [Date, Date] {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  switch (preset) {
    case 'today':
      break;
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '14d':
      start.setDate(start.getDate() - 13);
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      break;
    case 'custom':
      if (customStart) start.setTime(new Date(customStart + 'T00:00:00').getTime());
      if (customEnd) end.setTime(new Date(customEnd + 'T23:59:59').getTime());
      break;
  }
  return [start, end];
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export default function ActivityReportTab() {
  const { toast } = useToast();
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [department, setDepartment] = useState<string>('__all__');
  const [userFilter, setUserFilter] = useState<string>('__all__');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [start, end] = useMemo(
    () => rangeBounds(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  const load = async () => {
    setLoading(true);
    try {
      const deptArg = department === '__all__' ? null : department;
      const userArg = userFilter === '__all__' ? null : userFilter;
      const [report, ts, depts] = await Promise.all([
        supabase.rpc('admin_activity_report', {
          _start: start.toISOString(),
          _end: end.toISOString(),
          _department: deptArg,
          _user_id: userArg,
        }),
        supabase.rpc('admin_activity_timeseries', {
          _start: start.toISOString(),
          _end: end.toISOString(),
          _department: deptArg,
          _user_id: userArg,
        }),
        supabase.rpc('admin_visible_departments'),
      ]);
      if (report.error) throw report.error;
      if (ts.error) throw ts.error;
      if (depts.error) throw depts.error;
      setRows((report.data ?? []) as ReportRow[]);
      setTimeseries((ts.data ?? []) as TimeseriesRow[]);
      setDepartments((depts.data ?? []) as DepartmentRow[]);
    } catch (e: any) {
      console.error('activity report load failed', e);
      toast({ title: 'Failed to load activity', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [preset, customStart, customEnd, department, userFilter]);

  // ---- Aggregates ----
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.actions += Number(r.total_actions || 0);
        acc.tokens += Number(r.tokens_in || 0) + Number(r.tokens_out || 0);
        acc.cost += Number(r.cost_usd || 0);
        if (Number(r.total_actions || 0) > 0) acc.activeUsers += 1;
        return acc;
      },
      { actions: 0, tokens: 0, cost: 0, activeUsers: 0 },
    );
  }, [rows]);

  // Stacked time series — pivot by action.
  const stackedSeries = useMemo(() => {
    const days = new Map<string, Record<string, number>>();
    const actions = new Set<string>();
    for (const r of timeseries) {
      const a = r.action in ACTION_LABEL ? r.action : r.action;
      actions.add(a);
      if (!days.has(r.day)) days.set(r.day, {});
      const bucket = days.get(r.day)!;
      bucket[a] = (bucket[a] || 0) + Number(r.events || 0);
    }
    const sortedDays = Array.from(days.keys()).sort();
    const data = sortedDays.map((d) => ({ day: d.slice(5), ...days.get(d) }));
    return { data, actions: Array.from(actions) };
  }, [timeseries]);

  // Top-10 users by total actions
  const topUsers = useMemo(() => {
    return [...rows]
      .filter((r) => Number(r.total_actions || 0) > 0)
      .sort((a, b) => Number(b.total_actions) - Number(a.total_actions))
      .slice(0, 10)
      .map((r) => ({
        name: (r.full_name || r.email || '').split('@')[0],
        actions: Number(r.total_actions || 0),
      }));
  }, [rows]);

  // Donut: breakdown by feature
  const featureBreakdown = useMemo(() => {
    const totals: Record<string, number> = {
      ai_draft: 0, ai_auto_reply: 0, ai_chat: 0, daily_brief: 0,
      email_agent: 0, meeting_copilot: 0, follow_up_reminder: 0,
    };
    for (const r of rows) {
      totals.ai_draft += Number(r.ai_drafts || 0);
      totals.ai_auto_reply += Number(r.auto_replies || 0);
      totals.ai_chat += Number(r.chats || 0);
      totals.daily_brief += Number(r.daily_briefs || 0);
      totals.email_agent += Number(r.email_agent || 0);
      totals.meeting_copilot += Number(r.meeting_copilot || 0);
      totals.follow_up_reminder += Number(r.follow_up || 0);
    }
    return Object.entries(totals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: ACTION_LABEL[k] ?? k, value: v }));
  }, [rows]);

  const exportCSV = () => {
    const header = [
      'Email', 'Name', 'Department', 'Total actions',
      'AI Drafts', 'Auto Replies', 'Chat', 'Daily Brief',
      'Email Agent', 'Meeting Copilot', 'Follow-Up',
      'Tokens In', 'Tokens Out', 'Cost USD', 'Last Active',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.email, r.full_name ?? '', r.department ?? '',
        r.total_actions, r.ai_drafts, r.auto_replies, r.chats, r.daily_briefs,
        r.email_agent, r.meeting_copilot, r.follow_up,
        r.tokens_in, r.tokens_out, Number(r.cost_usd || 0).toFixed(6),
        r.last_active ?? '',
      ].map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    a.download = `inboxiq-activity_${startStr}_to_${endStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const userOptions = useMemo(
    () => rows.map((r) => ({ id: r.user_id, label: r.full_name || r.email })),
    [rows],
  );

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">User Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs">Date range</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="14d">Last 14 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === 'custom' && (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.department} value={d.department}>
                      {d.department} ({d.user_count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">User</Label>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All users</SelectItem>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={load} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
              <Button onClick={exportCSV} disabled={rows.length === 0}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing data from {start.toLocaleDateString()} to {end.toLocaleDateString()}.
          </p>
        </CardContent>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Users className="w-4 h-4" />} label="Active users" value={totals.activeUsers.toLocaleString()} />
        <KpiCard icon={<Sparkles className="w-4 h-4" />} label="Total actions" value={totals.actions.toLocaleString()} />
        <KpiCard icon={<Coins className="w-4 h-4" />} label="Tokens used" value={totals.tokens.toLocaleString()} />
        <KpiCard icon={<DollarSign className="w-4 h-4" />} label="AI cost" value={`$${totals.cost.toFixed(2)}`} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Activity over time</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stackedSeries.data}>
                  <defs>
                    {stackedSeries.actions.map((a, i) => (
                      <linearGradient key={a} id={`g-${a}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.6} />
                        <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {stackedSeries.actions.map((a, i) => (
                    <Area
                      key={a}
                      type="monotone"
                      dataKey={a}
                      name={ACTION_LABEL[a] ?? a}
                      stackId="1"
                      stroke={COLORS[i % COLORS.length]}
                      fill={`url(#g-${a})`}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Feature breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {featureBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center pt-20">No activity yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={featureBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {featureBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Top users</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[260px]">
            {topUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center pt-20">No user activity in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topUsers} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="actions" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-user table */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Per-user breakdown</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Department</th>
                <th className="py-2 pr-3 text-right">Drafts</th>
                <th className="py-2 pr-3 text-right">Auto-Replies</th>
                <th className="py-2 pr-3 text-right">Chat</th>
                <th className="py-2 pr-3 text-right">Briefs</th>
                <th className="py-2 pr-3 text-right">Email Agent</th>
                <th className="py-2 pr-3 text-right">Meeting</th>
                <th className="py-2 pr-3 text-right">Follow-Up</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3 text-right">Tokens</th>
                <th className="py-2 pr-3 text-right">Cost</th>
                <th className="py-2 pr-3">Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={13} className="py-6 text-center text-muted-foreground">No data.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.user_id} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.full_name || r.email}</div>
                    {r.full_name && <div className="text-xs text-muted-foreground">{r.email}</div>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.department || '—'}</td>
                  <td className="py-2 pr-3 text-right">{r.ai_drafts}</td>
                  <td className="py-2 pr-3 text-right">{r.auto_replies}</td>
                  <td className="py-2 pr-3 text-right">{r.chats}</td>
                  <td className="py-2 pr-3 text-right">{r.daily_briefs}</td>
                  <td className="py-2 pr-3 text-right">{r.email_agent}</td>
                  <td className="py-2 pr-3 text-right">{r.meeting_copilot}</td>
                  <td className="py-2 pr-3 text-right">{r.follow_up}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{r.total_actions}</td>
                  <td className="py-2 pr-3 text-right">{(Number(r.tokens_in) + Number(r.tokens_out)).toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right">${Number(r.cost_usd || 0).toFixed(4)}</td>
                  <td className="py-2 pr-3 text-muted-foreground text-xs">
                    {r.last_active ? new Date(r.last_active).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

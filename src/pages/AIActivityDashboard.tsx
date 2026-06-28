import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, FileText, Send, Download, CalendarIcon, TrendingUp, Mail as MailIcon, CalendarCheck, MessageSquare, Video } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { PageHero } from '@/components/app/PageHero';
import { BarChart3 } from 'lucide-react';
import { FeatureUsageGrid } from '@/components/app/FeatureUsageGrid';
import { ReportExportMenu } from '@/components/reports/ReportExportMenu';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  RadialBarChart,
  RadialBar,
  Legend,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';



interface ActivityStats {
  totalDrafts: number;
  totalAutoReplies: number;
  totalEmails: number;
  totalScheduledEvents: number;
  totalChatMessages: number;
  totalChatConversations: number;
  totalMeetings: number;
}

interface DailyActivity {
  date: string;
  drafts: number;
  autoReplies: number;
}

interface CategoryBreakdown {
  categoryName: string;
  drafts: number;
  autoReplies: number;
}

type DateRange = '7days' | '30days' | '90days' | 'custom';

export default function AIActivityDashboard() {
  const { user, organization, loading: authLoading } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ActivityStats>({ totalDrafts: 0, totalAutoReplies: 0, totalEmails: 0, totalScheduledEvents: 0, totalChatMessages: 0, totalChatConversations: 0, totalMeetings: 0 });
  const [dailyActivity, setDailyActivity] = useState<DailyActivity[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('30days');
  const [customStartDate, setCustomStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [customEndDate, setCustomEndDate] = useState<Date | undefined>(new Date());
  

  const getDateRange = () => {
    const end = endOfDay(new Date());
    let start: Date;

    switch (dateRange) {
      case '7days':
        start = startOfDay(subDays(new Date(), 7));
        break;
      case '30days':
        start = startOfDay(subDays(new Date(), 30));
        break;
      case '90days':
        start = startOfDay(subDays(new Date(), 90));
        break;
      case 'custom':
        start = startOfDay(customStartDate || subDays(new Date(), 30));
        break;
      default:
        start = startOfDay(subDays(new Date(), 30));
    }

    return { start, end: dateRange === 'custom' && customEndDate ? endOfDay(customEndDate) : end };
  };

  useEffect(() => {
    if (organization?.id && user?.id) {
      fetchActivityData();
    }
  }, [organization?.id, user?.id, activeConnection?.id, dateRange, customStartDate, customEndDate]);

  const fetchActivityData = async () => {
    if (!organization?.id || !user?.id) return;
    setLoading(true);

    try {
      const { start, end } = getDateRange();
      const startIso = start.toISOString();
      const endIso = end.toISOString();

      // AI activity logs (drafts, auto-replies, scheduled events) - scoped to current user
      let activityQuery = supabase
        .from('ai_activity_logs')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('user_id', user.id)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false });

      if (activeConnection?.id) {
        activityQuery = activityQuery.eq('connection_id', activeConnection.id);
      }

      const [activityRes, chatMsgRes, chatConvRes, meetingsRes] = await Promise.all([
        activityQuery,
        supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('role', 'user')
          .gte('created_at', startIso)
          .lte('created_at', endIso),
        supabase
          .from('chat_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', startIso)
          .lte('created_at', endIso),
        supabase
          .from('meeting_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('started_at', startIso)
          .lte('started_at', endIso),
      ]);

      const logs = activityRes.data || [];
      if (activityRes.error) console.error('Error fetching activity logs:', activityRes.error);

      const drafts = logs.filter(l => l.activity_type === 'draft');
      const autoReplies = logs.filter(l => l.activity_type === 'auto_reply');
      const scheduledEvents = logs.filter(l => l.activity_type === 'scheduled_event');

      setStats({
        totalDrafts: drafts.length,
        totalAutoReplies: autoReplies.length,
        totalEmails: logs.length,
        totalScheduledEvents: scheduledEvents.length,
        totalChatMessages: chatMsgRes.count || 0,
        totalChatConversations: chatConvRes.count || 0,
        totalMeetings: meetingsRes.count || 0,
      });

      // Daily activity (drafts + auto-replies)
      const dailyMap = new Map<string, { drafts: number; autoReplies: number }>();
      logs.forEach(log => {
        const date = format(new Date(log.created_at), 'yyyy-MM-dd');
        const current = dailyMap.get(date) || { drafts: 0, autoReplies: 0 };
        if (log.activity_type === 'draft') current.drafts++;
        else if (log.activity_type === 'auto_reply') current.autoReplies++;
        dailyMap.set(date, current);
      });
      const dailyData: DailyActivity[] = Array.from(dailyMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));
      setDailyActivity(dailyData);

      // Category breakdown
      const categoryMap = new Map<string, { drafts: number; autoReplies: number }>();
      logs.forEach(log => {
        const current = categoryMap.get(log.category_name) || { drafts: 0, autoReplies: 0 };
        if (log.activity_type === 'draft') current.drafts++;
        else if (log.activity_type === 'auto_reply') current.autoReplies++;
        categoryMap.set(log.category_name, current);
      });
      const categoryData: CategoryBreakdown[] = Array.from(categoryMap.entries())
        .map(([categoryName, data]) => ({ categoryName, ...data }))
        .sort((a, b) => (b.drafts + b.autoReplies) - (a.drafts + a.autoReplies));
      setCategoryBreakdown(categoryData);

    } catch (error) {
      console.error('Error fetching activity:', error);
    } finally {
      setLoading(false);
    }
  };

  const buildExportRows = async () => {
    const { start, end } = getDateRange();
    const { data: logs } = await supabase
      .from('ai_activity_logs')
      .select('*')
      .eq('organization_id', organization?.id)
      .eq('user_id', user?.id)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });
    return (logs || []).map((log) => ({
      Date: format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
      Category: log.category_name,
      'Activity Type': log.activity_type === 'draft' ? 'AI Draft' : log.activity_type === 'auto_reply' ? 'AI Auto-Reply' : log.activity_type,
      'Email Subject': log.email_subject || '',
      'Email From': log.email_from || '',
    }));
  };

  const [exportRows, setExportRows] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    if (!organization?.id || !user?.id) return;
    buildExportRows().then(setExportRows).catch(() => setExportRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, user?.id, dateRange, customStartDate, customEndDate]);

  const emailReport = async () => {
    const { start, end } = getDateRange();
    const { error } = await supabase.functions.invoke('ai-activity-report-email', {
      body: {
        from: format(start, 'yyyy-MM-dd'),
        to: format(end, 'yyyy-MM-dd'),
        range_label: `${format(start, 'MMM d, yyyy')} → ${format(end, 'MMM d, yyyy')}`,
      },
    });
    if (error) throw error;
  };


  if (authLoading || emailLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Note: we no longer block when there's no active connection — chat & meeting
  // activity exist independent of an email connection.

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Reports"
          title="AI Activity Report"
          description="Your AI activity — drafts, auto-replies, scheduled events, chats, and meetings. Filter by date range, export, or print."
          accent="green"
          icon={<BarChart3 className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in">
        <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">

        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div />

        <div className="flex flex-wrap items-center gap-3">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7days">Last 7 days</SelectItem>
              <SelectItem value="30days">Last 30 days</SelectItem>
              <SelectItem value="90days">Last 90 days</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>

          {dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[130px] justify-start text-left font-normal", !customStartDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customStartDate ? format(customStartDate, "MMM dd, yyyy") : "Start"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customStartDate} onSelect={setCustomStartDate} initialFocus />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[130px] justify-start text-left font-normal", !customEndDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customEndDate ? format(customEndDate, "MMM dd, yyyy") : "End"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customEndDate} onSelect={setCustomEndDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
          )}

          <ReportExportMenu
            fileName={`ai-activity-report-${format(getDateRange().start, 'yyyy-MM-dd')}-to-${format(getDateRange().end, 'yyyy-MM-dd')}`}
            sheetName="AI Activity"
            rows={exportRows}
            onEmail={emailReport}
            emailRecipientLabel={user?.email}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* 4 Hero KPIs — themed */}
          <div data-tour="aa-hero-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { title: 'AI Drafts Created', value: stats.totalDrafts, sub: 'Replies drafted for your review', Icon: FileText, token: 'primary' },
              { title: 'AI Auto-Replies Sent', value: stats.totalAutoReplies, sub: 'Auto-sent on your behalf', Icon: Send, token: 'accent' },
              { title: 'AI Chat Messages', value: stats.totalChatMessages, sub: `${stats.totalChatConversations} chat conversation${stats.totalChatConversations === 1 ? '' : 's'}`, Icon: MessageSquare, token: 'secondary' },
              { title: 'Meetings with Copilot', value: stats.totalMeetings, sub: 'Transcribed & summarized', Icon: Video, token: 'muted' },
            ].map(({ title, value, sub, Icon, token }) => (
              <Card
                key={title}
                className="h-full overflow-hidden relative border-border/60"
                style={{
                  background: `linear-gradient(135deg, hsl(var(--${token}) / 0.12), hsl(var(--card)) 70%)`,
                }}
              >
                <div
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: `hsl(var(--${token}))` }}
                />
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground leading-snug min-h-[2.5rem] line-clamp-2">
                    {title}
                  </CardTitle>
                  <div
                    className="grid place-items-center w-8 h-8 rounded-lg shrink-0"
                    style={{ background: `hsl(var(--${token}) / 0.18)`, color: `hsl(var(--${token}))` }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold tabular-nums leading-none">{value}</div>
                  <p className="text-xs text-muted-foreground mt-2 min-h-[2rem] line-clamp-2">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Secondary metrics — slim row */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            {[
              { title: 'Events Scheduled', value: stats.totalScheduledEvents, sub: 'Calendar events booked from emails', Icon: CalendarCheck },
              { title: 'Total AI-Processed Emails', value: stats.totalEmails, sub: 'All inbound emails handled by AI', Icon: MailIcon },
            ].map(({ title, value, sub, Icon }) => (
              <Card key={title} className="h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="grid place-items-center w-9 h-9 rounded-lg bg-muted text-foreground/70 shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">{title}</div>
                    <div className="text-xl font-bold tabular-nums leading-tight">{value}</div>
                  </div>
                  <div className="text-[11px] text-muted-foreground text-right max-w-[40%] hidden sm:block">{sub}</div>
                </CardContent>
              </Card>
            ))}
          </div>


          {/* AI usage by feature — donut + radial */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />AI usage by feature</CardTitle>
              <CardDescription>Which features used the most AI for this date range</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const palette = ['#3b82f6', '#f97316', '#a855f7', '#06b6d4', '#22c55e', '#ec4899'];
                const items = [
                  { name: 'AI Drafts', value: stats.totalDrafts },
                  { name: 'AI Auto-Replies', value: stats.totalAutoReplies },
                  { name: 'Scheduled Events', value: stats.totalScheduledEvents },
                  { name: 'Emails AI Processed', value: stats.totalEmails },
                  { name: 'AI Chat Messages', value: stats.totalChatMessages },
                  { name: 'Meeting Copilot', value: stats.totalMeetings },
                ]
                  .map((i, idx) => ({ ...i, fill: palette[idx % palette.length] }))
                  .sort((a, b) => b.value - a.value);
                const total = items.reduce((s, i) => s + i.value, 0);
                if (total === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-10">No AI activity recorded in this range yet.</p>;
                }
                const top = items[0];
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
                    {/* Donut */}
                    <div className="relative h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <RTooltip
                            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                            formatter={(v: number, n: string) => [`${v} (${((v/total)*100).toFixed(0)}%)`, n]}
                          />
                          <Pie data={items} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2} stroke="hsl(var(--background))" strokeWidth={2}>
                            {items.map((it) => <Cell key={it.name} fill={it.fill} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="text-3xl font-bold tabular-nums leading-none">{total}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Total AI actions</div>
                        <div className="text-xs text-muted-foreground mt-2 text-center max-w-[140px]">
                          Top: <span className="font-medium text-foreground">{top.name}</span>
                        </div>
                      </div>
                    </div>
                    {/* Ranking list — clean, readable */}
                    <div className="h-[280px] flex flex-col justify-center gap-2.5 px-2">
                      {items.map((it) => {
                        const pct = total > 0 ? (it.value / total) * 100 : 0;
                        return (
                          <div key={it.name} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.fill }} />
                                <span className="font-medium text-foreground truncate">{it.name}</span>
                              </div>
                              <div className="tabular-nums text-muted-foreground shrink-0 ml-2">
                                <span className="font-semibold text-foreground">{it.value}</span>
                                <span className="ml-1 text-[10px]">({pct.toFixed(0)}%)</span>
                              </div>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${pct}%`, background: it.fill }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Plan Usage & Limits — per-feature quota tiles */}
          <FeatureUsageGrid />




          {/* Category Breakdown — themed stacked bars */}
          <Card data-tour="aa-category" className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Activity by Category
              </CardTitle>
              <CardDescription>AI processing breakdown per email category</CardDescription>
            </CardHeader>
            <CardContent>
              {categoryBreakdown.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No AI activity recorded yet. Enable AI Draft or AI Auto-Reply on your categories to start tracking.
                </div>
              ) : (
                <div style={{ width: '100%', height: Math.max(220, categoryBreakdown.length * 36) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryBreakdown} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                      <YAxis type="category" dataKey="categoryName" stroke="hsl(var(--muted-foreground))" fontSize={11} width={120} />
                      <RTooltip
                        contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                        cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="drafts" name="AI Drafts" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="autoReplies" name="AI Auto-Replies" stackId="a" fill="#f97316" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily Activity — themed area chart */}
          {dailyActivity.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />Daily Activity</CardTitle>
                <CardDescription>AI drafts and auto-replies over time</CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={dailyActivity.slice(-30).map(d => ({ ...d, label: format(new Date(d.date), 'MMM dd') }))}
                      margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                    >
                      <defs>
                        <linearGradient id="gradDrafts" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="gradAuto" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                      <RTooltip
                        contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="drafts" name="AI Drafts" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gradDrafts)" />
                      <Area type="monotone" dataKey="autoReplies" name="AI Auto-Replies" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#gradAuto)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

        </>
      )}
        </div>
      </div>
    </div>
  );
}


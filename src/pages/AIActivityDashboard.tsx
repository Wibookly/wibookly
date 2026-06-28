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
  const [exporting, setExporting] = useState(false);

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
          {/* Email AI activity */}
          <div className="mb-3 flex items-center gap-2">
            <MailIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Email AI</h3>
          </div>
          <div data-tour="aa-email-stats" className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { title: 'AI Drafts Created', value: stats.totalDrafts, sub: 'Emails drafted by AI for your review', Icon: FileText, color: 'text-blue-500' },
              { title: 'AI Auto-Replies Sent', value: stats.totalAutoReplies, sub: 'Replies sent automatically by AI', Icon: Send, color: 'text-orange-500' },
              { title: 'Events Scheduled', value: stats.totalScheduledEvents, sub: 'Calendar events booked from emails', Icon: CalendarCheck, color: 'text-purple-500' },
              { title: 'Total AI-Processed Emails', value: stats.totalEmails, sub: 'All inbound emails handled by AI', Icon: MailIcon, color: 'text-primary' },
            ].map(({ title, value, sub, Icon, color }) => (
              <Card key={title} className="h-full">
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground leading-snug min-h-[2.5rem] line-clamp-2">
                    {title}
                  </CardTitle>
                  <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold tabular-nums leading-none">{value}</div>
                  <p className="text-xs text-muted-foreground mt-2 min-h-[2rem] line-clamp-2">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Conversational & meeting AI */}
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-green-500" />
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Chat & Meetings</h3>
          </div>
          <div data-tour="aa-chat-stats" className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 gap-4 mb-8">
            {[
              { title: 'AI Chat Messages', value: stats.totalChatMessages, sub: `${stats.totalChatConversations} conversation${stats.totalChatConversations === 1 ? '' : 's'} with InboxIQ`, Icon: MessageSquare, color: 'text-green-500' },
              { title: 'Meeting Copilot', value: stats.totalMeetings, sub: 'Live meetings transcribed & summarized', Icon: Video, color: 'text-pink-500' },
            ].map(({ title, value, sub, Icon, color }) => (
              <Card key={title} className="h-full">
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground leading-snug min-h-[2.5rem] line-clamp-2">
                    {title}
                  </CardTitle>
                  <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold tabular-nums leading-none">{value}</div>
                  <p className="text-xs text-muted-foreground mt-2 min-h-[2rem] line-clamp-2">{sub}</p>
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
                    {/* Radial ranking */}
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadialBarChart innerRadius="20%" outerRadius="100%" data={items} startAngle={90} endAngle={-270}>
                          <RadialBar background={{ fill: 'hsl(var(--muted))' }} dataKey="value" cornerRadius={6} />
                          <RTooltip
                            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                            formatter={(v: number, _n: string, p: { payload?: { name?: string } }) => [v, p?.payload?.name ?? '']}
                          />
                          <Legend iconSize={8} layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: 11, lineHeight: '16px' }} />
                        </RadialBarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Plan Usage & Limits — per-feature quota tiles */}
          <FeatureUsageGrid />




          {/* Category Breakdown */}
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
                <div className="space-y-4">
                  {categoryBreakdown.map((cat) => {
                    const total = cat.drafts + cat.autoReplies;
                    const maxTotal = Math.max(...categoryBreakdown.map(c => c.drafts + c.autoReplies));
                    const widthPercent = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                    
                    return (
                      <div key={cat.categoryName} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{cat.categoryName}</span>
                          <span className="text-sm text-muted-foreground">
                            {cat.drafts} drafts, {cat.autoReplies} auto-replies
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-blue-500 to-orange-500 rounded-full transition-all duration-500"
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily Activity Chart (Simple) */}
          {dailyActivity.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Daily Activity</CardTitle>
                <CardDescription>AI drafts and auto-replies over time</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-48 flex items-end gap-1">
                  {dailyActivity.slice(-30).map((day) => {
                    const total = day.drafts + day.autoReplies;
                    const maxTotal = Math.max(...dailyActivity.map(d => d.drafts + d.autoReplies));
                    const heightPercent = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                    
                    return (
                      <div key={day.date} className="flex-1 flex flex-col items-center group">
                        <div className="relative w-full flex flex-col items-center">
                          <div 
                            className="w-full bg-gradient-to-t from-blue-500 to-orange-400 rounded-t transition-all duration-300 hover:opacity-80"
                            style={{ height: `${Math.max(heightPercent, 2)}%`, minHeight: '4px' }}
                          />
                          <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-10">
                            {format(new Date(day.date), 'MMM dd')}: {day.drafts}D, {day.autoReplies}AR
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                  <span>{dailyActivity.length > 0 && format(new Date(dailyActivity[Math.max(0, dailyActivity.length - 30)].date), 'MMM dd')}</span>
                  <span>{dailyActivity.length > 0 && format(new Date(dailyActivity[dailyActivity.length - 1].date), 'MMM dd')}</span>
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


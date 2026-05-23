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

  const exportReport = async () => {
    setExporting(true);
    try {
      const { start, end } = getDateRange();

      // Create CSV content
      const headers = ['Date', 'Category', 'Activity Type', 'Email Subject', 'Email From'];

      const { data: logs } = await supabase
        .from('ai_activity_logs')
        .select('*')
        .eq('organization_id', organization?.id)
        .eq('user_id', user?.id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false });

      const rows = logs?.map(log => [
        format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
        log.category_name,
        log.activity_type === 'draft' ? 'AI Draft' : 'AI Auto-Reply',
        log.email_subject || '',
        log.email_from || ''
      ]) || [];

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      // Download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `ai-activity-report-${format(start, 'yyyy-MM-dd')}-to-${format(end, 'yyyy-MM-dd')}.csv`;
      link.click();
    } catch (error) {
      console.error('Export error:', error);
    } finally {
      setExporting(false);
    }
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
          title="AI Activity"
          description="Your personal AI activity — drafts, auto-replies, scheduled events, chats and meetings. Filter by date range."
          accent="green"
          icon={<BarChart3 className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
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

          <Button onClick={exportReport} disabled={exporting} variant="outline">
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Export Report
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {[
              { title: 'AI Drafts Created', value: stats.totalDrafts, sub: 'Emails drafted by AI', Icon: FileText, color: 'text-blue-500' },
              { title: 'AI Auto-Replies Sent', value: stats.totalAutoReplies, sub: 'Automatically sent replies', Icon: Send, color: 'text-orange-500' },
              { title: 'Events Scheduled', value: stats.totalScheduledEvents, sub: 'AI-scheduled appointments', Icon: CalendarCheck, color: 'text-purple-500' },
              { title: 'Total AI-Processed', value: stats.totalEmails, sub: 'All AI-handled emails', Icon: MailIcon, color: 'text-primary' },
              { title: 'AI Chats', value: stats.totalChatMessages, sub: `${stats.totalChatConversations} conversation${stats.totalChatConversations === 1 ? '' : 's'}`, Icon: MessageSquare, color: 'text-green-500' },
              { title: 'Meeting Copilot', value: stats.totalMeetings, sub: 'Meetings assisted', Icon: Video, color: 'text-pink-500' },
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

          {/* Plan Usage & Limits — per-feature quota tiles */}
          <FeatureUsageGrid />




          {/* Category Breakdown */}
          <Card className="mb-8">
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
  );
}

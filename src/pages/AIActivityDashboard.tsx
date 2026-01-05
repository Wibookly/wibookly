import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { supabase } from '@/integrations/supabase/client';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, FileText, Send, Download, CalendarIcon, TrendingUp, Mail as MailIcon } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

interface ActivityStats {
  totalDrafts: number;
  totalAutoReplies: number;
  totalEmails: number;
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
  const [stats, setStats] = useState<ActivityStats>({ totalDrafts: 0, totalAutoReplies: 0, totalEmails: 0 });
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
    if (organization?.id) {
      fetchActivityData();
    }
  }, [organization?.id, dateRange, customStartDate, customEndDate]);

  const fetchActivityData = async () => {
    if (!organization?.id) return;
    setLoading(true);

    try {
      const { start, end } = getDateRange();

      // Fetch activity logs
      const { data: logs, error } = await supabase
        .from('ai_activity_logs')
        .select('*')
        .eq('organization_id', organization.id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching activity logs:', error);
        setLoading(false);
        return;
      }

      // Calculate stats
      const drafts = logs?.filter(l => l.activity_type === 'draft') || [];
      const autoReplies = logs?.filter(l => l.activity_type === 'auto_reply') || [];

      setStats({
        totalDrafts: drafts.length,
        totalAutoReplies: autoReplies.length,
        totalEmails: logs?.length || 0
      });

      // Calculate daily activity
      const dailyMap = new Map<string, { drafts: number; autoReplies: number }>();
      logs?.forEach(log => {
        const date = format(new Date(log.created_at), 'yyyy-MM-dd');
        const current = dailyMap.get(date) || { drafts: 0, autoReplies: 0 };
        if (log.activity_type === 'draft') {
          current.drafts++;
        } else {
          current.autoReplies++;
        }
        dailyMap.set(date, current);
      });

      const dailyData: DailyActivity[] = Array.from(dailyMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));
      setDailyActivity(dailyData);

      // Calculate category breakdown
      const categoryMap = new Map<string, { drafts: number; autoReplies: number }>();
      logs?.forEach(log => {
        const current = categoryMap.get(log.category_name) || { drafts: 0, autoReplies: 0 };
        if (log.activity_type === 'draft') {
          current.drafts++;
        } else {
          current.autoReplies++;
        }
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

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 lg:p-6">
      {/* User Avatar Row */}
      <div className="max-w-6xl mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>
      
      <div className="max-w-6xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Activity Dashboard</h1>
            <p className="mt-1 text-muted-foreground">
              Track AI-generated drafts and auto-replies across your organization.
            </p>
          </div>
        
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">AI Drafts Created</CardTitle>
                <FileText className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalDrafts}</div>
                <p className="text-xs text-muted-foreground mt-1">Emails drafted by AI</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">AI Auto-Replies Sent</CardTitle>
                <Send className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalAutoReplies}</div>
                <p className="text-xs text-muted-foreground mt-1">Automatically sent replies</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total AI-Processed</CardTitle>
                <MailIcon className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalEmails}</div>
                <p className="text-xs text-muted-foreground mt-1">All AI-handled emails</p>
              </CardContent>
            </Card>
          </div>

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

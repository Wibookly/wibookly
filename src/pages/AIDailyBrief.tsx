import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  RefreshCw, 
  Sun, 
  AlertTriangle, 
  Calendar, 
  Mail, 
  Lightbulb,
  Clock,
  CheckCircle2,
  Printer,
  Settings2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';

interface DailyBrief {
  greeting: string;
  summary: string;
  priorities: Array<{
    title: string;
    description: string;
    urgency: 'high' | 'medium' | 'low';
    type: 'email' | 'meeting' | 'task';
  }>;
  schedule: Array<{
    time: string;
    title: string;
    type: string;
    description?: string;
  }>;
  emailHighlights: Array<{
    from: string;
    subject: string;
    preview?: string;
    action: string;
    urgency?: 'high' | 'medium' | 'low';
  }>;
  suggestions: string[];
}

const defaultColors = {
  high: { bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/20' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/20' },
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20' },
};

const typeIcons = {
  email: Mail,
  meeting: Calendar,
  task: CheckCircle2,
};

export default function AIDailyBrief() {
  const { activeConnection } = useActiveEmail();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  
  // Priority color settings
  const [priorityColors, setPriorityColors] = useState({
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#10b981',
  });

  const { data: brief, isLoading, refetch, error } = useQuery({
    queryKey: ['daily-brief', activeConnection?.id],
    queryFn: async (): Promise<DailyBrief> => {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-daily-brief`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          connectionId: activeConnection?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch daily brief');
      }

      return response.json();
    },
    enabled: !!activeConnection,
    staleTime: 5 * 60 * 1000,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('Daily brief refreshed');
    } catch (error) {
      toast.error('Failed to refresh daily brief');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePrint = (type: 'all' | 'priorities' | 'calendar' | 'todo') => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !brief) return;

    const today = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const appName = 'Wibookly';
    const email = activeConnection?.email || 'N/A';
    const printTitle = type === 'todo' ? 'To-Do List' : 
                       type === 'calendar' ? 'Today\'s Schedule' : 
                       type === 'priorities' ? 'Priorities' : 'Daily Brief';

    let content = '';

    const header = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #0ea5e9;">
        <div>
          <h1 style="margin: 0; font-size: 32px; font-weight: 700; color: #0f172a; font-family: 'Segoe UI', system-ui, sans-serif;">${printTitle}</h1>
          <p style="margin: 8px 0 0 0; font-size: 14px; color: #64748b;">${email}</p>
          <p style="margin: 4px 0 0 0; font-size: 14px; color: #64748b;">${today}</p>
        </div>
        <div style="text-align: right;">
          <img src="${window.location.origin}/wibookly-logo-color.png" alt="Wibookly" style="height: 50px; width: auto;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
          <div style="display: none; font-size: 24px; font-weight: 700; color: #0ea5e9; font-family: 'Segoe UI', system-ui, sans-serif;">Wibookly</div>
        </div>
      </div>
    `;

    if (type === 'all' || type === 'priorities') {
      content += `
        <div style="margin-bottom: 30px;">
          <h2 style="font-size: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Priorities</h2>
          ${brief.priorities?.length ? brief.priorities.map(p => `
            <div style="padding: 12px; margin: 10px 0; border-left: 4px solid ${
              p.urgency === 'high' ? priorityColors.high : 
              p.urgency === 'medium' ? priorityColors.medium : priorityColors.low
            }; background: #f9f9f9;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${p.title}</strong>
                <span style="padding: 2px 8px; border-radius: 4px; font-size: 12px; background: ${
                  p.urgency === 'high' ? '#fee2e2' : 
                  p.urgency === 'medium' ? '#fef3c7' : '#d1fae5'
                }; color: ${
                  p.urgency === 'high' ? priorityColors.high : 
                  p.urgency === 'medium' ? priorityColors.medium : priorityColors.low
                };">${p.urgency.toUpperCase()}</span>
              </div>
              <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">${p.description}</p>
            </div>
          `).join('') : '<p style="color: #999;">No priorities for today</p>'}
        </div>
      `;
    }

    if (type === 'all' || type === 'calendar') {
      content += `
        <div style="margin-bottom: 30px;">
          <h2 style="font-size: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Today's Schedule</h2>
          ${brief.schedule?.length ? brief.schedule.map(s => `
            <div style="display: flex; padding: 10px 0; border-bottom: 1px solid #eee;">
              <span style="width: 80px; font-family: monospace; color: #666;">${s.time}</span>
              <div style="flex: 1;">
                <strong>${s.title}</strong>
                ${s.description ? `<p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">${s.description}</p>` : ''}
              </div>
            </div>
          `).join('') : '<p style="color: #999;">No scheduled events for today</p>'}
        </div>
      `;
    }

    if (type === 'all' || type === 'todo') {
      content += `
        <div style="margin-bottom: 30px;">
          <h2>To-Do List</h2>
          ${brief.priorities?.length || brief.emailHighlights?.length ? `
            <div style="display: grid; gap: 12px;">
              ${brief.priorities?.map(p => `
                <div class="priority-item" style="display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 8px; background: ${
                  p.urgency === 'high' ? '#fef2f2' : 
                  p.urgency === 'medium' ? '#fffbeb' : '#f0fdf4'
                }; border-left: 4px solid ${
                  p.urgency === 'high' ? priorityColors.high : 
                  p.urgency === 'medium' ? priorityColors.medium : priorityColors.low
                };">
                  <span style="width: 18px; height: 18px; border: 2px solid ${
                    p.urgency === 'high' ? priorityColors.high : 
                    p.urgency === 'medium' ? priorityColors.medium : priorityColors.low
                  }; border-radius: 4px; flex-shrink: 0; margin-top: 2px;"></span>
                  <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 15px;">${p.title}</div>
                    <div style="font-size: 13px; color: #64748b; margin-top: 4px;">${p.description}</div>
                  </div>
                  <span style="padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; background: ${
                    p.urgency === 'high' ? priorityColors.high : 
                    p.urgency === 'medium' ? priorityColors.medium : priorityColors.low
                  }; color: white;">${p.urgency}</span>
                </div>
              `).join('') || ''}
              ${brief.emailHighlights?.slice(0, 10).map(e => `
                <div class="priority-item" style="display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 8px; background: #f8fafc; border-left: 4px solid #0ea5e9;">
                  <span style="width: 18px; height: 18px; border: 2px solid #0ea5e9; border-radius: 4px; flex-shrink: 0; margin-top: 2px;"></span>
                  <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 15px;">${e.action}: ${e.subject}</div>
                    <div style="font-size: 13px; color: #64748b; margin-top: 4px;">From: ${e.from}</div>
                  </div>
                </div>
              `).join('') || ''}
            </div>
          ` : '<p style="color: #94a3b8; text-align: center; padding: 40px;">No to-do items for today</p>'}
        </div>
      `;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${appName} - ${printTitle}</title>
          <style>
            * { box-sizing: border-box; }
            body { 
              font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; 
              padding: 40px 50px; 
              max-width: 900px; 
              margin: 0 auto; 
              color: #0f172a;
              line-height: 1.5;
            }
            h2 { 
              font-size: 18px; 
              font-weight: 600; 
              color: #0f172a; 
              margin: 0 0 16px 0;
              padding-bottom: 8px;
              border-bottom: 2px solid #e2e8f0;
            }
            .priority-item {
              page-break-inside: avoid;
            }
            @media print { 
              body { padding: 30px; } 
              .priority-item { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          ${header}
          ${content}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const currentHour = new Date().getHours();
  const timeOfDay = currentHour < 12 ? 'morning' : currentHour < 17 ? 'afternoon' : 'evening';

  const getUrgencyStyle = (urgency: 'high' | 'medium' | 'low') => {
    return {
      backgroundColor: urgency === 'high' ? `${priorityColors.high}15` :
                       urgency === 'medium' ? `${priorityColors.medium}15` : `${priorityColors.low}15`,
      borderColor: urgency === 'high' ? `${priorityColors.high}30` :
                   urgency === 'medium' ? `${priorityColors.medium}30` : `${priorityColors.low}30`,
      color: urgency === 'high' ? priorityColors.high :
             urgency === 'medium' ? priorityColors.medium : priorityColors.low,
    };
  };

  if (!activeConnection) {
    return (
      <div className="min-h-full p-4 lg:p-6">
        <div className="mb-4 flex justify-end">
          <UserAvatarDropdown />
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <Sun className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect an Email</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Connect your email account to see your personalized daily brief with priorities, schedule, and action items.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 lg:p-6" ref={printRef}>
      <div className="mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sun className="w-6 h-6 text-amber-500" />
            Good {timeOfDay}!
          </h1>
          <p className="text-muted-foreground">
            {new Date().toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePrint('all')}
          >
            <Printer className="w-4 h-4 mr-2" />
            Print All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', (isLoading || isRefreshing) && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Skeleton className="h-[400px] lg:col-span-2" />
            <Skeleton className="h-[400px]" />
          </div>
        </div>
      ) : error ? (
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center justify-center py-10">
            <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
            <p className="text-destructive font-medium">Failed to load daily brief</p>
            <p className="text-sm text-muted-foreground mb-4">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <Button variant="outline" onClick={handleRefresh}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : brief ? (
        <div className="space-y-6">
          {/* Summary Card */}
          <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
            <CardContent className="pt-6">
              <p className="text-lg">{brief.greeting}</p>
              <p className="text-muted-foreground mt-1">{brief.summary}</p>
            </CardContent>
          </Card>

          {/* Main Layout - Full Width */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Email Highlights - Takes 2/3 width */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="w-5 h-5 text-purple-500" />
                  Email Highlights
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => handlePrint('priorities')}>
                  <Printer className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[350px]">
                  <div className="space-y-2">
                    {brief.emailHighlights && brief.emailHighlights.length > 0 ? (
                      brief.emailHighlights.map((email, index) => {
                        const urgency = email.urgency || 'medium';
                        return (
                          <div
                            key={index}
                            className="flex items-start gap-4 p-3 rounded-lg border transition-colors hover:bg-secondary/30"
                            style={{
                              borderLeftWidth: '4px',
                              borderLeftColor: urgency === 'high' ? priorityColors.high :
                                              urgency === 'medium' ? priorityColors.medium : priorityColors.low
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge 
                                  variant="outline" 
                                  className="text-xs"
                                  style={getUrgencyStyle(urgency)}
                                >
                                  {urgency}
                                </Badge>
                                <span className="text-sm text-muted-foreground">{email.from}</span>
                              </div>
                              <p className="font-medium truncate">{email.subject}</p>
                              {email.preview && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {email.preview}
                                </p>
                              )}
                            </div>
                            <Badge variant="secondary" className="flex-shrink-0">
                              {email.action}
                            </Badge>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-muted-foreground text-center py-4">
                        No email highlights for today
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Schedule - Takes 1/3 width */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-500" />
                  Today's Schedule
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => handlePrint('calendar')}>
                  <Printer className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[350px]">
                  <div className="space-y-1">
                    {brief.schedule && brief.schedule.length > 0 ? (
                      brief.schedule.map((item, index) => (
                        <div
                          key={index}
                          className="flex gap-3 p-3 rounded-lg hover:bg-secondary/30 border-l-2 border-primary/50"
                        >
                          <div className="flex-shrink-0 w-14">
                            <span className="text-sm font-mono text-primary font-medium">
                              {item.time}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{item.title}</p>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                            <Badge variant="outline" className="text-xs mt-1">
                              {item.type}
                            </Badge>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8">
                        <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                        <p className="text-muted-foreground text-sm">
                          No scheduled events
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Available for focus work
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Priorities */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Today's Priorities
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => handlePrint('todo')}>
                <Printer className="w-4 h-4 mr-1" />
                To-Do List
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {brief.priorities && brief.priorities.length > 0 ? (
                  brief.priorities.map((priority, index) => {
                    const Icon = typeIcons[priority.type] || CheckCircle2;
                    return (
                      <div
                        key={index}
                        className="p-4 rounded-lg border"
                        style={{
                          backgroundColor: priority.urgency === 'high' ? `${priorityColors.high}10` :
                                          priority.urgency === 'medium' ? `${priorityColors.medium}10` : `${priorityColors.low}10`,
                          borderColor: priority.urgency === 'high' ? `${priorityColors.high}30` :
                                       priority.urgency === 'medium' ? `${priorityColors.medium}30` : `${priorityColors.low}30`,
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <Icon 
                            className="w-5 h-5 mt-0.5 flex-shrink-0" 
                            style={{ color: priority.urgency === 'high' ? priorityColors.high :
                                           priority.urgency === 'medium' ? priorityColors.medium : priorityColors.low }}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{priority.title}</span>
                              <Badge 
                                variant="outline" 
                                className="text-xs"
                                style={getUrgencyStyle(priority.urgency)}
                              >
                                {priority.urgency}
                              </Badge>
                            </div>
                            <p className="text-sm mt-1 text-muted-foreground">{priority.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground text-center py-4 col-span-full">
                    No priorities identified for today
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Suggestions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                Productivity Tips
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {brief.suggestions && brief.suggestions.length > 0 ? (
                  brief.suggestions.map((suggestion, index) => {
                    const text = typeof suggestion === 'string' 
                      ? suggestion 
                      : (suggestion as { suggestion?: string })?.suggestion || JSON.stringify(suggestion);
                    return (
                      <div
                        key={index}
                        className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm"
                      >
                        {text}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground col-span-full text-center py-4">
                    No suggestions available
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Settings Section */}
          <Card>
            <CardHeader 
              className="pb-3 cursor-pointer"
              onClick={() => setShowSettings(!showSettings)}
            >
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-muted-foreground" />
                  Priority Color Settings
                </span>
                {showSettings ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </CardTitle>
            </CardHeader>
            {showSettings && (
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-5 h-5 rounded-full border-2" 
                        style={{ backgroundColor: priorityColors.high, borderColor: priorityColors.high }}
                      />
                      <span className="text-sm font-medium">High Priority</span>
                    </div>
                    <label className="relative cursor-pointer">
                      <input
                        type="color"
                        value={priorityColors.high}
                        onChange={(e) => setPriorityColors(prev => ({ ...prev, high: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div 
                        className="w-10 h-8 rounded-md border-2 border-border shadow-sm transition-all hover:scale-105"
                        style={{ backgroundColor: priorityColors.high }}
                      />
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-5 h-5 rounded-full border-2" 
                        style={{ backgroundColor: priorityColors.medium, borderColor: priorityColors.medium }}
                      />
                      <span className="text-sm font-medium">Medium Priority</span>
                    </div>
                    <label className="relative cursor-pointer">
                      <input
                        type="color"
                        value={priorityColors.medium}
                        onChange={(e) => setPriorityColors(prev => ({ ...prev, medium: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div 
                        className="w-10 h-8 rounded-md border-2 border-border shadow-sm transition-all hover:scale-105"
                        style={{ backgroundColor: priorityColors.medium }}
                      />
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-5 h-5 rounded-full border-2" 
                        style={{ backgroundColor: priorityColors.low, borderColor: priorityColors.low }}
                      />
                      <span className="text-sm font-medium">Low Priority</span>
                    </div>
                    <label className="relative cursor-pointer">
                      <input
                        type="color"
                        value={priorityColors.low}
                        onChange={(e) => setPriorityColors(prev => ({ ...prev, low: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div 
                        className="w-10 h-8 rounded-md border-2 border-border shadow-sm transition-all hover:scale-105"
                        style={{ backgroundColor: priorityColors.low }}
                      />
                    </label>
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setPriorityColors({ high: '#ef4444', medium: '#f59e0b', low: '#10b981' })}
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

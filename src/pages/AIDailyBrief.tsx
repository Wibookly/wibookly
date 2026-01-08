import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  RefreshCw, 
  Sun, 
  AlertTriangle, 
  Calendar, 
  Mail, 
  Lightbulb,
  Clock,
  CheckCircle2,
  ArrowRight
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
  }>;
  emailHighlights: Array<{
    from: string;
    subject: string;
    action: string;
  }>;
  suggestions: string[];
}

const urgencyColors = {
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  low: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
};

const typeIcons = {
  email: Mail,
  meeting: Calendar,
  task: CheckCircle2,
};

export default function AIDailyBrief() {
  const { activeConnection } = useActiveEmail();
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    staleTime: 5 * 60 * 1000, // 5 minutes
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

  const currentHour = new Date().getHours();
  const timeOfDay = currentHour < 12 ? 'morning' : currentHour < 17 ? 'afternoon' : 'evening';

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
    <div className="min-h-full p-4 lg:p-6">
      <div className="mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>

      <div className="max-w-5xl mx-auto">
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

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
            <Skeleton className="h-48 w-full" />
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Priorities */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    Today's Priorities
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-3">
                      {brief.priorities && brief.priorities.length > 0 ? (
                        brief.priorities.map((priority, index) => {
                          const Icon = typeIcons[priority.type] || CheckCircle2;
                          return (
                            <div
                              key={index}
                              className={cn(
                                'p-3 rounded-lg border',
                                urgencyColors[priority.urgency]
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{priority.title}</span>
                                    <Badge variant="outline" className="text-xs">
                                      {priority.urgency}
                                    </Badge>
                                  </div>
                                  <p className="text-sm mt-1 opacity-80">{priority.description}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-muted-foreground text-center py-4">
                          No priorities identified for today
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Schedule */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="w-5 h-5 text-blue-500" />
                    Today's Schedule
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-2">
                      {brief.schedule && brief.schedule.length > 0 ? (
                        brief.schedule.map((item, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary/50"
                          >
                            <span className="text-sm font-mono text-muted-foreground w-16">
                              {item.time}
                            </span>
                            <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                            <span className="text-sm">{item.title}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground text-center py-4">
                          No scheduled items for today
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Email Highlights */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="w-5 h-5 text-purple-500" />
                  Email Highlights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {brief.emailHighlights && brief.emailHighlights.length > 0 ? (
                    brief.emailHighlights.map((email, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{email.subject}</p>
                          <p className="text-sm text-muted-foreground">From: {email.from}</p>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-primary">
                          <span>{email.action}</span>
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No email highlights for today
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
                    brief.suggestions.map((suggestion, index) => (
                      <div
                        key={index}
                        className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm"
                      >
                        {suggestion}
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground col-span-full text-center py-4">
                      No suggestions available
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}

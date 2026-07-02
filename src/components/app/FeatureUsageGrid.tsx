import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FEATURE_LIST } from '@/constants/featureKeys';
import { Loader2, Infinity as InfinityIcon, Lock, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UsageRow {
  feature_key: string;
  enabled: boolean;
  limit_term: 'daily' | 'weekly' | string;
  limit_count: number;
  used_count: number;
  remaining_count: number;
  model: string | null;
  user_daily_cap: number;
  user_daily_spent: number;
  user_monthly_cap: number;
  user_monthly_spent: number;
  is_unlimited: boolean;
}

export function FeatureUsageGrid() {
  const { user, organization } = useAuth();
  const featureKeys = FEATURE_LIST.map(f => f.key);

  const { data, isLoading } = useQuery({
    queryKey: ['feature-usage-summary', user?.id, organization?.id],
    enabled: !!user?.id && !!organization?.id,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_feature_usage_summary', {
        _user_id: user!.id,
        _organization_id: organization!.id,
        _feature_keys: featureKeys as unknown as string[],
      });
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const byKey = new Map<string, UsageRow>((data ?? []).map(r => [r.feature_key, r]));
  const firstRow = data?.[0];
  const dailyCap = firstRow?.user_daily_cap ?? 0;
  const dailySpent = firstRow?.user_daily_spent ?? 0;
  const monthlyCap = firstRow?.user_monthly_cap ?? 0;
  const monthlySpent = firstRow?.user_monthly_spent ?? 0;

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5" />
          Plan Usage & Limits
        </CardTitle>
        <CardDescription>
          What your plan allows, what you've used, and what's left. Daily counters reset at midnight UTC; weekly counters reset on Monday. Refreshed every 30s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(dailyCap > 0 || monthlyCap > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {dailyCap > 0 && (
              <BudgetBar label="Today's AI budget" spent={dailySpent} cap={dailyCap} />
            )}
            {monthlyCap > 0 && (
              <BudgetBar label="This month's AI budget" spent={monthlySpent} cap={monthlyCap} />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {FEATURE_LIST.map(feat => {
            const row = byKey.get(feat.key);
            return <FeatureTile key={feat.key} label={feat.label} description={feat.description} row={row} />;
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetBar({ label, spent, cap }: { label: string; spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const remaining = Math.max(cap - spent, 0);
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          ${spent.toFixed(2)} / ${cap.toFixed(2)}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
      <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">
        ${remaining.toFixed(2)} remaining
      </div>
    </div>
  );
}

function FeatureTile({
  label,
  description,
  row,
}: {
  label: string;
  description: string;
  row?: UsageRow;
}) {
  if (!row) {
    return (
      <div className="rounded-lg border p-3 opacity-60">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-1">No data</div>
      </div>
    );
  }

  if (!row.enabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="rounded-lg border border-dashed p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{label}</span>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Lock className="w-3 h-3" /> Not in plan
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">{description}</div>
            </div>
          </TooltipTrigger>
          <TooltipContent>This feature isn't enabled on your plan. Ask an admin to add it.</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (row.is_unlimited) {
    return (
      <div className="rounded-lg border p-3 bg-card">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <InfinityIcon className="w-3 h-3" /> Unlimited
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-1.5">
          {row.used_count} used {row.limit_term === 'weekly' ? 'this week' : 'today'}
        </div>
        {row.model && (
          <div className="text-[10px] text-muted-foreground/70 mt-1">Model: {row.model}</div>
        )}
      </div>
    );
  }

  const pct = row.limit_count > 0 ? Math.min(100, (row.used_count / row.limit_count) * 100) : 0;
  const exhausted = row.remaining_count <= 0;
  const low = !exhausted && row.remaining_count <= Math.max(1, Math.floor(row.limit_count * 0.2));
  const termLabel = row.limit_term === 'weekly' ? 'this week' : 'today';

  return (
    <div className="rounded-lg border p-3 bg-card hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{label}</span>
        <Badge
          variant={exhausted ? 'destructive' : low ? 'secondary' : 'outline'}
          className="gap-1 text-[10px] shrink-0"
        >
          {row.remaining_count} left
        </Badge>
      </div>
      <div className="mt-2">
        <Progress
          value={pct}
          className={cn(
            'h-2',
            exhausted && '[&>div]:bg-destructive',
            low && !exhausted && '[&>div]:bg-amber-500',
          )}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5 tabular-nums">
        <span>{row.used_count} used {termLabel}</span>
        <span>Limit: {row.limit_count}</span>
      </div>
      {row.model && (
        <div className="text-[10px] text-muted-foreground/70 mt-1">Model: {row.model}</div>
      )}
    </div>
  );
}

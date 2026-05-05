import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFeatureQuota } from '@/hooks/useFeatureQuota';
import { AlertCircle, Gauge, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const REASON_LABEL: Record<string, string> = {
  feature_disabled: 'Disabled by your plan',
  daily_count_exceeded: 'Daily limit reached',
  weekly_count_exceeded: 'Weekly limit reached',
  per_request_cap_exceeded: 'Per-request cost cap exceeded',
  user_daily_cap_exceeded: 'Daily cost cap reached',
  user_monthly_cap_exceeded: 'Monthly cost cap reached',
  org_daily_cap_exceeded: 'Organization daily budget reached',
  org_paused: 'Organization paused by admin',
};

interface Props {
  featureKey: string;
  label?: string;
  className?: string;
  /** When true, hides itself if no limit is configured (remaining is huge sentinel). */
  hideWhenUnlimited?: boolean;
}

/**
 * Compact pill that shows remaining count for a feature, with tooltip
 * showing daily/monthly $ remaining and the gating reason if blocked.
 * Powered by enforce_llm_limits($0 est cost) so it's safe to call freely.
 */
export function QuotaBadge({ featureKey, label, className, hideWhenUnlimited = true }: Props) {
  const { data, isLoading } = useFeatureQuota(featureKey);

  if (isLoading) {
    return (
      <Badge variant="outline" className={cn('gap-1 text-[10px]', className)}>
        <Loader2 className="w-3 h-3 animate-spin" /> Checking…
      </Badge>
    );
  }
  if (!data) return null;

  // Super admin / unlimited sentinel — hide quietly.
  if (hideWhenUnlimited && data.daily_count_remaining >= 999999) return null;

  const blocked = !data.allowed;
  const remaining = data.daily_count_remaining;

  const tooltipBody = (
    <div className="space-y-1 text-xs">
      <div><span className="text-muted-foreground">Today:</span> {remaining} left</div>
      {data.user_daily_remaining > 0 && (
        <div><span className="text-muted-foreground">Daily $:</span> ${data.user_daily_remaining.toFixed(2)} left</div>
      )}
      {data.user_monthly_remaining > 0 && (
        <div><span className="text-muted-foreground">Monthly $:</span> ${data.user_monthly_remaining.toFixed(2)} left</div>
      )}
      {data.model && (
        <div><span className="text-muted-foreground">Model:</span> {data.model}</div>
      )}
      {blocked && data.reason && (
        <div className="text-destructive font-medium pt-1">
          {REASON_LABEL[data.reason] ?? data.reason}
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={blocked ? 'destructive' : remaining <= 3 ? 'secondary' : 'outline'}
            className={cn('gap-1 text-[10px] font-medium', className)}
          >
            {blocked ? <AlertCircle className="w-3 h-3" /> : <Gauge className="w-3 h-3" />}
            {label ?? 'Quota'}: {blocked ? 0 : remaining} left
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipBody}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

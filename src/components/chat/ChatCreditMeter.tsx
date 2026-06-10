import { useMemo } from 'react';
import { ArrowRightCircle, Loader2, Info, Gauge, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFeatureQuota } from '@/hooks/useFeatureQuota';
import { cn } from '@/lib/utils';

interface Props {
  onSummarizeAndContinue: () => void;
  summarizing: boolean;
  messageCount: number;
}

function confirmSummarize(): boolean {
  if (typeof window === 'undefined') return true;
  return window.confirm(
    'Start a NEW chat that begins with a summary of this conversation?\n\nThis will leave the current chat as-is and open a fresh thread.',
  );
}

function nextDailyResetLabel(): string {
  // Quotas reset at local midnight.
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const ms = next.getTime() - now.getTime();
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours <= 0) return `in ${Math.max(1, mins)} min`;
  return `in ${hours}h ${mins}m`;
}

function nextMonthlyResetLabel(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Compact "credit/usage limit" pill shown above the chat composer.
 * Replaces the older token-percent capacity meter with a user-friendly
 * remaining-credits display + popover that explains daily/monthly
 * limits and when they reset.
 */
export function ChatCreditMeter({ onSummarizeAndContinue, summarizing, messageCount }: Props) {
  const { data, isLoading } = useFeatureQuota('ai_chat');

  const { tone, remainingLabel, blocked } = useMemo(() => {
    if (!data) return { tone: 'ok' as const, remainingLabel: '—', blocked: false };
    const r = data.daily_count_remaining;
    if (!data.allowed) return { tone: 'blocked' as const, remainingLabel: '0', blocked: true };
    if (r >= 999_999) return { tone: 'unlimited' as const, remainingLabel: 'Unlimited', blocked: false };
    if (r <= 3) return { tone: 'low' as const, remainingLabel: String(r), blocked: false };
    if (r <= 10) return { tone: 'warn' as const, remainingLabel: String(r), blocked: false };
    return { tone: 'ok' as const, remainingLabel: String(r), blocked: false };
  }, [data]);

  const pillColor =
    tone === 'blocked' ? 'border-destructive/40 bg-destructive/5 text-destructive'
    : tone === 'low' ? 'border-orange-500/40 bg-orange-500/5 text-orange-600 dark:text-orange-400'
    : tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400'
    : 'border-border bg-muted/40 text-muted-foreground';

  const dailyReset = nextDailyResetLabel();
  const monthlyReset = nextMonthlyResetLabel();

  return (
    <div className="flex items-center gap-2 text-xs">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => { if (confirmSummarize()) onSummarizeAndContinue(); }}
        disabled={summarizing || messageCount < 2}
        className="h-7 px-2 gap-1 text-xs order-first"
        title="Summarize this chat and continue in a fresh thread (asks for confirmation)"
      >
        {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightCircle className="h-3 w-3" />}
        New chat with summary
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors hover:bg-accent/40',
              pillColor,
            )}
            aria-label="View your AI Chat usage limits"
          >
            {blocked ? <AlertCircle className="h-3 w-3" /> : <Gauge className="h-3 w-3" />}
            <span className="font-medium">
              {isLoading ? 'Checking…' : `${remainingLabel} credits left today`}
            </span>
            <Info className="h-3 w-3 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 text-sm">
          <div className="space-y-2.5">
            <div>
              <div className="font-semibold">AI Chat usage</div>
              <div className="text-xs text-muted-foreground">
                Your limits are set by your plan. Each chat message uses one daily credit.
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-2 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Daily messages left</span>
                <span className="font-medium tabular-nums">
                  {data?.daily_count_remaining != null && data.daily_count_remaining < 999_999
                    ? data.daily_count_remaining
                    : 'Unlimited'}
                </span>
              </div>
              {data && data.user_daily_remaining > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Daily budget left</span>
                  <span className="font-medium tabular-nums">${data.user_daily_remaining.toFixed(2)}</span>
                </div>
              )}
              {data && data.user_monthly_remaining > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Monthly budget left</span>
                  <span className="font-medium tabular-nums">${data.user_monthly_remaining.toFixed(2)}</span>
                </div>
              )}
              {data?.model && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-medium">{data.model}</span>
                </div>
              )}
            </div>

            <div className="rounded-md border bg-muted/30 p-2 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Daily limit resets</span>
                <span className="font-medium">{dailyReset}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Monthly limit resets</span>
                <span className="font-medium">{monthlyReset}</span>
              </div>
            </div>

            {blocked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                You've reached your current limit. It will reset {dailyReset.startsWith('in') ? dailyReset : 'soon'}.
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex-1" />

      <span className="hidden sm:inline text-muted-foreground tabular-nums">
        {messageCount} msg in this chat
      </span>
    </div>
  );
}

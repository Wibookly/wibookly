import { useMemo } from 'react';
import { ArrowRightCircle, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Realistic context window comparison (Nov 2025 generation models)
// InboxIQ uses the long-context models behind the scenes; cap at 200K
// to match Claude Sonnet 4.5 / GPT-5 effective context.
const TOKEN_LIMIT = 200_000;
const WARN_THRESHOLD = 0.7;   // yellow at 70%
const BANNER_THRESHOLD = 0.8; // orange + banner at 80%
const CRITICAL_THRESHOLD = 0.95;

// Rough char→token approximation used by OpenAI/Anthropic tokenizers.
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

type MsgLike = { role: string; content: string };

interface Props {
  messages: MsgLike[];
  streamingText?: string;
  onSummarizeAndContinue: () => void;
  summarizing: boolean;
}

export function ChatCapacityMeter({ messages, streamingText, onSummarizeAndContinue, summarizing }: Props) {
  const { tokens, percent, messageCount } = useMemo(() => {
    let t = 0;
    for (const m of messages) t += estimateTokens(m.content || '');
    if (streamingText) t += estimateTokens(streamingText);
    return {
      tokens: t,
      percent: Math.min(1, t / TOKEN_LIMIT),
      messageCount: messages.filter((m) => m.role !== 'system').length,
    };
  }, [messages, streamingText]);

  const pct = Math.round(percent * 100);

  const tone =
    percent >= CRITICAL_THRESHOLD ? 'critical'
    : percent >= BANNER_THRESHOLD ? 'high'
    : percent >= WARN_THRESHOLD ? 'warn'
    : 'ok';

  const barColor =
    tone === 'critical' ? 'bg-destructive'
    : tone === 'high' ? 'bg-orange-500'
    : tone === 'warn' ? 'bg-amber-500'
    : 'bg-primary';

  const labelColor =
    tone === 'critical' ? 'text-destructive'
    : tone === 'high' ? 'text-orange-600 dark:text-orange-400'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : 'text-muted-foreground';

  const showBanner = tone === 'high' || tone === 'critical';

  return (
    <div className="space-y-2">
      {/* Auto banner near limit */}
      {showBanner && (
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm animate-in fade-in slide-in-from-bottom-2',
            tone === 'critical'
              ? 'border-destructive/40 bg-destructive/5 text-destructive-foreground'
              : 'border-orange-500/40 bg-orange-500/5'
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn('font-medium', tone === 'critical' ? 'text-destructive' : 'text-orange-600 dark:text-orange-400')}>
              {tone === 'critical' ? 'Chat almost full' : 'Approaching chat limit'}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              Start a fresh chat with a handoff summary so nothing is lost.
            </span>
          </div>
          <Button
            size="sm"
            variant={tone === 'critical' ? 'destructive' : 'default'}
            onClick={onSummarizeAndContinue}
            disabled={summarizing}
            className="shrink-0 gap-1.5"
          >
            {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightCircle className="h-3.5 w-3.5" />}
            Summarize &amp; continue
          </Button>
        </div>
      )}

      {/* Always-available meter row */}
      <TooltipProvider delayDuration={150}>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className={cn('tabular-nums font-medium shrink-0', labelColor)}>
              {pct}%
            </span>
            <div className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('absolute inset-y-0 left-0 transition-all duration-500 rounded-full', barColor)}
                style={{ width: `${Math.max(1, pct)}%` }}
              />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                <div className="space-y-1.5">
                  <div className="font-semibold">Chat capacity</div>
                  <div className="text-muted-foreground">
                    Each chat has a context window. Once it fills up, the assistant starts losing the earliest parts of the conversation.
                  </div>
                  <div className="pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground">InboxIQ</span><span className="font-medium tabular-nums">~200K tokens</span>
                    <span className="text-muted-foreground">Claude Sonnet 4.5</span><span className="tabular-nums">200K tokens</span>
                    <span className="text-muted-foreground">GPT-5</span><span className="tabular-nums">~256K tokens</span>
                    <span className="text-muted-foreground">ChatGPT (Plus)</span><span className="tabular-nums">~32K tokens</span>
                  </div>
                  <div className="pt-1 text-muted-foreground">
                    {tokens.toLocaleString()} / {TOKEN_LIMIT.toLocaleString()} tokens used.
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          <span className="text-muted-foreground tabular-nums shrink-0">
            {messageCount} msg · {tokens.toLocaleString()} tok
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSummarizeAndContinue}
            disabled={summarizing || messageCount < 2}
            className="h-7 px-2 gap-1 text-xs shrink-0"
            title="Generate a summary of this chat and continue in a fresh thread"
          >
            {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightCircle className="h-3 w-3" />}
            New chat with summary
          </Button>
        </div>
      </TooltipProvider>
    </div>
  );
}

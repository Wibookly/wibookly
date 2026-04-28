import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { OPEN_HELP_PANEL_EVENT, type OpenHelpPanelDetail } from './events';

interface HelpDotProps {
  /** Article id from src/config/help-content.ts to deep-link to. */
  articleId: string;
  /** Tooltip label shown on hover. Defaults to "Open help for this section". */
  label?: string;
  /** Optional extra classes. */
  className?: string;
  /** Visual size. */
  size?: 'sm' | 'md';
}

/**
 * Small inline "?" badge placed next to section titles. Clicking it opens
 * the global Help panel directly to a specific article so users always have
 * contextual guidance one click away.
 */
export function HelpDot({
  articleId,
  label = 'Open help for this section',
  className,
  size = 'md',
}: HelpDotProps) {
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const detail: OpenHelpPanelDetail = { articleId };
    window.dispatchEvent(new CustomEvent(OPEN_HELP_PANEL_EVENT, { detail }));
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={open}
            aria-label={label}
            className={cn(
              'inline-flex items-center justify-center rounded-full text-primary',
              'bg-primary/10 hover:bg-primary/20 hover:text-primary',
              'transition-colors ring-1 ring-primary/20 hover:ring-primary/40',
              'cursor-help align-middle',
              dim,
              className,
            )}
          >
            <HelpCircle className={cn(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

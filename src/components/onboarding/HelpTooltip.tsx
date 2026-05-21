import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Props = { title?: string; content: string };

export function HelpTooltip({ title, content }: Props) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={title ?? 'Help'}
            className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {title && <p className="font-semibold mb-1">{title}</p>}
          <p className="text-xs leading-snug">{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

import { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Props = {
  enabled: boolean;
  requirements: string[];
  children: ReactNode;
};

export function DependencyWarning({ enabled, requirements, children }: Props) {
  if (enabled) return <>{children}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative inline-flex items-center gap-1 opacity-60 pointer-events-none">
            <div className="pointer-events-auto">{children}</div>
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-semibold text-xs mb-1">Required first:</p>
          <ul className="text-xs leading-snug list-disc pl-4 space-y-0.5">
            {requirements.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

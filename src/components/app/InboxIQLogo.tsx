import { cn } from '@/lib/utils';

interface InboxIQLogoProps {
  className?: string;
}

/**
 * InboxIQ wordmark — "Inbox" in brand blue, "IQ" in deeper navy.
 */
export function InboxIQLogo({ className }: InboxIQLogoProps) {
  return (
    <span className={cn('font-semibold tracking-tight', className)}>
      <span className="text-[hsl(210_90%_55%)]">Inbox</span>
      <span className="text-[hsl(220_60%_25%)] dark:text-[hsl(210_40%_85%)]">IQ</span>
    </span>
  );
}

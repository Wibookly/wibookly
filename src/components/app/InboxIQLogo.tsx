import { cn } from '@/lib/utils';

interface InboxIQLogoProps {
  className?: string;
}

/**
 * InboxIQ wordmark — "Inbox" in foreground, "IQ" with a navy→sky gradient.
 */
export function InboxIQLogo({ className }: InboxIQLogoProps) {
  return (
    <span className={cn('font-semibold tracking-tight', className)}>
      <span className="text-foreground">Inbox</span>
      <span className="bg-gradient-to-r from-ef-navy to-ef-sky bg-clip-text text-transparent">IQ</span>
    </span>
  );
}

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
      <span className="text-[hsl(215_55%_22%)] dark:text-[hsl(210_40%_85%)]">Inbox</span>
      <span className="text-[hsl(195_80%_70%)]">IQ</span>
    </span>
  );
}

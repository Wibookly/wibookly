import { cn } from '@/lib/utils';

interface InboxIQLogoProps {
  className?: string;
}

/**
 * InboxIQ wordmark — two-tone: "Inbox" in EF navy (#0B2A6B),
 * "IQ" in EF blue (#2B6EE3). Inter 700, tight tracking.
 */
export function InboxIQLogo({ className }: InboxIQLogoProps) {
  return (
    <span
      className={cn('font-sans font-bold', className)}
      style={{ letterSpacing: '-0.02em' }}
    >
      <span style={{ color: '#0B2A6B' }}>Inbox</span>
      <span style={{ color: '#2B6EE3' }}>IQ</span>
    </span>
  );
}

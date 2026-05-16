import { cn } from '@/lib/utils';

interface InboxIQLogoProps {
  className?: string;
}

/**
 * InboxIQ wordmark — two-tone.
 * Light: "Inbox" in EF navy (#0B2A6B), "IQ" in EF blue (#2B6EE3).
 * Dark: "Inbox" stays white/foreground for legibility, "IQ" in EF sky.
 */
export function InboxIQLogo({ className }: InboxIQLogoProps) {
  return (
    <span
      className={cn('font-sans font-bold inline-flex', className)}
      style={{ letterSpacing: '-0.02em' }}
    >
      <span className="text-[#0B2A6B] dark:text-white">Inbox</span>
      <span className="text-[#2B6EE3] dark:text-[#6FB2F2]">IQ</span>
    </span>
  );
}

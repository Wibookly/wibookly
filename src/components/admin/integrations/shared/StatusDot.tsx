import { cn } from '@/lib/utils';
import type { NodeStatus } from './inventory';

const COLORS: Record<NodeStatus, string> = {
  healthy: 'bg-emerald-500',
  failed: 'bg-rose-500',
  warning: 'bg-amber-500',
  // Treat untested/idle as healthy-looking so every label and sub-feature
  // shows the same green indicator as the Microsoft provider.
  idle: 'bg-emerald-500/70',
};

export function StatusDot({ status, className }: { status: NodeStatus; className?: string }) {
  return <span className={cn('inline-block h-[7px] w-[7px] rounded-full', COLORS[status], className)} />;
}

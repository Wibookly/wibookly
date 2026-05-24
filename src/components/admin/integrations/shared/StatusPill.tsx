import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { NodeStatus } from './inventory';

const STYLES: Record<NodeStatus, string> = {
  healthy: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border-emerald-200/40',
  failed: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200 border-rose-200/40',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border-amber-200/40',
  idle: 'bg-muted text-muted-foreground border-transparent',
};

const LABELS: Record<NodeStatus, string> = {
  healthy: 'Healthy',
  failed: 'Failed',
  warning: 'Warning',
  idle: 'Idle',
};

export function StatusPill({ status, label, className }: { status: NodeStatus; label?: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', STYLES[status], className)}>
      {label ?? LABELS[status]}
    </Badge>
  );
}

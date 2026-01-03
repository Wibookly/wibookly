import { cn } from '@/lib/utils';
import { LucideIcon, Check, X, Clock } from 'lucide-react';

interface StatusCardProps {
  title: string;
  value: string;
  status: 'success' | 'error' | 'pending' | 'neutral';
  icon?: LucideIcon;
  description?: string;
}

const statusConfig = {
  success: { icon: Check, className: 'text-success' },
  error: { icon: X, className: 'text-destructive' },
  pending: { icon: Clock, className: 'text-warning' },
  neutral: { icon: null, className: 'text-muted-foreground' }
};

export function StatusCard({ title, value, status, icon: Icon, description }: StatusCardProps) {
  const statusInfo = statusConfig[status];
  const StatusIcon = statusInfo.icon;

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className="mt-2 flex items-center gap-2">
            {StatusIcon && <StatusIcon className={cn('w-4 h-4', statusInfo.className)} />}
            <p className="text-lg font-semibold">{value}</p>
          </div>
          {description && (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {Icon && (
          <div className="p-2 bg-secondary rounded-md">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

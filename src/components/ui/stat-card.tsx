import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  change?: { value: string; positive?: boolean };
}

export function StatCard({ label, value, change }: StatCardProps) {
  return (
    <div
      className="rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-subtitle" style={{ color: 'var(--text-muted)' }}>{label}</span>
        {change && (
          <span
            className="inline-flex items-center gap-1 text-caption font-semibold"
            style={{ color: change.positive ? 'var(--success)' : 'var(--danger)' }}
          >
            {change.positive ? (
              <TrendingUp className="w-3.5 h-3.5" strokeWidth={2.5} />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" strokeWidth={2.5} />
            )}
            {change.value}
          </span>
        )}
      </div>
      <div className="text-h3" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

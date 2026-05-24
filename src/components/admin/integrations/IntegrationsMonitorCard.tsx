import { Switch } from '@/components/ui/switch';
import { useIntegrationHealth } from './hooks/useIntegrationHealth';
import { ALL_PROVIDERS, ALL_SUBS, ALL_FEATURES } from './shared/inventory';
import { useMemo } from 'react';

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export function IntegrationsMonitorCard() {
  const { rows } = useIntegrationHealth();

  const { unhealthy, lastRun } = useMemo(() => {
    const keys = [
      ...ALL_PROVIDERS.map((p) => p.id),
      ...ALL_SUBS.map((s) => s.id),
      ...ALL_FEATURES.map((f) => f.id),
    ];
    let bad = 0;
    let latest: string | undefined;
    for (const k of keys) {
      const r = rows[k];
      if (!r) continue;
      if (r.status === 'failed' || r.status === 'warning') bad++;
      if (!latest || (r.last_checked_at && r.last_checked_at > latest)) latest = r.last_checked_at;
    }
    return { unhealthy: bad, lastRun: latest };
  }, [rows]);

  return (
    <div className="rounded-lg border bg-card p-3 mb-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-wide text-foreground/80">Always-on monitor</div>
        <Switch checked disabled aria-label="Monitor toggle" />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
        Re-tests every integration every 5 min and auto-retries failures once before alerting.
      </p>
      <div className="flex items-center justify-between mt-2.5 text-[11px]">
        <span className="text-muted-foreground">Last run: {timeAgo(lastRun)}</span>
        {unhealthy > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-900 dark:text-rose-200 px-2 py-0.5 font-medium">
            {unhealthy} unhealthy
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 px-2 py-0.5 font-medium">
            All healthy
          </span>
        )}
      </div>
    </div>
  );
}

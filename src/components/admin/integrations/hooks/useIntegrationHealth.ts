import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { NodeStatus } from '../shared/inventory';

export type HealthRow = {
  integration_key: string;
  status: NodeStatus;
  latency_ms: number | null;
  message: string | null;
  last_checked_at: string;
  updated_at: string;
};

export function useIntegrationHealth() {
  const [rows, setRows] = useState<Record<string, HealthRow>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data, error } = await supabase
        .from('integration_health')
        .select('integration_key,status,latency_ms,message,last_checked_at,updated_at');
      if (!active) return;
      if (!error && data) {
        const next: Record<string, HealthRow> = {};
        for (const r of data as any[]) next[r.integration_key] = r as HealthRow;
        setRows(next);
      }
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel('integration_health_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'integration_health' },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as HealthRow | undefined;
          if (!row?.integration_key) return;
          setRows((prev) => ({ ...prev, [row.integration_key]: row }));
        },
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  return { rows, loading };
}

export function statusOf(rows: Record<string, HealthRow>, key: string): NodeStatus {
  return rows[key]?.status ?? 'idle';
}

// Worst-of aggregation: failed > warning > healthy > idle
const RANK: Record<NodeStatus, number> = { failed: 3, warning: 2, healthy: 1, idle: 0 };
export function aggregateStatus(
  rows: Record<string, HealthRow>,
  keys: string[],
): NodeStatus {
  let best: NodeStatus = 'idle';
  for (const k of keys) {
    const s = rows[k]?.status ?? 'idle';
    if (RANK[s] > RANK[best]) best = s;
  }
  return best;
}

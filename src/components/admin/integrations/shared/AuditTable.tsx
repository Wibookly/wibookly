import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { StatusPill } from './StatusPill';
import type { NodeStatus, SubService } from './inventory';

type Row = { when: string; status: NodeStatus; label: string; caller?: string; latency?: string };

function fmt(t: string) {
  try { return new Date(t).toLocaleString(); } catch { return t; }
}

export function AuditTable({ source, title }: { source: NonNullable<SubService['auditSource']>; title?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [emptyNote, setEmptyNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        if (source.kind === 'none') {
          setEmptyNote(source.note ?? 'No log source configured.');
          setRows([]);
          return;
        }
        const client = supabase as any;
        if (source.kind === 'm365_api_health') {
          const base = client.from('m365_api_health').select('*').order('checked_at', { ascending: false }).limit(20);
          const q = source.endpoint ? base.ilike('endpoint', `%${source.endpoint}%`) : base;
          const { data } = await q;
          setRows((data ?? []).map((r: any) => ({
            when: r.checked_at ?? r.created_at,
            status: (r.status_code && r.status_code >= 200 && r.status_code < 300 ? 'healthy' : 'failed') as NodeStatus,
            label: r.endpoint ?? '—',
            caller: r.api ?? '',
            latency: r.latency_ms != null ? `${r.latency_ms}ms` : undefined,
          })));
        } else if (source.kind === 'llm_call_logs') {
          const base = client.from('llm_call_logs').select('*').order('created_at', { ascending: false }).limit(20);
          const q = source.provider ? base.eq('provider', source.provider) : base;
          const { data } = await q;
          setRows((data ?? []).map((r: any) => ({
            when: r.created_at,
            status: (r.error ? 'failed' : 'healthy') as NodeStatus,
            label: `${r.model ?? ''}`,
            caller: r.caller ?? r.purpose ?? '',
            latency: r.latency_ms != null ? `${r.latency_ms}ms` : undefined,
          })));
        } else if (source.kind === 'connect_attempts') {
          const { data } = await client.from('connect_attempts').select('*').order('created_at', { ascending: false }).limit(20);
          setRows((data ?? []).map((r: any) => ({
            when: r.created_at,
            status: (r.success ? 'healthy' : 'failed') as NodeStatus,
            label: r.step ?? r.provider ?? '—',
            caller: r.error ?? '',
          })));
        } else if (source.kind === 'email_send_log') {
          const { data } = await client.from('email_send_log').select('*').order('created_at', { ascending: false }).limit(20);
          setRows((data ?? []).map((r: any) => ({
            when: r.created_at,
            status: (r.status === 'sent' ? 'healthy' : r.status === 'failed' ? 'failed' : 'warning') as NodeStatus,
            label: r.subject ?? r.template ?? '—',
            caller: r.to_email ?? '',
          })));
        } else if (source.kind === 'ai_activity_logs') {
          const base = client.from('ai_activity_logs').select('*').order('created_at', { ascending: false }).limit(20);
          const q = source.feature ? base.eq('feature', source.feature) : base;
          const { data } = await q;
          setRows((data ?? []).map((r: any) => ({
            when: r.created_at,
            status: (r.success === false ? 'failed' : 'healthy') as NodeStatus,
            label: r.event ?? r.feature ?? '—',
            caller: r.purpose ?? '',
          })));
        }
      } catch (e: any) {
        setEmptyNote(e?.message ?? 'Could not load audit rows.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [JSON.stringify(source)]);

  return (
    <div className="rounded-lg border bg-card">
      {title && <div className="px-4 py-2.5 border-b text-xs text-muted-foreground">{title}</div>}
      {loading ? (
        <div className="p-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">{emptyNote ?? 'No recent activity.'}</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">When</th>
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-left font-medium px-4 py-2">Event</th>
              <th className="text-left font-medium px-4 py-2">Caller</th>
              <th className="text-right font-medium px-4 py-2">ms</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-2 whitespace-nowrap text-xs">{fmt(r.when)}</td>
                <td className="px-4 py-2"><StatusPill status={r.status} /></td>
                <td className="px-4 py-2 font-mono text-xs">{r.label}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[260px]">{r.caller}</td>
                <td className="px-4 py-2 text-right text-xs text-muted-foreground">{r.latency ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, RotateCcw, AlertTriangle } from 'lucide-react';

interface Stats {
  source_type: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  chunks: number;
}
interface SyncJob {
  id: string; source: string; sync_type: string; status: string;
  items_processed: number; items_failed: number; error_message: string | null;
  started_at: string | null; completed_at: string | null; created_at: string;
}
interface FailedDoc {
  id: string; title: string; source_type: string;
  extraction_error: string | null; connection_id: string | null;
}
interface Connection {
  id: string; connected_email: string | null; provider: string;
}

export default function M365IndexingPanel() {
  const { session, user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [failed, setFailed] = useState<FailedDoc[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [docs, jobsRes, connsRes] = await Promise.all([
        supabase
          .from('knowledge_documents')
          .select('source_type, extraction_status, chunk_count')
          .in('source_type', ['mail_attachment', 'onedrive', 'sharepoint']),
        supabase
          .from('m365_sync_jobs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('provider_connections')
          .select('id, connected_email, provider')
          .eq('provider', 'outlook')
          .eq('is_connected', true),
      ]);

      // Aggregate stats
      const map = new Map<string, Stats>();
      for (const d of (docs.data ?? []) as any[]) {
        const s = map.get(d.source_type) ?? {
          source_type: d.source_type, total: 0, completed: 0, failed: 0, skipped: 0, chunks: 0,
        };
        s.total++;
        if (d.extraction_status === 'completed') s.completed++;
        if (d.extraction_status === 'failed') s.failed++;
        if (d.extraction_status === 'skipped') s.skipped++;
        s.chunks += d.chunk_count ?? 0;
        map.set(d.source_type, s);
      }
      setStats(Array.from(map.values()));
      setJobs((jobsRes.data ?? []) as SyncJob[]);
      setConnections((connsRes.data ?? []) as Connection[]);

      const failedRes = await supabase
        .from('knowledge_documents')
        .select('id, title, source_type, extraction_error, connection_id')
        .in('source_type', ['mail_attachment', 'onedrive', 'sharepoint'])
        .in('extraction_status', ['failed'])
        .order('updated_at', { ascending: false })
        .limit(50);
      setFailed((failedRes.data ?? []) as FailedDoc[]);
    } catch (e: any) {
      toast({ title: 'Failed to load M365 indexing data', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const invokeSync = async (connectionId: string, syncType: 'delta' | 'full') => {
    if (!session?.access_token) return;
    setBusy(connectionId + ':' + syncType);
    try {
      const { data, error } = await supabase.functions.invoke('m365-sync-connection', {
        body: { connection_id: connectionId, sync_type: syncType, force_full: syncType === 'full' },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw new Error(error.message);
      toast({ title: 'Sync triggered', description: JSON.stringify(data?.results ?? {}) });
      await load();
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const retryFailed = async () => {
    if (!user) return;
    setBusy('retry');
    try {
      const { error } = await supabase
        .from('knowledge_documents')
        .update({ extraction_status: 'pending', extraction_error: null })
        .eq('user_id', user.id)
        .in('extraction_status', ['failed']);
      if (error) throw error;
      toast({ title: 'Marked for retry', description: 'Failed documents will be re-attempted on next sync.' });
      await load();
    } catch (e: any) {
      toast({ title: 'Retry failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Indexing Stats</CardTitle>
          <CardDescription>Documents indexed from Microsoft 365 sources.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No M365 documents indexed yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {stats.map((s) => (
                <div key={s.source_type} className="rounded-lg border bg-card p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.source_type}</div>
                  <div className="mt-1 text-2xl font-semibold">{s.total}</div>
                  <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                    <div>✓ {s.completed} completed · {s.chunks.toLocaleString()} chunks</div>
                    {s.failed > 0 && <div className="text-destructive">✗ {s.failed} failed</div>}
                    {s.skipped > 0 && <div>○ {s.skipped} skipped</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync Controls</CardTitle>
          <CardDescription>Trigger delta or full sync per connected account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {connections.length === 0 && (
            <p className="text-sm text-muted-foreground">No active Microsoft 365 connections.</p>
          )}
          {connections.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-medium">{c.connected_email || 'Outlook account'}</div>
                <div className="text-xs text-muted-foreground">{c.id}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="outline"
                  disabled={busy === `${c.id}:delta`}
                  onClick={() => invokeSync(c.id, 'delta')}
                >
                  {busy === `${c.id}:delta` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span className="ml-1">Incremental</span>
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={busy === `${c.id}:full`}
                  onClick={() => invokeSync(c.id, 'full')}
                >
                  {busy === `${c.id}:full` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  <span className="ml-1">Force Full</span>
                </Button>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Button size="sm" variant="secondary" disabled={busy === 'retry'} onClick={retryFailed}>
              {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              <span className="ml-1">Retry All Failed</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync History</CardTitle>
          <CardDescription>Last 50 sync jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sync jobs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Items</th>
                    <th className="py-2 pr-3">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">
                        {new Date(j.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">{j.source}</td>
                      <td className="py-2 pr-3">{j.sync_type}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={
                          j.status === 'complete' ? 'default' :
                          j.status === 'failed' ? 'destructive' : 'secondary'
                        }>{j.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {j.items_processed} ok · {j.items_failed} fail
                      </td>
                      <td className="py-2 pr-3 text-xs text-destructive max-w-xs truncate">
                        {j.error_message ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {failed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Failed Extractions</CardTitle>
            <CardDescription>Documents that could not be parsed.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">File</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((d) => (
                    <tr key={d.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 max-w-sm truncate">{d.title}</td>
                      <td className="py-2 pr-3">{d.source_type}</td>
                      <td className="py-2 pr-3 text-xs text-destructive max-w-md truncate">
                        {d.extraction_error ?? 'Unknown error'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

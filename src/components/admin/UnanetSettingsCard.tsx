import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Zap, CheckCircle2, AlertTriangle, XCircle, Plug, Unplug, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type Status = {
  connected: boolean;
  status?: string;
  base_url?: string;
  database?: string;
  login_mode?: string | null;
  last_verified_at?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
  last_sync?: {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    records_upserted: number;
    records_capped: boolean;
    error: string | null;
  } | null;
};

/**
 * Unanet per-organization admin card.
 *
 * Flow:
 *  1) User fills Cloud URL + Database and clicks "Verify instance" → `unanet-probe`
 *     (no credential leaves the browser yet).
 *  2) On probe success, the API-key field unlocks and "Connect" invokes
 *     `unanet-connect`, which VERIFIES the key server-side before persisting.
 *  3) "Refresh data" runs `unanet-sync`; "Disconnect" tears down.
 *
 * The API key is never stored client-side and never round-trips back from the server.
 */
export function UnanetSettingsCard({ organizationId }: { organizationId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ connected: false });

  const [cloudUrl, setCloudUrl] = useState('');
  const [database, setDatabase] = useState('');
  const [apiKey, setApiKey] = useState('');

  const [probed, setProbed] = useState<{ ok: boolean; loginMode?: string | null } | null>(null);
  const [probing, setProbing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('unanet-status', { body: {} });
      if (error) throw error;
      const s = (data as Status) ?? { connected: false };
      setStatus(s);
      if (s.connected) {
        setCloudUrl(s.base_url ?? '');
        setDatabase(s.database ?? '');
        setProbed({ ok: true, loginMode: s.login_mode });
      } else {
        setProbed(null);
      }
    } catch (e: any) {
      // 404 from the gate means the org doesn't have the feature — surface plainly.
      const msg = e?.message ?? 'Failed to load Unanet status';
      if (!/not found/i.test(msg)) toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId]);

  const doProbe = async () => {
    if (!cloudUrl.trim() || !database.trim()) {
      toast.error('Cloud URL and database are required.');
      return;
    }
    setProbing(true);
    setProbed(null);
    try {
      const { data, error } = await supabase.functions.invoke('unanet-probe', {
        body: { base_url: cloudUrl.trim(), database: database.trim() },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Instance did not respond');
        setProbed({ ok: false });
        return;
      }
      setProbed({ ok: true, loginMode: (data as any)?.loginMode ?? null });
      toast.success('Instance reachable. Paste the API key and click Connect.');
    } finally {
      setProbing(false);
    }
  };

  const doConnect = async () => {
    if (!probed?.ok) {
      toast.error('Verify the instance first.');
      return;
    }
    if (!apiKey || apiKey.trim().length < 8) {
      toast.error('Paste the Unanet API key.');
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('unanet-connect', {
        body: { base_url: cloudUrl.trim(), database: database.trim(), api_key: apiKey.trim() },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Failed to connect');
        return;
      }
      setApiKey('');
      toast.success('Unanet connected. Starting first sync…');
      // Fire-and-forget initial sync so the dashboard has data.
      supabase.functions.invoke('unanet-sync', { body: { reason: 'connect' } }).catch(() => undefined);
      load();
    } finally {
      setConnecting(false);
    }
  };

  const doDisconnect = async () => {
    if (!confirm('Disconnect Unanet for this organization? Synced records will be preserved.')) return;
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('unanet-disconnect', { body: {} });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Disconnect failed');
        return;
      }
      toast.success('Unanet disconnected.');
      setProbed(null);
      setApiKey('');
      load();
    } finally {
      setDisconnecting(false);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('unanet-sync', { body: { reason: 'manual' } });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Sync failed');
        return;
      }
      const upserted = (data as any)?.records_upserted ?? 0;
      const s = (data as any)?.status ?? 'success';
      if (s === 'success') toast.success(`Synced ${upserted} records`);
      else if (s === 'partial') toast.warning(`Partial sync — ${upserted} records`);
      else toast.error(`Sync failed: ${(data as any)?.error ?? 'unknown'}`);
      load();
    } finally {
      setSyncing(false);
    }
  };

  const StatusPill = () => {
    const s = status.status ?? (status.connected ? 'active' : 'idle');
    const map: Record<string, { icon: any; label: string; className: string }> = {
      active: { icon: CheckCircle2, label: 'Connected', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
      failing: { icon: AlertTriangle, label: 'Failing', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
      disabled: { icon: XCircle, label: 'Disabled', className: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
      idle: { icon: AlertTriangle, label: 'Not configured', className: 'bg-muted text-muted-foreground border-border' },
    };
    const cfg = map[s] ?? map.idle;
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] ${cfg.className}`}>
        <Icon className="h-3 w-3" /> {cfg.label}
      </span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Unanet connection <StatusPill />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Cloud URL</Label>
                <Input
                  className="mt-1"
                  placeholder="https://your-tenant.unanet.biz"
                  value={cloudUrl}
                  onChange={(e) => { setCloudUrl(e.target.value); setProbed(null); }}
                  disabled={status.connected}
                />
              </div>
              <div>
                <Label className="text-xs">Database</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. prod"
                  value={database}
                  onChange={(e) => { setDatabase(e.target.value); setProbed(null); }}
                  disabled={status.connected}
                />
              </div>

              {!status.connected && (
                <div className="md:col-span-2">
                  <Label className="text-xs">API key</Label>
                  <Input
                    className="mt-1"
                    type="password"
                    placeholder={probed?.ok ? 'Paste Unanet API key' : 'Verify instance first…'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={!probed?.ok}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    The key is verified against your Unanet instance, encrypted server-side, and never sent back to the browser.
                  </p>
                </div>
              )}
            </div>

            {status.last_error && (
              <div className="rounded-md border border-rose-500/30 bg-rose-50 dark:bg-rose-950/30 p-2 text-xs text-rose-700 dark:text-rose-200">
                Last error: {status.last_error}
              </div>
            )}

            {status.connected && status.last_sync && (
              <div className="text-[11px] text-muted-foreground">
                Last sync: {status.last_sync.status} — {status.last_sync.records_upserted} records
                {status.last_sync.records_capped ? ' (capped)' : ''}
                {status.last_sync.finished_at ? ` at ${new Date(status.last_sync.finished_at).toLocaleString()}` : ''}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {!status.connected && (
                <>
                  <Button size="sm" variant="outline" onClick={doProbe} disabled={probing}>
                    {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
                    Verify instance
                  </Button>
                  <Button size="sm" onClick={doConnect} disabled={connecting || !probed?.ok}>
                    {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plug className="h-3.5 w-3.5 mr-1" />}
                    Connect
                  </Button>
                </>
              )}
              {status.connected && (
                <>
                  <Button size="sm" variant="outline" onClick={doSync} disabled={syncing}>
                    {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                    Refresh data
                  </Button>
                  <Button size="sm" variant="destructive" onClick={doDisconnect} disabled={disconnecting}>
                    {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Unplug className="h-3.5 w-3.5 mr-1" />}
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

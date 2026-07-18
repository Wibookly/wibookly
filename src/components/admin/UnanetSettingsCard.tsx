import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Zap, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

type Row = {
  id: string;
  organization_id: string;
  integration_slug: string;
  subdomain: string | null;
  status: string;
  last_error: string | null;
  connected_email: string | null;
  connected_at: string | null;
  enabled: boolean;
  updated_at: string;
};

/**
 * Unanet per-organization settings.
 * - `subdomain` holds the cloud URL.
 * - `connected_email` holds the database name (repurposed non-secret slot).
 * - API key is stored server-side (encrypted) via the `unanet-save-credentials` edge fn.
 * - Live status comes from `tenant_integrations.status`.
 */
export function UnanetSettingsCard({ organizationId }: { organizationId: string | null }) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [cloudUrl, setCloudUrl] = useState('');
  const [database, setDatabase] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data } = await supabase
      .from('tenant_integrations')
      .select('id, organization_id, integration_slug, subdomain, status, last_error, connected_email, connected_at, enabled, updated_at')
      .eq('organization_id', organizationId)
      .eq('integration_slug', 'unanet')
      .maybeSingle();
    if (data) {
      setRow(data as Row);
      setCloudUrl(data.subdomain ?? '');
      setDatabase(data.connected_email ?? '');
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId]);

  const save = async () => {
    if (!organizationId) return;
    if (!cloudUrl.trim() || !database.trim()) {
      toast.error('Cloud URL and database are required.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('unanet-save-credentials', {
      body: { cloud_url: cloudUrl.trim(), database: database.trim(), api_key: apiKey || undefined },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Failed to save Unanet credentials');
      return;
    }
    toast.success('Unanet credentials saved');
    setApiKey('');
    load();
  };

  const test = async () => {
    if (!organizationId) return;
    setTesting(true);
    const { data, error } = await supabase.functions.invoke('unanet-probe', { body: {} });
    setTesting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if ((data as any)?.status === 'healthy') toast.success('Unanet connection OK');
    else if ((data as any)?.status === 'warning') toast.warning((data as any)?.message || 'Unanet reachable with warnings');
    else toast.error((data as any)?.message || 'Unanet connection failed');
    load();
  };

  const status = row?.status ?? 'idle';
  const StatusPill = () => {
    const map: Record<string, { icon: any; label: string; className: string }> = {
      healthy: { icon: CheckCircle2, label: 'Connected', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
      connected: { icon: CheckCircle2, label: 'Connected', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
      warning: { icon: AlertTriangle, label: 'Warning', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
      failed: { icon: XCircle, label: 'Failed', className: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
      idle: { icon: AlertTriangle, label: 'Not configured', className: 'bg-muted text-muted-foreground border-border' },
    };
    const s = map[status] ?? map.idle;
    const Icon = s.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] ${s.className}`}>
        <Icon className="h-3 w-3" /> {s.label}
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
                  onChange={(e) => setCloudUrl(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Database</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. prod"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">API key</Label>
                <Input
                  className="mt-1"
                  type="password"
                  placeholder={row?.status === 'healthy' ? '••••••••••• (leave blank to keep)' : 'Paste Unanet API key'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Stored encrypted per-organization. Leave blank on subsequent saves to keep the existing key.
                </p>
              </div>
            </div>

            {row?.last_error && (
              <div className="rounded-md border border-rose-500/30 bg-rose-50 dark:bg-rose-950/30 p-2 text-xs text-rose-700 dark:text-rose-200">
                Last error: {row.last_error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={test} disabled={testing || !row}>
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
                Test connection
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

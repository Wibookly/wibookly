import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Plug, ShieldCheck, AlertCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type Provider = 'microsoft' | 'google';

interface StatusRow {
  provider: string;
  tenant_id: string | null;
  status: string;
  last_error: string | null;
  last_test_at: string | null;
  connected_at: string | null;
  updated_at: string;
}

export function OrgEnvironmentCard({ organizationId, userId }: { organizationId: string; userId: string }) {
  const [statusByProvider, setStatusByProvider] = useState<Record<string, StatusRow>>({});
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<Provider>('microsoft');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_org_environment_status', { _org_id: organizationId });
    if (!error && Array.isArray(data)) {
      const map: Record<string, StatusRow> = {};
      for (const row of data as StatusRow[]) map[row.provider] = row;
      setStatusByProvider(map);
    }
    setLoading(false);
  };

  useEffect(() => { if (organizationId) loadStatus(); }, [organizationId]);

  const current = statusByProvider[provider];

  const save = async () => {
    if (!clientId || !clientSecret) {
      toast.error('Client ID and client secret are required'); return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('org-environment-credentials', {
      body: { action: 'set', organizationId, provider, clientId, clientSecret, tenantId: tenantId || undefined },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Save failed'); return;
    }
    toast.success('Credentials saved');
    setClientSecret('');
    loadStatus();
  };

  const remove = async () => {
    if (!confirm('Remove the saved credentials for this provider?')) return;
    const { data, error } = await supabase.functions.invoke('org-environment-credentials', {
      body: { action: 'delete', organizationId, provider },
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Delete failed'); return;
    }
    toast.success('Credentials removed');
    loadStatus();
  };

  const connectNow = async () => {
    setConnecting(true);
    const { data, error } = await supabase.functions.invoke('oauth-init', {
      body: {
        provider: provider === 'microsoft' ? 'outlook' : 'google',
        userId,
        organizationId,
        redirectUrl: '/org-admin',
      },
    });
    setConnecting(false);
    if (error || !(data as any)?.authUrl) {
      toast.error(error?.message || (data as any)?.error || 'Could not start OAuth flow'); return;
    }
    window.location.href = (data as any).authUrl;
  };

  const statusBadge = (s?: StatusRow) => {
    if (!s) return <Badge variant="outline">Not configured</Badge>;
    if (s.status === 'connected') return <Badge className="bg-green-600">Connected</Badge>;
    if (s.status === 'error') return <Badge variant="destructive">Error</Badge>;
    if (s.status === 'configured') return <Badge variant="secondary">Configured</Badge>;
    return <Badge variant="outline">{s.status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="w-5 h-5" /> Environment connection
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</div>
        ) : (
          <Tabs value={provider} onValueChange={(v) => setProvider(v as Provider)}>
            <TabsList>
              <TabsTrigger value="microsoft">Microsoft 365</TabsTrigger>
              <TabsTrigger value="google">Google Workspace</TabsTrigger>
            </TabsList>

            {(['microsoft', 'google'] as Provider[]).map(p => (
              <TabsContent key={p} value={p} className="space-y-4 pt-4">
                <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">Current status</div>
                      <div className="text-xs text-muted-foreground">
                        {statusByProvider[p]?.connected_at
                          ? `Connected ${new Date(statusByProvider[p]!.connected_at!).toLocaleString()}`
                          : statusByProvider[p]?.updated_at
                            ? `Updated ${new Date(statusByProvider[p]!.updated_at).toLocaleString()}`
                            : 'No credentials saved for this organization yet.'}
                      </div>
                      {statusByProvider[p]?.last_error && (
                        <div className="text-xs text-destructive flex items-center gap-1 mt-1">
                          <AlertCircle className="w-3 h-3" /> {statusByProvider[p]!.last_error}
                        </div>
                      )}
                    </div>
                  </div>
                  {statusBadge(statusByProvider[p])}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Client ID</Label>
                    <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Client secret <span className="text-muted-foreground">(stored encrypted, never displayed)</span></Label>
                    <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••••••••" />
                  </div>
                  {p === 'microsoft' && (
                    <div className="col-span-2">
                      <Label className="text-xs">Tenant ID <span className="text-muted-foreground">(optional — defaults to "common")</span></Label>
                      <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="contoso.onmicrosoft.com or tenant GUID" />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 justify-end">
                  {statusByProvider[p] && (
                    <Button variant="outline" onClick={remove}><Trash2 className="w-4 h-4 mr-1" /> Remove credentials</Button>
                  )}
                  <Button variant="secondary" onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                    Save credentials
                  </Button>
                  <Button onClick={connectNow} disabled={connecting}>
                    {connecting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plug className="w-4 h-4 mr-1" />}
                    Connect now
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Each organization can connect its own {p === 'microsoft' ? 'Microsoft 365' : 'Google Workspace'} tenant.
                  Email, calendar, and meeting features for users in this organization will only ever use this connection.
                </p>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

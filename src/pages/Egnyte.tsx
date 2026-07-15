import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { useUserRoles } from '@/hooks/useUserRoles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FolderSearch, ExternalLink, Unplug, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { EgnyteConnectDialog } from '@/components/integrations/EgnyteConnectDialog';

type SafeRow = {
  id: string;
  organization_id: string;
  integration_slug: string;
  subdomain: string | null;
  granted_scopes: string[] | null;
  status: string;
  last_error: string | null;
  last_synced_at: string | null;
  connected_email: string | null;
  connected_at: string | null;
  enabled: boolean;
  token_expires_at: string | null;
  updated_at: string;
};

type SearchItem = {
  name: string | null;
  path: string | null;
  size: number | null;
  modified: string | null;
  type: string;
  url: string | null;
};

export default function Egnyte() {
  const { user } = useAuth();
  const { hasFeature, loading: featLoading } = useFeatureAccess();
  const { isSuperAdmin, isOrgAdmin } = useUserRoles();
  const { toast } = useToast();
  const [row, setRow] = useState<SafeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchItem[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);

  const canUse = hasFeature('egnyte_integration');
  const canManage = isSuperAdmin || isOrgAdmin;

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('tenant_integrations_safe' as any) as any)
      .select('*').eq('integration_slug', 'egnyte').maybeSingle();
    setRow((data as SafeRow) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('connected') === 'egnyte') {
      toast({ title: 'Egnyte connected', description: 'Your organization is now linked to Egnyte.' });
      url.searchParams.delete('connected');
      window.history.replaceState({}, '', url.toString());
      refresh();
    }
  }, [refresh, toast]);

  const disconnect = async () => {
    const { error } = await supabase.functions.invoke('egnyte-disconnect');
    if (error) return toast({ title: 'Disconnect failed', description: error.message, variant: 'destructive' });
    toast({ title: 'Egnyte disconnected' });
    setResults([]);
    refresh();
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('egnyte-search', { body: { query: query.trim(), count: 20 } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResults(data?.results ?? []);
    } catch (e) {
      toast({ title: 'Search failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  if (featLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!canUse) return <Navigate to="/home" replace />;

  const connected = row?.status === 'connected' && row?.enabled;
  const errored = row?.status === 'error' || row?.status === 'expired';

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><FolderSearch className="h-6 w-6" /> Egnyte</h1>
        <p className="text-sm text-muted-foreground">
          Connect your organization's Egnyte domain to search files and folders directly from InboxIQ and AI Chat. All results respect each signed-in user's Egnyte permissions.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking connection…</div>
        ) : connected ? (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Connected to <span className="font-mono">{row?.subdomain}.egnyte.com</span>
              </div>
              {row?.connected_email && <div className="text-xs text-muted-foreground">Connected as {row.connected_email}</div>}
              {row?.connected_at && <div className="text-xs text-muted-foreground">Since {new Date(row.connected_at).toLocaleString()}</div>}
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={disconnect}><Unplug className="h-4 w-4 mr-2" /> Disconnect</Button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm space-y-1">
              <div className="font-medium flex items-center gap-2">
                {errored && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                {row?.status === 'expired' ? 'Reconnect required' : row?.status === 'error' ? 'Connection error' : row?.status === 'pending' ? 'Waiting for authorization…' : 'Not connected'}
              </div>
              <div className="text-muted-foreground">
                {row?.last_error
                  ? row.last_error
                  : 'An organization admin can connect Egnyte to enable file & folder search across InboxIQ and AI Chat.'}
              </div>
            </div>
            {canManage ? (
              <Button onClick={() => setConnectOpen(true)}>
                {row?.status === 'expired' || row?.status === 'error' ? 'Reconnect Egnyte' : 'Connect Egnyte'}
              </Button>
            ) : (
              <div className="text-xs text-muted-foreground">Only admins can connect Egnyte for this organization.</div>
            )}
          </div>
        )}
      </section>

      {connected && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-medium">Search your Egnyte</h2>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search filenames, folders, metadata…"
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            />
            <Button onClick={runSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
            </Button>
          </div>
          {results.length > 0 && (
            <ul className="divide-y divide-border">
              {results.map((r, i) => (
                <li key={i} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.name ?? r.path}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.path}</div>
                  </div>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-primary flex items-center gap-1 shrink-0">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <EgnyteConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        defaultSubdomain={row?.subdomain ?? ''}
        returnPath="/egnyte"
      />
    </div>
  );
}

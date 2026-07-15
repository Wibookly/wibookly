import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FolderSearch, ExternalLink, Unplug, ShieldCheck } from 'lucide-react';
import { Navigate } from 'react-router-dom';

type Conn = {
  user_id: string;
  egnyte_domain: string;
  egnyte_username: string | null;
  expires_at: string | null;
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
  const { toast } = useToast();
  const [conn, setConn] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchItem[]>([]);

  const canUse = hasFeature('egnyte_integration');

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from('egnyte_connection_status').select('*').maybeSingle();
    setConn((data as Conn) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Handle return from popup / redirect
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('egnyte') === 'connected') {
      toast({ title: 'Egnyte connected', description: 'Your Egnyte account is now linked.' });
      url.searchParams.delete('egnyte');
      window.history.replaceState({}, '', url.toString());
      refresh();
    }
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'egnyte_connected') refresh();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [refresh, toast]);

  const connect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('egnyte-oauth-init', {
        body: { return_to: '/egnyte' },
      });
      if (error || !data?.authorization_url) throw new Error(data?.error || error?.message || 'Failed to start');
      const popup = window.open(data.authorization_url, 'egnyte_oauth', 'width=520,height=720');
      if (!popup) window.location.href = data.authorization_url;
    } catch (e) {
      toast({ title: 'Could not start Egnyte connection', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    const { error } = await supabase.functions.invoke('egnyte-disconnect');
    if (error) return toast({ title: 'Disconnect failed', description: error.message, variant: 'destructive' });
    toast({ title: 'Egnyte disconnected' });
    setConn(null);
    setResults([]);
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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><FolderSearch className="h-6 w-6" /> Egnyte</h1>
        <p className="text-sm text-muted-foreground">
          Connect your Egnyte account to search your files and folders directly from InboxIQ. All results respect your Egnyte permissions.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking connection…</div>
        ) : conn ? (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Connected to <span className="font-mono">{conn.egnyte_domain}</span></div>
              {conn.egnyte_username && <div className="text-xs text-muted-foreground">Signed in as {conn.egnyte_username}</div>}
              <div className="text-xs text-muted-foreground">Last updated {new Date(conn.updated_at).toLocaleString()}</div>
            </div>
            <Button variant="outline" size="sm" onClick={disconnect}><Unplug className="h-4 w-4 mr-2" /> Disconnect</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm">
              <div className="font-medium">Not connected</div>
              <div className="text-muted-foreground">Sign in to Egnyte to enable file & folder search across InboxIQ and AI Chat.</div>
            </div>
            <Button onClick={connect} disabled={connecting}>
              {connecting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Connect Egnyte
            </Button>
          </div>
        )}
      </section>

      {conn && (
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
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PermResult {
  domain: string;
  status: 'ok' | 'no_tenant_id' | 'no_credentials' | 'token_failed' | 'invalid_client_secret' | 'permission_missing' | 'error';
  message: string;
}

interface Props {
  invoke: (action: string, payload?: Record<string, any>) => Promise<any>;
  autoRunNonce?: number;
}

export default function AzurePermissionsCheck({ invoke, autoRunNonce = 0 }: Props) {
  const { toast } = useToast();
  const [results, setResults] = useState<PermResult[] | null>(null);
  const [credsConfigured, setCredsConfigured] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    try {
      const res = await invoke('check_azure_permissions');
      setResults(res?.results || []);
      setCredsConfigured(res?.credentials_configured ?? null);
    } catch (e: any) {
      toast({ title: 'Check failed', description: e.message, variant: 'destructive' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!autoRunNonce) return;
    void runCheck();
  }, [autoRunNonce]);

  const allOk = results && results.length > 0 && results.every((r) => r.status === 'ok');
  const anyMissingPerm = results?.some((r) => r.status === 'permission_missing' || r.status === 'token_failed' || r.status === 'invalid_client_secret');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" /> Azure Permissions Self-Check
            </CardTitle>
            <CardDescription>
              Confirms each authorized tenant has consented to the Graph permissions
              needed for directory sync and email invitations.
            </CardDescription>
          </div>
          <Button onClick={runCheck} disabled={checking} className="gap-2">
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Run check
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {credsConfigured === false && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground/80">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-destructive">Azure client credentials not configured</p>
                <p className="text-xs mt-1">
                  The MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set
                  in your backend secrets before this check can run.
                </p>
              </div>
            </div>
          </div>
        )}

        {!results && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Click <span className="font-medium">Run check</span> to verify each tenant's permissions.
          </div>
        )}

        {results && results.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No active domains to check. Add one in the Domains tab.
          </div>
        )}

        {results && results.length > 0 && (
          <>
            {allOk && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-foreground/80">All tenants pass — directory sync is ready to go.</span>
              </div>
            )}
            <div className="space-y-2">
              {results.map((r) => (
                <div
                  key={r.domain}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-background"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{r.domain}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.message}</p>
                  </div>
                  <div className="shrink-0">
                    {r.status === 'ok' && (
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1">
                        <CheckCircle2 className="w-3 h-3" /> OK
                      </Badge>
                    )}
                    {r.status === 'no_tenant_id' && (
                      <Badge variant="secondary">Tenant ID missing</Badge>
                    )}
                    {r.status === 'no_credentials' && (
                      <Badge variant="destructive">No credentials</Badge>
                    )}
                    {(r.status === 'token_failed' || r.status === 'permission_missing' || r.status === 'invalid_client_secret') && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="w-3 h-3" /> Action needed
                      </Badge>
                    )}
                    {r.status === 'error' && (
                      <Badge variant="destructive">Error</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {anyMissingPerm && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm space-y-2">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  How to fix missing permissions
                </p>
                <ol className="list-decimal list-inside text-xs text-foreground/80 space-y-1">
                  <li>If the message says <span className="font-mono">Invalid client secret value</span>, update the backend Microsoft secret using the Azure <span className="font-medium">Value</span>, not the Secret ID.</li>
                  <li>Open Azure Portal → App registrations → InboxIQ → API permissions</li>
                  <li>Add Microsoft Graph <span className="font-mono">Application</span> permissions: <span className="font-mono">User.Read.All</span>, <span className="font-mono">Organization.Read.All</span>, <span className="font-mono">Mail.Send</span></li>
                  <li>Click <span className="font-medium">Grant admin consent for [tenant]</span></li>
                  <li>Re-run this check</li>
                </ol>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 mt-1"
                  onClick={() => window.open('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', '_blank')}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Azure Portal
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

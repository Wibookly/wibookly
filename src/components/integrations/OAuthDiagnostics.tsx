import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Copy, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DiagnosticResult {
  check: string;
  status: 'pass' | 'fail' | 'warning' | 'pending';
  message: string;
  detail?: string;
}

interface OAuthDiagnosticsProps {
  onClose?: () => void;
}

export function OAuthDiagnostics({ onClose }: OAuthDiagnosticsProps) {
  const { toast } = useToast();
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [running, setRunning] = useState(false);
  const [appOrigin, setAppOrigin] = useState('');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

  useEffect(() => {
    setAppOrigin(window.location.origin);
  }, []);

  const runDiagnostics = async () => {
    setRunning(true);
    const newResults: DiagnosticResult[] = [];

    // Check 1: Current origin
    newResults.push({
      check: 'App Origin',
      status: 'pass',
      message: 'Current app origin detected',
      detail: window.location.origin,
    });

    // Check 2: Supabase URL configured
    if (supabaseUrl) {
      newResults.push({
        check: 'Backend URL',
        status: 'pass',
        message: 'Backend URL is configured',
        detail: supabaseUrl,
      });
    } else {
      newResults.push({
        check: 'Backend URL',
        status: 'fail',
        message: 'Backend URL not configured',
      });
    }

    // Check 3: User session
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      newResults.push({
        check: 'User Session',
        status: 'pass',
        message: 'Active session found',
        detail: `User: ${sessionData.session.user.email}`,
      });
    } else {
      newResults.push({
        check: 'User Session',
        status: 'fail',
        message: 'No active session - login required',
      });
    }

    // Check 4: Test oauth-init endpoint reachability
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/oauth-init`, {
        method: 'OPTIONS',
      });
      if (response.ok || response.status === 204) {
        newResults.push({
          check: 'OAuth Init Endpoint',
          status: 'pass',
          message: 'oauth-init endpoint is reachable',
        });
      } else {
        newResults.push({
          check: 'OAuth Init Endpoint',
          status: 'warning',
          message: `Endpoint returned status ${response.status}`,
        });
      }
    } catch (e) {
      newResults.push({
        check: 'OAuth Init Endpoint',
        status: 'fail',
        message: 'Cannot reach oauth-init endpoint',
        detail: String(e),
      });
    }

    // Check 5: Google Console reminder
    newResults.push({
      check: 'Google Console Config',
      status: 'warning',
      message: 'Verify Google Console settings manually',
      detail: `Authorized JS Origin: ${window.location.origin}\nRedirect URI: ${callbackUrl}`,
    });

    setResults(newResults);
    setRunning(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: `${label} copied to clipboard` });
  };

  const statusIcon = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'pass':
        return <CheckCircle className="w-5 h-5 text-success" />;
      case 'fail':
        return <XCircle className="w-5 h-5 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-warning" />;
      default:
        return <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />;
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">OAuth Connection Diagnostics</h3>
        <Button variant="outline" size="sm" onClick={runDiagnostics} disabled={running}>
          {running ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Run Diagnostics
        </Button>
      </div>

      {/* Quick copy section */}
      <div className="bg-secondary/50 rounded-md p-4 space-y-3">
        <p className="text-sm font-medium">Required Google Console Values:</p>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Authorized JavaScript Origin:</span>
            <div className="flex items-center gap-2">
              <code className="bg-background px-2 py-1 rounded text-xs">{appOrigin}</code>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(appOrigin, 'Origin')}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Authorized Redirect URI:</span>
            <div className="flex items-center gap-2">
              <code className="bg-background px-2 py-1 rounded text-xs truncate max-w-[300px]">{callbackUrl}</code>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(callbackUrl, 'Redirect URI')}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
        >
          Open Google Cloud Console <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result, idx) => (
            <div key={idx} className="flex items-start gap-3 p-3 bg-secondary/30 rounded-md">
              {statusIcon(result.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{result.check}</p>
                <p className="text-sm text-muted-foreground">{result.message}</p>
                {result.detail && (
                  <pre className="mt-1 text-xs bg-background p-2 rounded overflow-x-auto whitespace-pre-wrap">
                    {result.detail}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {onClose && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}

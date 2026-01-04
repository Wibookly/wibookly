import { Button } from '@/components/ui/button';
import { AlertTriangle, Copy, ExternalLink, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface GoogleOAuthErrorScreenProps {
  errorMessage?: string;
  onBack: () => void;
}

export function GoogleOAuthErrorScreen({ errorMessage, onBack }: GoogleOAuthErrorScreenProps) {
  const { toast } = useToast();

  const appOrigin = window.location.origin;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: `${label} copied to clipboard` });
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-destructive/10 rounded-full">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Google Connection Failed</h2>
            <p className="text-muted-foreground mt-1">
              {errorMessage || 'A 403 error typically means your Google Cloud Console settings need updating.'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-medium">Required Google Cloud Console Settings</h3>

          <div className="bg-secondary/50 rounded-md p-4 space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">1. Authorized JavaScript Origins</p>
              <p className="text-xs text-muted-foreground mb-2">
                Add this exact URL (no trailing slash):
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background px-3 py-2 rounded text-sm font-mono">{appOrigin}</code>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(appOrigin, 'Origin')}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">2. Authorized Redirect URIs</p>
              <p className="text-xs text-muted-foreground mb-2">
                Add this exact callback URL:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background px-3 py-2 rounded text-sm font-mono break-all">{callbackUrl}</code>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(callbackUrl, 'Redirect URI')}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-warning/10 border border-warning/30 rounded-md p-4 space-y-3">
            <h4 className="font-medium text-sm">Additional Checks</h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-warning">•</span>
                <span><strong>Gmail API</strong>: Must be enabled in Google Cloud Console → APIs & Services → Library</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning">•</span>
                <span><strong>OAuth Consent Screen</strong>: Either publish your app OR add your email to "Test users"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning">•</span>
                <span><strong>Wait 5 minutes</strong>: Google can take a few minutes to propagate changes</span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Open Google Cloud Console <ExternalLink className="w-4 h-4" />
            </a>
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Integrations
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

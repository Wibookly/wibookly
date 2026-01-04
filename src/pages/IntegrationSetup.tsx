import { Copy, ExternalLink, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export default function IntegrationSetup() {
  const { toast } = useToast();

  const appOrigin = window.location.origin;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: `${label} copied to clipboard` });
  };

  const copyValue = (value: string, label: string) => (
    <div className="flex items-center gap-2">
      <code className="flex-1 bg-secondary px-3 py-2 rounded text-sm font-mono break-all">{value}</code>
      <Button variant="ghost" size="icon" onClick={() => copyToClipboard(value, label)}>
        <Copy className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <section className="max-w-3xl animate-fade-in">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Integration Setup Guide</h1>
        <p className="mt-1 text-muted-foreground">
          Copy-paste-ready values for configuring Google and Microsoft OAuth
        </p>
      </header>

      {/* Google Setup */}
      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none">
            <path
              d="M43.611 20.083H42V20H24V28H35.303C33.654 32.657 29.223 36 24 36C17.373 36 12 30.627 12 24C12 17.373 17.373 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24C4 35.045 12.955 44 24 44C35.045 44 44 35.045 44 24C44 22.659 43.862 21.35 43.611 20.083Z"
              fill="#FFC107"
            />
            <path
              d="M6.306 14.691L12.877 19.51C14.655 15.108 18.961 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691Z"
              fill="#FF3D00"
            />
            <path
              d="M24 44C29.166 44 33.86 42.023 37.409 38.808L31.219 33.57C29.211 35.091 26.715 36 24 36C18.798 36 14.381 32.683 12.717 28.054L6.195 33.079C9.505 39.556 16.227 44 24 44Z"
              fill="#4CAF50"
            />
            <path
              d="M43.611 20.083H42V20H24V28H35.303C34.511 30.237 33.072 32.166 31.216 33.571L31.219 33.57L37.409 38.808C36.971 39.205 44 34 44 24C44 22.659 43.862 21.35 43.611 20.083Z"
              fill="#1976D2"
            />
          </svg>
          <h2 className="text-lg font-semibold">Google Workspace / Gmail</h2>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm">1</span>
              Authorized JavaScript Origins
            </h3>
            <p className="text-sm text-muted-foreground mb-2">Add this to your OAuth client credentials:</p>
            {copyValue(appOrigin, 'JavaScript Origin')}
          </div>

          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm">2</span>
              Authorized Redirect URI
            </h3>
            <p className="text-sm text-muted-foreground mb-2">Add this exact callback URL:</p>
            {copyValue(callbackUrl, 'Redirect URI')}
          </div>

          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm">3</span>
              Required APIs
            </h3>
            <p className="text-sm text-muted-foreground mb-2">Enable these in Google Cloud Console → APIs & Services → Library:</p>
            <ul className="space-y-1">
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-success" />
                Gmail API
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-success" />
                Google People API (optional, for profile info)
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm">4</span>
              OAuth Consent Screen
            </h3>
            <p className="text-sm text-muted-foreground">
              Either publish your app to production OR add your test email under "Test users" in the OAuth consent screen settings.
            </p>
          </div>

          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            Open Google Cloud Console <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Microsoft Setup */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none">
            <path d="M28 8H44V40H28V8Z" fill="#1976D2" />
            <path d="M28 8L4 13V35L28 40V8Z" fill="#2196F3" />
            <path
              d="M16 18C12.686 18 10 20.686 10 24C10 27.314 12.686 30 16 30C19.314 30 22 27.314 22 24C22 20.686 19.314 18 16 18ZM16 27C14.343 27 13 25.657 13 24C13 22.343 14.343 21 16 21C17.657 21 19 22.343 19 24C19 25.657 17.657 27 16 27Z"
              fill="white"
            />
          </svg>
          <h2 className="text-lg font-semibold">Microsoft Outlook</h2>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm">1</span>
              Redirect URI
            </h3>
            <p className="text-sm text-muted-foreground mb-2">Add this under Authentication → Platform configurations → Web:</p>
            {copyValue(callbackUrl, 'Redirect URI')}
          </div>

          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm">2</span>
              Required API Permissions
            </h3>
            <p className="text-sm text-muted-foreground mb-2">Add these under API Permissions → Microsoft Graph:</p>
            <ul className="space-y-1">
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-success" />
                Mail.Read
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-success" />
                Mail.ReadWrite
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-success" />
                User.Read
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-success" />
                offline_access
              </li>
            </ul>
          </div>

          <a
            href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            Open Azure Portal (App Registrations) <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Check, ExternalLink, Clock, Loader2, Settings2, Link as LinkIcon } from 'lucide-react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { OAuthDiagnostics } from '@/components/integrations/OAuthDiagnostics';
import { GoogleOAuthErrorScreen } from '@/components/integrations/GoogleOAuthErrorScreen';
import { useConnectAttemptLogger } from '@/hooks/useConnectAttemptLogger';

interface Connection {
  id: string;
  provider: string;
  is_connected: boolean;
  connected_at: string | null;
  connected_email: string | null;
  calendar_connected: boolean;
  calendar_connected_at: string | null;
}

type ProviderId = 'google' | 'outlook';

export default function Integrations() {
  const { organization, profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { logAttempt } = useConnectAttemptLogger();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<ProviderId | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [confirmProvider, setConfirmProvider] = useState<ProviderId | null>(null);
  const confirmOpen = confirmProvider !== null;

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showGoogleError, setShowGoogleError] = useState(false);
  const [googleErrorMessage, setGoogleErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    // Handle OAuth callback results
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected) {
      logAttempt({ provider: connected, stage: 'callback_success' });
      toast({
        title: 'Connected Successfully',
        description: `Your ${connected === 'google' ? 'Google' : 'Microsoft Outlook'} account has been connected.`,
      });
      setSearchParams({});
      fetchConnections();
    }

    if (error) {
      const provider = searchParams.get('provider') || 'unknown';
      logAttempt({ provider, stage: 'callback_error', errorMessage: error });
      
      // Check if this is a 403-type error for Google
      if (error.toLowerCase().includes('403') || error.toLowerCase().includes('forbidden') || error.toLowerCase().includes('access_denied')) {
        setGoogleErrorMessage(error);
        setShowGoogleError(true);
      } else {
        toast({
          title: 'Connection Failed',
          description: error,
          variant: 'destructive',
        });
      }
      setSearchParams({});
    }
  }, [searchParams]);

  const fetchConnections = async () => {
    if (!organization?.id) return;

    // Use secure RPC function that doesn't expose tokens
    const { data } = await supabase.rpc('get_my_connections');

    setConnections(data || []);
    setLoading(false);
  };

  useEffect(() => {
    // Wait for auth to load and organization to be available
    if (authLoading) return;
    if (!organization?.id) {
      setLoading(false);
      return;
    }
    fetchConnections();
  }, [organization?.id, authLoading]);

  const getConnectionsByProvider = (provider: ProviderId) => connections.filter((c) => c.provider === provider && c.is_connected);

  const providerLabel = useMemo(
    () => ({
      google: 'Google Workspace',
      outlook: 'Microsoft Outlook',
    }),
    []
  );

  const startConnect = async (provider: ProviderId) => {
    // Wait for auth to finish loading
    if (authLoading) {
      toast({
        title: 'Please wait',
        description: 'Loading your session...',
      });
      return;
    }

    logAttempt({ provider, stage: 'init_started' });

    // Don't rely on context state alone; fetch a fresh session to avoid race/stale state.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const liveUserId = sessionData.session?.user?.id;

    if (sessionError || !liveUserId) {
      logAttempt({ provider, stage: 'init_error', errorCode: 'no_session', errorMessage: 'No active session' });
      toast({
        title: 'Sign in required',
        description: 'Please sign in with email to connect an account.',
        variant: 'destructive',
      });
      return;
    }

    let orgId = organization?.id;

    // If organization isn't ready in context yet, fetch it via secure RPC.
    if (!orgId) {
      const { data: profileRows } = await supabase.rpc('get_my_profile');
      const profileData = profileRows?.[0];

      orgId = profileData?.organization_id;
    }

    if (!orgId) {
      logAttempt({ provider, stage: 'init_error', errorCode: 'no_org', errorMessage: 'No organization found' });
      toast({
        title: 'Please wait',
        description: 'Loading your organization...',
      });
      return;
    }

    setConnecting(provider);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('oauth-init', {
        body: {
          provider,
          userId: liveUserId,
          organizationId: orgId,
          redirectUrl: '/integrations',
        },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });

      if (error) {
        throw error;
      }

      if (data?.authUrl) {
        logAttempt({ provider, stage: 'redirect_to_provider', meta: { authUrl: data.authUrl.substring(0, 100) } });
        // Redirect to OAuth provider
        window.location.href = data.authUrl;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error: any) {
      console.error('OAuth init error:', error);

      const message = String(error?.message || 'Failed to start OAuth flow');
      logAttempt({ provider, stage: 'init_error', errorMessage: message });
      
      const isInvalidJwt = /invalid jwt/i.test(message);

      toast({
        title: 'Connection Failed',
        description: isInvalidJwt
          ? 'Your session needs a refresh. Please sign out and sign back in, then try again.'
          : message,
        variant: 'destructive',
      });
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: ProviderId, connectionId: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) return;

    try {
      // Use secure RPC function to disconnect - clears tokens server-side
      // Note: disconnect_provider will disconnect by provider, but for multi-account
      // we need to pass the connection ID. For now, this disconnects all of same provider.
      const { error } = await supabase.rpc('disconnect_provider', {
        _provider: provider,
      });

      if (error) throw error;

      logAttempt({ provider, stage: 'disconnected' });

      toast({
        title: 'Disconnected',
        description: `Your ${provider === 'google' ? 'Google' : 'Microsoft Outlook'} account has been disconnected.`,
      });

      fetchConnections();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to disconnect',
        variant: 'destructive',
      });
    }
  };

  const googleConnections = getConnectionsByProvider('google');
  const outlookConnections = getConnectionsByProvider('outlook');

  const integrations = useMemo(
    () => [
      {
        id: 'outlook' as const,
        name: 'Microsoft Outlook',
        description: 'Secure OAuth connection. We never ask for your email password.',
        icon: (
          <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none">
            <path d="M28 8H44V40H28V8Z" fill="#1976D2" />
            <path d="M28 8L4 13V35L28 40V8Z" fill="#2196F3" />
            <path
              d="M16 18C12.686 18 10 20.686 10 24C10 27.314 12.686 30 16 30C19.314 30 22 27.314 22 24C22 20.686 19.314 18 16 18ZM16 27C14.343 27 13 25.657 13 24C13 22.343 14.343 21 16 21C17.657 21 19 22.343 19 24C19 25.657 17.657 27 16 27Z"
              fill="white"
            />
          </svg>
        ),
        connections: outlookConnections,
        available: true,
      },
      {
        id: 'google' as const,
        name: 'Google Workspace',
        description: 'Connect your Gmail and Google Workspace accounts.',
        icon: (
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
        ),
        connections: googleConnections,
        available: true,
      },
    ],
    [googleConnections, outlookConnections]
  );

  // Extract first name from profile or email
  const getFirstName = () => {
    if (profile?.full_name) {
      return profile.full_name.split(' ')[0];
    }
    if (profile?.email) {
      // Extract name from email (e.g., john.doe@example.com -> John)
      const emailName = profile.email.split('@')[0].split('.')[0];
      return emailName.charAt(0).toUpperCase() + emailName.slice(1).toLowerCase();
    }
    return '';
  };

  const firstName = getFirstName();

  // If showing Google error screen
  if (showGoogleError) {
    return <GoogleOAuthErrorScreen errorMessage={googleErrorMessage} onBack={() => setShowGoogleError(false)} />;
  }

  return (
    <div className="min-h-full p-4 lg:p-6">
      {/* User Avatar Row */}
      <div className="max-w-3xl mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>
      
      <section className="max-w-3xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6" aria-busy={loading ? 'true' : 'false'}>
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Welcome back{firstName ? `, ${firstName}` : ''}
              </h1>
              <p className="mt-1 text-muted-foreground">Connect your email providers to start organizing</p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/integration-setup">
                <Button variant="ghost" size="sm">
                  <LinkIcon className="w-4 h-4 mr-2" />
                  Setup Guide
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => setShowDiagnostics(!showDiagnostics)}>
                <Settings2 className="w-4 h-4 mr-2" />
                Diagnostics
              </Button>
            </div>
          </div>
        </header>

      {showDiagnostics && (
        <div className="mb-6">
          <OAuthDiagnostics onClose={() => setShowDiagnostics(false)} />
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => (!open ? setConfirmProvider(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Connect {confirmProvider ? providerLabel[confirmProvider] : 'account'}</AlertDialogTitle>
            <AlertDialogDescription>
              You'll be redirected to {confirmProvider ? providerLabel[confirmProvider] : 'your provider'} to sign in and
              approve access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmProvider) return;
                const provider = confirmProvider;
                setConfirmProvider(null);
                await startConnect(provider);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-4">
        {authLoading ? (
          <div className="bg-card rounded-lg border border-border p-6 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading your session...</span>
          </div>
        ) : (
          integrations.map((integration) => (
            <article key={integration.id} className="bg-card rounded-lg border border-border p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0" aria-hidden="true">
                  {integration.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{integration.name}</h2>
                    {!integration.available && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                        <Clock className="w-3 h-3" />
                        Coming Soon
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{integration.description}</p>

                  {/* Show connected accounts with calendar status */}
                  {integration.connections.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {integration.connections.map((conn) => (
                        <div key={conn.id} className="py-3 px-4 bg-secondary/50 rounded-lg">
                          {/* Email row */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm">
                              <Check className="w-4 h-4 text-success" />
                              <span className="font-medium truncate max-w-[200px]">
                                {conn.connected_email || 'Connected'}
                              </span>
                              {conn.connected_at && (
                                <span className="text-muted-foreground text-xs">
                                  · {new Date(conn.connected_at).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-destructive hover:text-destructive h-7 px-2"
                              onClick={() => handleDisconnect(integration.id, conn.id)}
                            >
                              Disconnect
                            </Button>
                          </div>
                          
                          {/* Calendar status under email */}
                          <div className="mt-2 ml-6 flex items-center justify-between py-2 px-3 bg-background/50 rounded-md border border-border/50">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                <line x1="16" y1="2" x2="16" y2="6"/>
                                <line x1="8" y1="2" x2="8" y2="6"/>
                                <line x1="3" y1="10" x2="21" y2="10"/>
                              </svg>
                              <span>{integration.id === 'google' ? 'Google Calendar' : 'Outlook Calendar'}</span>
                            </div>
                            {conn.calendar_connected ? (
                              <div className="flex items-center gap-1.5 text-xs text-success">
                                <Check className="w-3.5 h-3.5" />
                                Connected
                              </div>
                            ) : (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-7 text-xs"
                                onClick={() => setConfirmProvider(integration.id)}
                              >
                                Connect Calendar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <Button
                    size="sm"
                    disabled={!integration.available || connecting === integration.id}
                    onClick={() => setConfirmProvider(integration.id)}
                  >
                    {connecting === integration.id ? (
                      <>
                        <Loader2 className="mr-2 w-3 h-3 animate-spin" />
                        Connecting...
                      </>
                    ) : integration.available ? (
                      <>
                        {integration.connections.length > 0 ? 'Add Another' : 'Connect'}
                        <ExternalLink className="ml-2 w-3 h-3" />
                      </>
                    ) : (
                      'Coming Soon'
                    )}
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      </section>
    </div>
  );
}

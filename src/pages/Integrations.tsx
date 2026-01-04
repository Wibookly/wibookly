import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Check, ExternalLink, Clock, Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

interface Connection {
  provider: string;
  is_connected: boolean;
  connected_at: string | null;
}

export default function Integrations() {
  const { organization, user, loading: authLoading, session } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    // Handle OAuth callback results
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected) {
      toast({
        title: 'Connected Successfully',
        description: `Your ${connected === 'google' ? 'Google' : 'Microsoft Outlook'} account has been connected.`
      });
      setSearchParams({});
      fetchConnections();
    }

    if (error) {
      toast({
        title: 'Connection Failed',
        description: error,
        variant: 'destructive'
      });
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

  const getConnection = (provider: string) => 
    connections.find(c => c.provider === provider);

  const handleConnect = async (provider: string) => {
    // Wait for auth to finish loading
    if (authLoading) {
      toast({
        title: 'Please wait',
        description: 'Loading your session...',
      });
      return;
    }

    if (!session || !user?.id || !organization?.id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to connect an account. Please sign out and sign in again.',
        variant: 'destructive'
      });
      return;
    }

    setConnecting(provider);

    try {
      const { data, error } = await supabase.functions.invoke('oauth-init', {
        body: {
          provider,
          userId: user.id,
          organizationId: organization.id,
          redirectUrl: '/integrations'
        }
      });

      if (error) {
        throw error;
      }

      if (data?.authUrl) {
        // Redirect to OAuth provider
        window.location.href = data.authUrl;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error: any) {
      console.error('OAuth init error:', error);
      toast({
        title: 'Connection Failed',
        description: error.message || 'Failed to start OAuth flow',
        variant: 'destructive'
      });
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    if (!user?.id) return;

    try {
      // Use secure RPC function to disconnect - clears tokens server-side
      const { data, error } = await supabase.rpc('disconnect_provider', {
        _provider: provider
      });

      if (error) throw error;

      toast({
        title: 'Disconnected',
        description: `Your ${provider === 'google' ? 'Google' : 'Microsoft Outlook'} account has been disconnected.`
      });

      fetchConnections();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to disconnect',
        variant: 'destructive'
      });
    }
  };

  const outlookConnection = getConnection('outlook');
  const googleConnection = getConnection('google');

  const integrations = [
    {
      id: 'outlook',
      name: 'Microsoft Outlook',
      description: 'Secure OAuth connection. We never ask for your email password.',
      icon: (
        <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none">
          <path d="M28 8H44V40H28V8Z" fill="#1976D2"/>
          <path d="M28 8L4 13V35L28 40V8Z" fill="#2196F3"/>
          <path d="M16 18C12.686 18 10 20.686 10 24C10 27.314 12.686 30 16 30C19.314 30 22 27.314 22 24C22 20.686 19.314 18 16 18ZM16 27C14.343 27 13 25.657 13 24C13 22.343 14.343 21 16 21C17.657 21 19 22.343 19 24C19 25.657 17.657 27 16 27Z" fill="white"/>
        </svg>
      ),
      connection: outlookConnection,
      available: true
    },
    {
      id: 'google',
      name: 'Google Workspace',
      description: 'Connect your Gmail and Google Workspace accounts.',
      icon: (
        <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none">
          <path d="M43.611 20.083H42V20H24V28H35.303C33.654 32.657 29.223 36 24 36C17.373 36 12 30.627 12 24C12 17.373 17.373 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24C4 35.045 12.955 44 24 44C35.045 44 44 35.045 44 24C44 22.659 43.862 21.35 43.611 20.083Z" fill="#FFC107"/>
          <path d="M6.306 14.691L12.877 19.51C14.655 15.108 18.961 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691Z" fill="#FF3D00"/>
          <path d="M24 44C29.166 44 33.86 42.023 37.409 38.808L31.219 33.57C29.211 35.091 26.715 36 24 36C18.798 36 14.381 32.683 12.717 28.054L6.195 33.079C9.505 39.556 16.227 44 24 44Z" fill="#4CAF50"/>
          <path d="M43.611 20.083H42V20H24V28H35.303C34.511 30.237 33.072 32.166 31.216 33.571L31.219 33.57L37.409 38.808C36.971 39.205 44 34 44 24C44 22.659 43.862 21.35 43.611 20.083Z" fill="#1976D2"/>
        </svg>
      ),
      connection: googleConnection,
      available: true
    }
  ];

  return (
    <div className="max-w-3xl animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-muted-foreground">
          Connect your email providers to start organizing
        </p>
      </div>

      <div className="space-y-4">
        {authLoading ? (
          <div className="bg-card rounded-lg border border-border p-6 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading your session...</span>
          </div>
        ) : (
        integrations.map((integration) => (
          <div
            key={integration.id}
            className="bg-card rounded-lg border border-border p-6"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">{integration.icon}</div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{integration.name}</h3>
                  {!integration.available && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                      <Clock className="w-3 h-3" />
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {integration.description}
                </p>
                
                {integration.connection?.is_connected && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-success">
                    <Check className="w-4 h-4" />
                    Connected
                    {integration.connection.connected_at && (
                      <span className="text-muted-foreground">
                        · {new Date(integration.connection.connected_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div>
                {integration.connection?.is_connected ? (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleDisconnect(integration.id)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!integration.available || connecting === integration.id}
                    onClick={() => handleConnect(integration.id)}
                  >
                    {connecting === integration.id ? (
                      <>
                        <Loader2 className="mr-2 w-3 h-3 animate-spin" />
                        Connecting...
                      </>
                    ) : integration.available ? (
                      <>
                        Connect
                        <ExternalLink className="ml-2 w-3 h-3" />
                      </>
                    ) : (
                      'Coming Soon'
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))
        )}
      </div>
    </div>
  );
}

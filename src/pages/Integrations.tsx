import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Check, ExternalLink, Clock, Loader2, Settings2, Link as LinkIcon, Calendar, Save, Sparkles } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { OAuthDiagnostics } from '@/components/integrations/OAuthDiagnostics';

import { GoogleOAuthErrorScreen } from '@/components/integrations/GoogleOAuthErrorScreen';
import { useConnectAttemptLogger } from '@/hooks/useConnectAttemptLogger';
import { HelpTip } from '@/components/help/HelpTip';
import { HelpDot } from '@/components/help/HelpDot';
import { PageHero } from '@/components/app/PageHero';

interface Connection {
  id: string;
  provider: string;
  is_connected: boolean;
  connected_at: string | null;
  connected_email: string | null;
  calendar_connected: boolean;
  calendar_connected_at: string | null;
}

interface AvailabilityDay {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  const time24 = `${hour.toString().padStart(2, '0')}:${minute}`;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const label = `${hour12}:${minute} ${period}`;
  return { value: time24, label };
});

const DEFAULT_AVAILABILITY: AvailabilityDay[] = DAYS_OF_WEEK.map(day => ({
  day_of_week: day.value,
  start_time: '09:00',
  end_time: '17:00',
  is_available: day.value >= 1 && day.value <= 5
}));

type ProviderId = 'google' | 'outlook';

export default function Integrations() {
  const { organization, profile, loading: authLoading } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();
  
  const { toast } = useToast();
  const { logAttempt } = useConnectAttemptLogger();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<ProviderId | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [confirmProvider, setConfirmProvider] = useState<ProviderId | null>(null);
  const [confirmCalendarOnly, setConfirmCalendarOnly] = useState(false);
  const confirmOpen = confirmProvider !== null;

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showGoogleError, setShowGoogleError] = useState(false);
  const [googleErrorMessage, setGoogleErrorMessage] = useState<string | undefined>();

  // Disconnect confirmation state
  const [disconnectTarget, setDisconnectTarget] = useState<{ provider: ProviderId; connectionId: string; email: string | null } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<{ open: boolean; title: string; description: string }>({
    open: false,
    title: '',
    description: '',
  });

  // Tab state
  const currentTab = searchParams.get('tab') || 'email';
  
  // Availability state
  const [availability, setAvailability] = useState<AvailabilityDay[]>(DEFAULT_AVAILABILITY);
  const [savingAvailability, setSavingAvailability] = useState(false);
  
  // Meeting duration state
  const [meetingDuration, setMeetingDuration] = useState(30);
  const [savingDuration, setSavingDuration] = useState(false);
  const inviteAutoConnectAttemptedRef = useRef(false);

  // Fetch availability and meeting duration when active connection changes
  useEffect(() => {
    if (activeConnection?.id && organization?.id) {
      fetchAvailability();
      fetchMeetingDuration();
    }
  }, [activeConnection?.id, organization?.id]);

  const fetchAvailability = async () => {
    if (!activeConnection?.id || !profile?.user_id) return;
    
    const { data } = await supabase
      .from('availability_hours')
      .select('*')
      .eq('connection_id', activeConnection.id) as { data: { day_of_week: number; start_time: string; end_time: string; is_available: boolean }[] | null };
    
    if (data && data.length > 0) {
      const merged = DEFAULT_AVAILABILITY.map(defaultDay => {
        const existing = data.find(d => d.day_of_week === defaultDay.day_of_week);
        if (existing) {
          return {
            day_of_week: existing.day_of_week,
            start_time: existing.start_time.slice(0, 5),
            end_time: existing.end_time.slice(0, 5),
            is_available: existing.is_available
          };
        }
        return defaultDay;
      });
      setAvailability(merged);
    }
  };


  const fetchMeetingDuration = async () => {
    if (!activeConnection?.id) return;

    const { data } = await supabase
      .from('email_profiles')
      .select('default_meeting_duration')
      .eq('connection_id', activeConnection.id)
      .maybeSingle();

    if (data) {
      setMeetingDuration((data as Record<string, unknown>).default_meeting_duration as number || 30);
    }
  };

  const saveMeetingDuration = async () => {
    if (!activeConnection?.id) return;
    
    setSavingDuration(true);
    try {
      await supabase
        .from('email_profiles')
        .update({ default_meeting_duration: meetingDuration } as never)
        .eq('connection_id', activeConnection.id);
      
      toast({ title: 'Duration saved', description: 'Default meeting duration has been updated.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save meeting duration', variant: 'destructive' });
    } finally {
      setSavingDuration(false);
    }
  };

  const saveAvailability = async () => {
    if (!activeConnection?.id || !profile?.user_id || !organization?.id) return;
    
    setSavingAvailability(true);
    try {
      for (const day of availability) {
        const { data: existing } = await supabase
          .from('availability_hours')
          .select('id')
          .eq('connection_id', activeConnection.id)
          .eq('day_of_week', day.day_of_week)
          .maybeSingle();
        
        if (existing) {
          await supabase
            .from('availability_hours')
            .update({
              start_time: day.start_time + ':00',
              end_time: day.end_time + ':00',
              is_available: day.is_available
            })
            .eq('id', existing.id);
        } else {
          const insertData = {
            connection_id: activeConnection.id,
            user_id: profile.user_id,
            organization_id: organization.id,
            day_of_week: day.day_of_week,
            start_time: day.start_time + ':00',
            end_time: day.end_time + ':00',
            is_available: day.is_available
          };
          // @ts-ignore
          await supabase.from('availability_hours').insert(insertData);
        }
      }
      toast({ title: 'Availability saved', description: 'Your availability hours have been updated.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save availability', variant: 'destructive' });
    } finally {
      setSavingAvailability(false);
    }
  };

  useEffect(() => {
    // Handle OAuth callback results
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    const checkout = searchParams.get('checkout');

    if (checkout === 'success' || checkout === 'canceled') {
      setSearchParams({});
    }

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

  useEffect(() => {
    const shouldAutoConnect = searchParams.get('welcome') === '1';

    if (!shouldAutoConnect || authLoading || loading || connecting || inviteAutoConnectAttemptedRef.current) {
      return;
    }

    const hasOutlookConnection = connections.some(
      (connection) => connection.provider === 'outlook' && connection.is_connected,
    );

    inviteAutoConnectAttemptedRef.current = true;

    if (hasOutlookConnection) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('welcome');
      setSearchParams(nextParams, { replace: true });
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('welcome');
    setSearchParams(nextParams, { replace: true });

    void startConnect('outlook');
  }, [authLoading, loading, connecting, connections, searchParams, setSearchParams]);

  // Show connections that are connected OR have a connected_email (to handle cases where is_connected may be stale)
  const getConnectionsByProvider = (provider: ProviderId) => 
    connections.filter((c) => c.provider === provider && c.is_connected);

  const providerLabel = useMemo(
    () => ({
      google: 'Google Workspace',
      outlook: 'Microsoft Outlook',
    }),
    []
  );

  const startConnect = async (provider: ProviderId, options?: { calendarOnly?: boolean }) => {
    const { calendarOnly = false } = options || {};
    
    // Wait for auth to finish loading
    if (authLoading) {
      toast({
        title: 'Please wait',
        description: 'Loading your session...',
      });
      return;
    }

    // Check mailbox limit before connecting (unless it's calendar-only)
    // No mailbox limit - admin controls access now

    logAttempt({ provider, stage: calendarOnly ? 'calendar_init_started' : 'init_started' });

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
      // Force-refresh the session to ensure the JWT is still valid on the server.
      // If the session was revoked (e.g. signed out elsewhere), this will fail
      // and we send the user back to /auth instead of calling the edge function
      // with a dead token.
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      const accessToken = refreshed.session?.access_token;

      if (refreshError || !accessToken) {
        logAttempt({ provider, stage: 'init_error', errorCode: 'session_expired', errorMessage: refreshError?.message || 'No active session' });
        toast({
          title: 'Session expired',
          description: 'Please sign in again to connect your account.',
          variant: 'destructive',
        });
        await supabase.auth.signOut();
        setConnecting(null);
        window.location.href = '/auth';
        return;
      }

      const { data, error } = await supabase.functions.invoke('oauth-init', {
        body: {
          provider,
          userId: liveUserId,
          organizationId: orgId,
          redirectUrl: '/integrations',
          calendarOnly,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (error) {
        throw error;
      }

      if (data?.authUrl) {
        logAttempt({ provider, stage: 'redirect_to_provider', meta: { authUrl: data.authUrl.substring(0, 100), calendarOnly } });

        const isEmbeddedPreview = window.self !== window.top;

        if (isEmbeddedPreview) {
          const popup = window.open(data.authUrl, '_blank', 'noopener,noreferrer');

          if (!popup) {
            window.location.assign(data.authUrl);
          } else {
            setConnecting(null);
            toast({
              title: 'Microsoft sign-in opened',
              description: 'Continue the connection in the new tab that just opened.',
            });
          }
        } else {
          window.location.assign(data.authUrl);
        }
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error: any) {
      console.error('OAuth init error:', error);

      const message = String(error?.message || 'Failed to start OAuth flow');
      logAttempt({ provider, stage: 'init_error', errorMessage: message });

      const isAuthError = /invalid jwt|unauthorized|auth session missing|session not found/i.test(message);

      if (isAuthError) {
        toast({
          title: 'Session expired',
          description: 'Please sign in again to connect your account.',
          variant: 'destructive',
        });
        await supabase.auth.signOut();
        setConnecting(null);
        window.location.href = '/auth';
        return;
      }

      toast({
        title: 'Connection Failed',
        description: message,
        variant: 'destructive',
      });
      setConnecting(null);
    }
  };

  const confirmDisconnect = (provider: ProviderId, connectionId: string, email: string | null) => {
    setDisconnectTarget({ provider, connectionId, email });
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    
    const { provider, connectionId } = disconnectTarget;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) return;

    setDisconnecting(true);
    try {
      setCleanupStatus({
        open: true,
        title: 'Reorganizing mailbox',
        description: 'Please wait while category emails are moved back to Inbox and category folders are removed.',
      });

      const { error } = await supabase.functions.invoke('disconnect-mailbox', {
        body: { provider },
      });

      if (error) throw error;

      logAttempt({ provider, stage: 'disconnected' });

      toast({
        title: 'Disconnected',
        description: `Your ${provider === 'google' ? 'Google' : 'Microsoft Outlook'} account and all related data have been removed. Signing out...`,
      });
      setCleanupStatus({
        open: true,
        title: 'Done',
        description: 'Mailbox cleanup is finished and the account has been disconnected.',
      });

      setDisconnectTarget(null);
      
      // Sign out and redirect to auth page
      await supabase.auth.signOut();
      window.location.href = '/auth';
    } catch (error: any) {
      setCleanupStatus({ open: false, title: '', description: '' });
      toast({
        title: 'Error',
        description: error.message || 'Failed to disconnect',
        variant: 'destructive',
      });
      setDisconnecting(false);
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
    ],
    [outlookConnections]
  );

  // Extract first name from profile full_name (first word only)
  const getFirstName = () => {
    if (profile?.full_name) {
      const nameParts = profile.full_name.trim().split(' ');
      return nameParts[0] || '';
    }
    return '';
  };

  const firstName = getFirstName();

  // If showing Google error screen
  if (showGoogleError) {
    return <GoogleOAuthErrorScreen errorMessage={googleErrorMessage} onBack={() => setShowGoogleError(false)} />;
  }

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Account Provisioning"
          title={`Welcome back${firstName ? `, ${firstName}` : ''}`}
          description="Connect Google or Microsoft so InboxIQ can start organizing your inbox and calendar."
          accent="cyan"
          icon={<LinkIcon className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <section className="page-shell-content animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6" aria-busy={loading ? 'true' : 'false'}>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => {
        if (!open) {
          setConfirmProvider(null);
          setConfirmCalendarOnly(false);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmCalendarOnly ? 'Connect Calendar' : `Connect ${confirmProvider ? providerLabel[confirmProvider] : 'account'}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCalendarOnly 
                ? `You'll be redirected to ${confirmProvider ? providerLabel[confirmProvider] : 'your provider'} to grant calendar access only.`
                : `You'll be redirected to ${confirmProvider ? providerLabel[confirmProvider] : 'your provider'} to sign in and approve access.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmProvider) return;
                const provider = confirmProvider;
                const calendarOnly = confirmCalendarOnly;
                setConfirmProvider(null);
                setConfirmCalendarOnly(false);
                await startConnect(provider, { calendarOnly });
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cleanupStatus.open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{cleanupStatus.title}</AlertDialogTitle>
            <AlertDialogDescription className="flex items-center gap-2 pt-2">
              {cleanupStatus.title !== 'Done' && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{cleanupStatus.description}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cleanupStatus.title === 'Done' && (
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setCleanupStatus({ open: false, title: '', description: '' })}>
                Close
              </AlertDialogAction>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={!!disconnectTarget} onOpenChange={(open) => {
        if (!open) setDisconnectTarget(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Disconnect Email Account
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Are you sure you want to disconnect{' '}
                <strong>{disconnectTarget?.email || 'this account'}</strong>?
              </p>
              <p className="text-destructive font-medium">
                This will permanently delete:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                <li>All categories and rules for this email</li>
                <li>Email signature and profile settings</li>
                <li>AI settings and chat history</li>
                <li>Availability hours configuration</li>
                <li>Calendar connection</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                'Disconnect & Delete Data'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {currentTab === 'settings' && (
        <div className="space-y-8">
          {/* Availability Hours Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-semibold inline-flex items-center gap-2">Availability Hours <HelpTip id="integration.workingHours" /></h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Set your available hours for events and appointments. AI will only schedule events within these time slots.
            </p>
            
            {!activeConnection ? (
              <div className="py-8 text-center text-muted-foreground">
                Connect an email account to configure availability hours.
              </div>
            ) : (
              <>
                <div className="space-y-3 p-4 bg-card rounded-lg border border-border">
                  {availability.map((day, index) => (
                    <div key={day.day_of_week} className="flex items-center gap-4">
                      <div className="w-28 flex items-center gap-2">
                        <Switch
                          checked={day.is_available}
                          onCheckedChange={(checked) => {
                            const updated = [...availability];
                            updated[index] = { ...updated[index], is_available: checked };
                            setAvailability(updated);
                          }}
                          className="scale-90"
                        />
                        <span className={`text-sm font-medium ${!day.is_available ? 'text-muted-foreground' : ''}`}>
                          {DAYS_OF_WEEK[day.day_of_week].label.slice(0, 3)}
                        </span>
                      </div>
                      
                      {day.is_available ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Select
                            value={day.start_time}
                            onValueChange={(value) => {
                              const updated = [...availability];
                              updated[index] = { ...updated[index], start_time: value };
                              setAvailability(updated);
                            }}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIME_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-muted-foreground">to</span>
                          <Select
                            value={day.end_time}
                            onValueChange={(value) => {
                              const updated = [...availability];
                              updated[index] = { ...updated[index], end_time: value };
                              setAvailability(updated);
                            }}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIME_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">Unavailable</span>
                      )}
                    </div>
                  ))}
                </div>
                <Button onClick={saveAvailability} disabled={savingAvailability}>
                  {savingAvailability && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Availability
                </Button>
              </>
            )}
          </div>

          {/* Default Event Duration Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold">Default Event Duration</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Set the default duration for events scheduled by AI. This can be adjusted per event later.
            </p>
            
            {!activeConnection ? (
              <div className="py-8 text-center text-muted-foreground">
                Connect an email account to configure event duration.
              </div>
            ) : (
              <div className="space-y-4 p-4 bg-card rounded-lg border border-border">
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="meetingDuration" className="inline-flex items-center gap-1">Event Duration <HelpTip id="integration.meetingDuration" /></Label>
                    <p className="text-xs text-muted-foreground">
                      Applied to all events scheduled by AI from email requests
                    </p>
                  </div>
                  <Select
                    value={meetingDuration.toString()}
                    onValueChange={(value) => setMeetingDuration(parseInt(value))}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={saveMeetingDuration} disabled={savingDuration}>
                  {savingDuration && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Duration
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email/Calendar Connections Tab (default) */}
      {currentTab === 'email' && (
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
                              <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                {organization?.name?.toLowerCase().includes('personal') ? 'Personal' : 'Business'}
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
                              onClick={() => confirmDisconnect(integration.id, conn.id, conn.connected_email)}
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
                              <span>Outlook Calendar</span>
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
                                onClick={() => {
                                  setConfirmProvider(integration.id);
                                  setConfirmCalendarOnly(true);
                                }}
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
      )}


      </section>
    </div>
  );
}

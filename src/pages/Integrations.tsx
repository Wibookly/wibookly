import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { supabase } from '@/integrations/supabase/client';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Check, ExternalLink, Clock, Loader2, Settings2, Link as LinkIcon, Calendar, Palette, Save } from 'lucide-react';
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

  // Tab state
  const currentTab = searchParams.get('tab') || 'email';
  
  // Availability state
  const [availability, setAvailability] = useState<AvailabilityDay[]>(DEFAULT_AVAILABILITY);
  const [savingAvailability, setSavingAvailability] = useState(false);
  
  // Calendar color state
  const [calendarEventColor, setCalendarEventColor] = useState('#9333EA');
  const [savingColor, setSavingColor] = useState(false);
  
  // Meeting duration state
  const [meetingDuration, setMeetingDuration] = useState(30);
  const [savingDuration, setSavingDuration] = useState(false);

  // Fetch availability, calendar color, and meeting duration when active connection changes
  useEffect(() => {
    if (activeConnection?.id && organization?.id) {
      fetchAvailability();
      fetchCalendarColor();
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

  const fetchCalendarColor = async () => {
    if (!organization?.id || !activeConnection?.id) return;

    const { data } = await supabase
      .from('ai_settings')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('connection_id', activeConnection.id)
      .maybeSingle();

    if (data) {
      setCalendarEventColor((data as Record<string, unknown>).ai_calendar_event_color as string || '#9333EA');
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
        .update({ default_meeting_duration: meetingDuration } as Record<string, unknown>)
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

  const saveCalendarColor = async () => {
    if (!organization?.id || !activeConnection?.id) return;
    
    setSavingColor(true);
    try {
      const { data: existingAI } = await supabase
        .from('ai_settings')
        .select('id')
        .eq('organization_id', organization.id)
        .eq('connection_id', activeConnection.id)
        .maybeSingle();

      if (existingAI) {
        await supabase
          .from('ai_settings')
          .update({ ai_calendar_event_color: calendarEventColor } as Record<string, unknown>)
          .eq('id', existingAI.id);
      } else {
        await supabase
          .from('ai_settings')
          .insert([{
            organization_id: organization.id,
            connection_id: activeConnection.id,
            writing_style: 'professional',
          }]);
      }
      toast({ title: 'Color saved', description: 'AI calendar event color has been updated.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save color', variant: 'destructive' });
    } finally {
      setSavingColor(false);
    }
  };

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

  const getConnectionsByProvider = (provider: ProviderId) => connections.filter((c) => c.provider === provider && c.is_connected);

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
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('oauth-init', {
        body: {
          provider,
          userId: liveUserId,
          organizationId: orgId,
          redirectUrl: '/integrations',
          calendarOnly,
        },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });

      if (error) {
        throw error;
      }

      if (data?.authUrl) {
        logAttempt({ provider, stage: 'redirect_to_provider', meta: { authUrl: data.authUrl.substring(0, 100), calendarOnly } });
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
    <div className="min-h-full p-4 lg:p-6">
      {/* User Avatar Row */}
      <div className="mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>
      
      <section className="animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6" aria-busy={loading ? 'true' : 'false'}>
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

      {/* Availability Hours Tab */}
      {currentTab === 'availability' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-semibold">Availability Hours</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Set your available hours for meetings and appointments. AI will only schedule events within these time slots.
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
      )}

      {/* Calendar Settings Tab */}
      {currentTab === 'calendar' && (
        <div className="space-y-6">
          {/* Meeting Duration */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold">Default Meeting Duration</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Set the default duration for meetings scheduled by AI. This can be adjusted per meeting later.
            </p>
            
            {!activeConnection ? (
              <div className="py-8 text-center text-muted-foreground">
                Connect an email account to configure meeting duration.
              </div>
            ) : (
              <div className="space-y-4 p-4 bg-card rounded-lg border border-border">
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="meetingDuration">Meeting Duration</Label>
                    <p className="text-xs text-muted-foreground">
                      Applied to all meetings scheduled by AI from email requests
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

          {/* Calendar Event Color */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Palette className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-semibold">AI Calendar Event Color</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              When AI adds events or appointments to your calendar, they will be displayed with this color to distinguish them from your manually created events.
            </p>
            
            {!activeConnection ? (
              <div className="py-8 text-center text-muted-foreground">
                Connect an email account to configure calendar event color.
              </div>
            ) : (
              <div className="space-y-4 p-4 bg-card rounded-lg border border-border">
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="aiCalendarColor">Calendar Event Color</Label>
                    <p className="text-xs text-muted-foreground">
                      Applied to events and appointments created by AI from meeting requests
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer relative overflow-hidden"
                      style={{ backgroundColor: calendarEventColor }}
                    >
                      <input
                        type="color"
                        id="aiCalendarColor"
                        value={calendarEventColor}
                        onChange={(e) => setCalendarEventColor(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <span className="text-sm font-mono text-muted-foreground">{calendarEventColor}</span>
                  </div>
                </div>
                <Button onClick={saveCalendarColor} disabled={savingColor}>
                  {savingColor && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Color
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

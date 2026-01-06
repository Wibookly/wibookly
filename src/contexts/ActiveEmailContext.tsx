import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export interface EmailConnection {
  id: string;
  provider: 'google' | 'outlook';
  email: string;
  is_connected: boolean;
  calendar_connected: boolean;
  calendar_connected_at: string | null;
}

interface ActiveEmailContextType {
  connections: EmailConnection[];
  activeConnection: EmailConnection | null;
  setActiveConnectionId: (id: string) => void;
  loading: boolean;
  refreshConnections: () => Promise<void>;
}

const ActiveEmailContext = createContext<ActiveEmailContextType | null>(null);

const ACTIVE_EMAIL_STORAGE_KEY = 'wibookly_active_email_id';

export function ActiveEmailProvider({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConnections = async () => {
    if (!user || !organization?.id) {
      setConnections([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('provider_connections')
      .select('id, provider, connected_email, is_connected, calendar_connected, calendar_connected_at')
      .eq('user_id', user.id)
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch connections', error);
      setConnections([]);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Array<{
      id: string;
      provider: string;
      connected_email: string | null;
      is_connected: boolean;
      calendar_connected: boolean;
      calendar_connected_at: string | null;
    }>;

    const activeEmails = rows
      .filter((c) => c.is_connected && c.connected_email)
      .map((c) => ({
        id: c.id,
        email: c.connected_email as string,
        provider: c.provider as 'google' | 'outlook',
        is_connected: c.is_connected,
        calendar_connected: c.calendar_connected ?? false,
        calendar_connected_at: c.calendar_connected_at ?? null,
      }));

    setConnections(activeEmails);

    // Set initial active connection
    if (activeEmails.length > 0) {
      const storedId = localStorage.getItem(ACTIVE_EMAIL_STORAGE_KEY);
      const storedConnection = storedId ? activeEmails.find((c) => c.id === storedId) : null;

      if (storedConnection) {
        setActiveConnectionIdState(storedConnection.id);
      } else {
        // Default to first connected email
        setActiveConnectionIdState(activeEmails[0].id);
        localStorage.setItem(ACTIVE_EMAIL_STORAGE_KEY, activeEmails[0].id);
      }
    } else {
      setActiveConnectionIdState(null);
      localStorage.removeItem(ACTIVE_EMAIL_STORAGE_KEY);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchConnections();
  }, [user, organization?.id]);

  const setActiveConnectionId = (id: string) => {
    setActiveConnectionIdState(id);
    localStorage.setItem(ACTIVE_EMAIL_STORAGE_KEY, id);
  };

  const activeConnection = connections.find(c => c.id === activeConnectionId) || null;

  return (
    <ActiveEmailContext.Provider
      value={{
        connections,
        activeConnection,
        setActiveConnectionId,
        loading,
        refreshConnections: fetchConnections
      }}
    >
      {children}
    </ActiveEmailContext.Provider>
  );
}

export function useActiveEmail() {
  const context = useContext(ActiveEmailContext);
  if (!context) {
    throw new Error('useActiveEmail must be used within an ActiveEmailProvider');
  }
  return context;
}

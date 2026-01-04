import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

interface Connection {
  id: string;
  provider: string;
  is_connected: boolean;
  connected_email: string | null;
}

export interface ConnectedEmail {
  email: string;
  provider: 'google' | 'outlook';
}

export function useConnectedEmails() {
  const { user, organization } = useAuth();
  const [connectedEmails, setConnectedEmails] = useState<ConnectedEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !organization?.id) {
      setConnectedEmails([]);
      setLoading(false);
      return;
    }

    const fetchConnections = async () => {
      const { data } = await supabase.rpc('get_my_connections');
      
      if (data) {
        const emails = (data as Connection[])
          .filter(c => c.is_connected && c.connected_email)
          .map(c => ({
            email: c.connected_email as string,
            provider: c.provider as 'google' | 'outlook'
          }));
        setConnectedEmails(emails);
      }
      setLoading(false);
    };

    fetchConnections();
  }, [user, organization?.id]);

  return { connectedEmails, loading };
}

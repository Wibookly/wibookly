import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useIntegrationAction() {
  const [running, setRunning] = useState<string | null>(null);
  const { toast } = useToast();

  const dispatch = async (integration_key: string, action: string, params: Record<string, any> = {}) => {
    setRunning(action);
    try {
      const { data, error } = await supabase.functions.invoke('admin-integration-action', {
        body: { integration_key, action, params },
      });
      if (error) throw error;
      toast({
        title: data?.ok ? `Action OK: ${action}` : `Action failed: ${action}`,
        description: data?.message ?? '',
        variant: data?.ok ? 'default' : 'destructive',
      });
      return data;
    } catch (e: any) {
      toast({ title: 'Action error', description: e?.message ?? String(e), variant: 'destructive' });
      return { ok: false, message: e?.message };
    } finally {
      setRunning(null);
    }
  };
  return { dispatch, running };
}

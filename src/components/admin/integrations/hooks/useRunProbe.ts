import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useRunProbe() {
  const [running, setRunning] = useState<string | null>(null);
  const { toast } = useToast();

  const run = async (integration_key: string) => {
    setRunning(integration_key);
    try {
      const { data, error } = await supabase.functions.invoke('admin-integration-probe', {
        body: { integration_key },
      });
      if (error) throw error;
      const ok = data?.status === 'healthy' || data?.status === 'idle';
      toast({
        title: ok ? `Test passed: ${integration_key}` : `Test failed: ${integration_key}`,
        description: data?.message ?? '',
        variant: ok ? 'default' : 'destructive',
      });
      return data;
    } catch (e: any) {
      toast({ title: 'Probe error', description: e?.message ?? String(e), variant: 'destructive' });
      return { status: 'failed', message: e?.message };
    } finally {
      setRunning(null);
    }
  };
  return { run, running };
}

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useUpdateSecret() {
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  const save = async (secret_name: string, secret_value: string) => {
    setSaving(secret_name);
    try {
      const { data, error } = await supabase.functions.invoke('admin-update-secret', {
        body: { secret_name, secret_value },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast({ title: `Could not update ${secret_name}`, description: data?.message ?? '', variant: 'destructive' });
        return false;
      }
      toast({ title: `Saved ${secret_name}`, description: data?.message ?? 'Secret updated.' });
      return true;
    } catch (e: any) {
      toast({ title: 'Update failed', description: e?.message ?? String(e), variant: 'destructive' });
      return false;
    } finally {
      setSaving(null);
    }
  };
  return { save, saving };
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';

export interface DailyDigest {
  id: string;
  user_id: string;
  digest_date: string;
  urgency_level: 'calm' | 'attention' | 'urgent';
  headline: string;
  subline: string | null;
  narrative: string;
  top_priority: any;
  meetings: any;
  commitments: any;
  client_signals: any;
  counts: any;
  full_brief_md: string | null;
  dismissed_at: string | null;
  created_at: string;
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useDailyDigest(dateISO?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const date = dateISO || todayLocalISO();

  const query = useQuery({
    queryKey: ['daily_digest', user?.id, date],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_digests' as any)
        .select('*')
        .eq('user_id', user!.id)
        .eq('digest_date', date)
        .maybeSingle();
      return (data as unknown as DailyDigest) || null;
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      await supabase.functions.invoke('generate-daily-digest', {
        body: { user_id: user?.id, digest_date: date },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily_digest', user?.id, date] }),
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      if (!query.data) return;
      await supabase
        .from('daily_digests' as any)
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', query.data.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily_digest', user?.id, date] }),
  });

  return { ...query, refresh: refresh.mutate, refreshing: refresh.isPending, dismiss: dismiss.mutate };
}

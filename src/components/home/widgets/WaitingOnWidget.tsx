import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface Props { limit: number; }

function daysSince(iso?: string) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)));
}

export function WaitingOnWidget({ limit }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:waiting_on', user?.id, limit],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('follow_up_trackers' as any)
        .select('id, subject, counterparty_name, counterparty_email, last_activity_at, status, silence_baseline_days')
        .eq('user_id', user!.id)
        .eq('status', 'waiting')
        .order('last_activity_at', { ascending: true })
        .limit(limit);
      return (data as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground px-1 py-4 text-center">Nothing stalled. Threads are moving.</p>;

  return (
    <ul className="space-y-2">
      {data.map((r: any) => {
        const n = daysSince(r.last_activity_at);
        const unusual = r.silence_baseline_days && n > r.silence_baseline_days;
        return (
          <li key={r.id} className="flex items-center gap-2 text-sm">
            <div className="flex-1 min-w-0">
              <div className="text-foreground truncate">{r.subject} <span className="text-muted-foreground">· {r.counterparty_name || r.counterparty_email}</span></div>
              <div className="text-xs text-muted-foreground">quiet {n} day{n === 1 ? '' : 's'}{unusual && ' · unusual'}</div>
            </div>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs">Follow up</Button>
          </li>
        );
      })}
    </ul>
  );
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface Props { limit: number; }

export function CommitmentsWidget({ limit }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:commitments', user?.id, limit],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('follow_up_trackers' as any)
        .select('id, subject, counterparty_name, counterparty_email, direction, status, due_at')
        .eq('user_id', user!.id)
        .neq('status', 'completed')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(limit * 2);
      const rows = (data as any[]) || [];
      return {
        owe: rows.filter(r => r.direction === 'owed').slice(0, limit),
        owedToMe: rows.filter(r => r.direction !== 'owed').slice(0, limit),
      };
    },
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data || (!data.owe.length && !data.owedToMe.length))
    return <p className="text-sm text-muted-foreground px-1 py-4 text-center">No open commitments. Well played.</p>;

  return (
    <div className="space-y-3">
      {data.owe.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-1">You owe</div>
          <ul className="space-y-1">
            {data.owe.map((r: any) => (
              <li key={r.id} className="text-sm text-foreground truncate">{r.subject} <span className="text-muted-foreground">· {r.counterparty_name || r.counterparty_email}</span></li>
            ))}
          </ul>
        </div>
      )}
      {data.owedToMe.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-1">Owed to you</div>
          <ul className="space-y-1">
            {data.owedToMe.map((r: any) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate text-foreground">{r.subject} <span className="text-muted-foreground">· {r.counterparty_name || r.counterparty_email}</span></span>
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs">Nudge</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface Props { limit: number; }

function recipientLabel(to: any): string {
  try {
    const arr = Array.isArray(to) ? to : [];
    const first = arr[0];
    if (!first) return '';
    if (typeof first === 'string') return first;
    return first.name || first.address || first.email || '';
  } catch { return ''; }
}

export function CommitmentsWidget({ limit }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:commitments', user?.id, limit],
    enabled: !!user?.id,
    queryFn: async () => {
      // "You owe" — helm items flagged as commitments/tasks
      const owePromise = supabase
        .from('helm_items')
        .select('id, title, sender_name, sender_email, due_at, tier')
        .eq('user_id', user!.id)
        .eq('status', 'open')
        .in('tier', ['big3', 'decision'])
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(limit);

      // "Owed to you" — flagged emails you sent that haven't been replied to
      const owedPromise = supabase
        .from('follow_up_trackers')
        .select('id, subject, to_recipients, due_at, sent_at, status, replied_at')
        .eq('user_id', user!.id)
        .is('replied_at', null)
        .not('status', 'in', '(completed,cancelled,replied)')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(limit);

      const [{ data: owe, error: e1 }, { data: owed, error: e2 }] = await Promise.all([owePromise, owedPromise]);
      if (e1) console.warn('[CommitmentsWidget owe]', e1);
      if (e2) console.warn('[CommitmentsWidget owed]', e2);

      return {
        owe: (owe as any[]) || [],
        owedToMe: (owed as any[]) || [],
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
              <li key={r.id} className="text-sm text-foreground truncate">
                {r.title}
                {(r.sender_name || r.sender_email) && (
                  <span className="text-muted-foreground"> · {r.sender_name || r.sender_email}</span>
                )}
              </li>
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
                <span className="flex-1 min-w-0 truncate text-foreground">
                  {r.subject || '(no subject)'}
                  {recipientLabel(r.to_recipients) && (
                    <span className="text-muted-foreground"> · {recipientLabel(r.to_recipients)}</span>
                  )}
                </span>
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs">Nudge</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';

interface Props { limit: number; }

function daysSince(iso?: string) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)));
}

function recipientLabel(to: any): string {
  try {
    const arr = Array.isArray(to) ? to : [];
    const first = arr[0];
    if (!first) return '';
    if (typeof first === 'string') return first;
    return first.name || first.address || first.email || '';
  } catch { return ''; }
}

export function WaitingOnWidget({ limit }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:waiting_on', user?.id, limit],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('follow_up_trackers')
        .select('id, subject, to_recipients, sent_at, due_at, status, replied_at, reminder_count')
        .eq('user_id', user!.id)
        .is('replied_at', null)
        .not('status', 'in', '(completed,cancelled,replied)')
        .order('sent_at', { ascending: true })
        .limit(limit);
      if (error) console.warn('[WaitingOnWidget]', error);
      return (data as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground px-1 py-4 text-center">Nothing stalled. Threads are moving.</p>;

  return (
    <ul className="space-y-2">
      {data.map((r: any) => {
        const n = daysSince(r.sent_at);
        const overdue = r.due_at && new Date(r.due_at).getTime() < Date.now();
        return (
          <li key={r.id} className="flex items-center gap-2 text-sm">
            <div className="flex-1 min-w-0">
              <div className="text-foreground truncate">
                {r.subject || '(no subject)'}
                {recipientLabel(r.to_recipients) && (
                  <span className="text-muted-foreground"> · {recipientLabel(r.to_recipients)}</span>
                )}
              </div>
              <div className={`text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                {n === 0 ? 'sent today' : `${n}d silent`}
                {overdue && ' · overdue'}
                {r.reminder_count > 0 && ` · ${r.reminder_count} reminder${r.reminder_count > 1 ? 's' : ''}`}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';

interface Props { limit: number; }

function fmtTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function durationMin(a?: string, b?: string) {
  if (!a || !b) return '';
  return `${Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))} min`;
}

export function TodayWidget({ limit }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:today', user?.id, limit],
    enabled: !!user?.id,
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const { data } = await supabase.functions.invoke('calendar-events', {
        body: { start_date: start.toISOString(), end_date: end.toISOString() },
      });
      const evts = (data?.events || []) as any[];
      return evts.slice(0, limit);
    },
  });

  if (isLoading) return <div className="space-y-2">{Array.from({ length: limit }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (!data?.length) return <p className="text-sm text-muted-foreground px-1 py-4 text-center">No meetings today. Enjoy the space.</p>;

  const now = Date.now();
  const nextIdx = data.findIndex((e: any) => new Date(e.end?.dateTime || e.end || 0).getTime() >= now);

  return (
    <ul className="space-y-3">
      {data.map((e: any, i: number) => {
        const start = e.start?.dateTime || e.start;
        const end = e.end?.dateTime || e.end;
        const isNext = i === nextIdx;
        const moved = e.originalStart && e.originalStart !== start;
        const prep = e.ai_prep_note || e.prepNote || '';
        return (
          <li key={e.id || i} className="flex gap-3">
            <div className="flex flex-col items-center pt-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${isNext ? 'bg-primary' : 'border border-border bg-background'}`} />
              {i < data.length - 1 && <span className="w-px flex-1 bg-border mt-1" />}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="text-xs text-muted-foreground">
                {fmtTime(start)} · {durationMin(start, end)}
                {moved && <span className="text-destructive"> · moved</span>}
              </div>
              <div className="text-sm font-medium text-foreground truncate">{e.subject || e.title || '(untitled)'}</div>
              {prep && <div className="text-xs text-muted-foreground truncate">{prep}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

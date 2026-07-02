import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

function initials(name?: string | null) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

const TINTS = ['bg-primary/10 text-primary', 'bg-accent/20 text-foreground', 'bg-muted text-foreground'];

interface Props { limit: number; }

export function NeedsReplyWidget({ limit }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:needs_reply', user?.id, limit],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('tracked_emails' as any)
        .select('id, sender_name, sender_email, subject, priority_score, status, ai_draft_content, received_at')
        .eq('user_id', user!.id)
        .in('status', ['pending', 'awaiting_reply', 'needs_reply', 'flagged'])
        .order('priority_score', { ascending: false, nullsFirst: false })
        .order('received_at', { ascending: false })
        .limit(limit);
      return (data as any[]) || [];
    },
  });

  if (isLoading) return <div className="space-y-2">{Array.from({ length: limit }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (!data?.length) return <p className="text-sm text-muted-foreground px-1 py-4 text-center">Nothing waiting on you — inbox is clear.</p>;

  return (
    <ul className="divide-y divide-border/60">
      {data.map((row, i) => {
        const tint = TINTS[i % TINTS.length];
        const isUrgent = (row.priority_score ?? 0) >= 80;
        return (
          <li key={row.id} className="flex items-center gap-3 py-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className={tint}>{initials(row.sender_name || row.sender_email)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-foreground truncate">
                <span className="font-medium">{row.sender_name || row.sender_email}</span>
                <span className="text-muted-foreground"> · {row.subject}</span>
              </div>
              {row.ai_draft_content && (
                <div className="text-xs text-primary">Draft ready</div>
              )}
            </div>
            {isUrgent && <Badge variant="destructive" className="text-[10px]">urgent</Badge>}
          </li>
        );
      })}
    </ul>
  );
}

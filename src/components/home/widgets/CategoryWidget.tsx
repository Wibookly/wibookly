import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface Props { categoryId: string; limit: number; }

export function CategoryWidget({ categoryId, limit }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:category', user?.id, categoryId, limit],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('tracked_emails' as any)
        .select('id, subject, sender_name, sender_email, received_at')
        .eq('user_id', user!.id)
        .eq('category_id', categoryId)
        .order('received_at', { ascending: false })
        .limit(limit);
      return (data as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground px-1 py-4 text-center">Nothing new here today.</p>;

  return (
    <ul className="space-y-1.5">
      {data.map((r) => (
        <li key={r.id} className="text-sm text-foreground truncate">
          {r.subject} <span className="text-muted-foreground">· {r.sender_name || r.sender_email}</span>
        </li>
      ))}
      <li className="pt-1"><Badge variant="outline" className="text-[10px]">category</Badge></li>
    </ul>
  );
}

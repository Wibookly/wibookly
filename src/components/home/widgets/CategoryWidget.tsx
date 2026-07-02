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
      // helm_items keeps category reference inside payload JSON
      const { data, error } = await supabase
        .from('helm_items')
        .select('id, title, sender_name, sender_email, created_at, payload, action_key')
        .eq('user_id', user!.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) console.warn('[CategoryWidget]', error);
      const rows = ((data as any[]) || []).filter((r) => {
        const cid = r?.payload?.category_id || r?.payload?.categoryId || r?.action_key;
        return cid === categoryId;
      });
      return rows.slice(0, limit);
    },
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground px-1 py-4 text-center">Nothing new here today.</p>;

  return (
    <ul className="space-y-1.5">
      {data.map((r) => (
        <li key={r.id} className="text-sm text-foreground truncate">
          {r.title} <span className="text-muted-foreground">· {r.sender_name || r.sender_email}</span>
        </li>
      ))}
      <li className="pt-1"><Badge variant="outline" className="text-[10px]">category</Badge></li>
    </ul>
  );
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';

interface CategoryStat {
  id: string;
  name: string;
  color: string | null;
  total: number;
  unread: number;
}

export function CategoryStatsHeader() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home:category-stats', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<CategoryStat[]> => {
      const { data: cats } = await supabase
        .from('categories')
        .select('id, name, color')
        .eq('is_enabled', true);
      if (!cats?.length) return [];

      const results = await Promise.all(
        cats.map(async (c: any) => {
          const [{ count: total }, { count: unread }] = await Promise.all([
            supabase
              .from('tracked_emails' as any)
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user!.id)
              .eq('category_id', c.id),
            supabase
              .from('tracked_emails' as any)
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user!.id)
              .eq('category_id', c.id)
              .in('status', ['pending', 'awaiting_reply', 'needs_reply', 'flagged']),
          ]);
          return {
            id: c.id,
            name: c.name,
            color: c.color,
            total: total ?? 0,
            unread: unread ?? 0,
          };
        })
      );
      return results.sort((a, b) => b.total - a.total);
    },
  });

  const grandTotal = (data ?? []).reduce((s, c) => s + c.total, 0);
  const grandUnread = (data ?? []).reduce((s, c) => s + c.unread, 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
            Inbox overview
          </div>
          <h2 className="text-2xl font-semibold text-foreground">Emails by category</h2>
        </div>
        <div className="flex items-baseline gap-6">
          <div>
            <div className="text-2xl font-semibold text-foreground">{grandTotal.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total tracked</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-primary">{grandUnread.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Need attention</div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No categories yet. <Link to="/categories" className="text-primary hover:underline">Create one</Link>.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {data.map((c) => (
            <Link
              key={c.id}
              to={`/flagged-email-tracker?category=${c.id}`}
              className="group rounded-xl border border-border bg-background/50 hover:bg-accent/30 hover:border-primary/40 transition p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ background: c.color || 'hsl(var(--primary))' }}
                />
                <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold text-foreground">{c.total.toLocaleString()}</span>
                {c.unread > 0 && (
                  <span className="text-xs text-primary font-medium">{c.unread} new</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

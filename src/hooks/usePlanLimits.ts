import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

const SUPER_ADMIN_EMAIL = 'arahimi@energyforward.com';

export interface PlanLimits {
  maxCategories: number; // 0 = unlimited
  loading: boolean;
}

/**
 * Reads the highest `max_categories` across the user's permission group
 * memberships. Super admin gets unlimited (0). When the user has no plan
 * assignment we default to 10 (the previous implicit ceiling).
 */
export function usePlanLimits(): PlanLimits {
  const { user, profile } = useAuth();
  const [maxCategories, setMaxCategories] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) {
        if (!cancelled) {
          setMaxCategories(10);
          setLoading(false);
        }
        return;
      }
      if (profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL) {
        if (!cancelled) {
          setMaxCategories(0); // unlimited
          setLoading(false);
        }
        return;
      }
      try {
        const { data, error } = await supabase
          .from('user_group_memberships')
          .select('permission_groups(max_categories)')
          .eq('user_id', user.id);
        if (error) throw error;
        const values = (data ?? [])
          .map((row: any) => Number(row?.permission_groups?.max_categories ?? 0))
          .filter((n) => Number.isFinite(n) && n > 0);
        const max = values.length > 0 ? Math.max(...values) : 10;
        if (!cancelled) setMaxCategories(max);
      } catch (e) {
        console.error('usePlanLimits failed:', e);
        if (!cancelled) setMaxCategories(10);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, profile?.email]);

  return { maxCategories, loading };
}

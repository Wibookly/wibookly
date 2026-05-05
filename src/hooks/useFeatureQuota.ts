import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export interface FeatureQuota {
  allowed: boolean;
  reason: string | null;
  feature_enabled: boolean;
  daily_count_remaining: number;
  user_daily_remaining: number;
  user_monthly_remaining: number;
  org_daily_remaining: number;
  model: string | null;
}

/**
 * Calls enforce_llm_limits with $0 estimated cost so we can surface the
 * user's remaining quota for a feature without consuming any. Refetches
 * every 30s and on focus so the badge stays roughly live.
 */
export function useFeatureQuota(featureKey: string) {
  const { user, organization } = useAuth();

  return useQuery<FeatureQuota | null>({
    queryKey: ['feature-quota', featureKey, user?.id, organization?.id],
    enabled: !!user?.id && !!organization?.id,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enforce_llm_limits', {
        _user_id: user!.id,
        _organization_id: organization!.id,
        _feature_key: featureKey,
        _est_cost_usd: 0,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      return {
        allowed: !!row.allowed,
        reason: row.reason ?? null,
        feature_enabled: !!row.feature_enabled,
        daily_count_remaining: Number(row.daily_count_remaining ?? 0),
        user_daily_remaining: Number(row.user_daily_remaining ?? 0),
        user_monthly_remaining: Number(row.user_monthly_remaining ?? 0),
        org_daily_remaining: Number(row.org_daily_remaining ?? 0),
        model: row.model ?? null,
      };
    },
  });
}

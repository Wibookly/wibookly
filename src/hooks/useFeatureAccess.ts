import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type FeatureKey =
  | 'ai_draft'
  | 'ai_auto_reply'
  | 'ai_assistant'
  | 'reports'
  | 'ai_model_chatgpt'
  | 'ai_model_claude';

const ALL_FEATURES: FeatureKey[] = [
  'ai_draft',
  'ai_auto_reply',
  'ai_assistant',
  'reports',
  'ai_model_chatgpt',
  'ai_model_claude',
];

const SUPER_ADMIN_EMAIL = 'arahimi@energyforward.com';

interface FeatureAccessState {
  features: Record<string, boolean>;
  loading: boolean;
}

/**
 * Resolve which features the current user has access to.
 *
 * Mirrors the `public.has_feature(_user_id, _feature_key)` SQL function:
 *   1. Direct per-user grant in `user_feature_access`
 *   2. Per-domain override on a group the user belongs to
 *      (`group_feature_overrides` for the user's domain)
 *   3. Plain group feature (`group_features`) — only when no override exists
 *      for this user's domain on that group
 *   4. Super-admin bypass (always true)
 */
export function useFeatureAccess() {
  const { user } = useAuth();
  const [state, setState] = useState<FeatureAccessState>({ features: {}, loading: true });

  const fetchFeatures = useCallback(async () => {
    if (!user?.id) {
      setState({ features: {}, loading: false });
      return;
    }

    try {
      // Super-admin bypass — everything on.
      if (user.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
        const all: Record<string, boolean> = {};
        ALL_FEATURES.forEach((k) => (all[k] = true));
        setState({ features: all, loading: false });
        return;
      }

      // Resolve the user's domain (needed for per-domain overrides).
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('domain_id')
        .eq('user_id', user.id)
        .maybeSingle();
      const userDomainId = profile?.domain_id ?? null;

      // 1. Direct per-user grants
      const { data: directRows } = await supabase
        .from('user_feature_access')
        .select('feature_key, is_enabled')
        .eq('user_id', user.id);

      const direct = new Map<string, boolean>();
      (directRows || []).forEach((r) => direct.set(r.feature_key, r.is_enabled));

      // 2/3. Group memberships → group features + per-domain overrides
      const { data: memberships } = await supabase
        .from('user_group_memberships')
        .select('group_id')
        .eq('user_id', user.id);

      const groupIds = (memberships || []).map((m) => m.group_id);

      const groupFeatures: { group_id: string; feature_key: string; is_enabled: boolean }[] = [];
      const overrides: { group_id: string; feature_key: string; is_enabled: boolean }[] = [];

      if (groupIds.length > 0) {
        const [{ data: gfRows }, { data: ovRows }] = await Promise.all([
          supabase
            .from('group_features')
            .select('group_id, feature_key, is_enabled')
            .in('group_id', groupIds),
          userDomainId
            ? supabase
                .from('group_feature_overrides')
                .select('group_id, feature_key, is_enabled')
                .in('group_id', groupIds)
                .eq('domain_id', userDomainId)
            : Promise.resolve({ data: [] as any[] }),
        ]);
        groupFeatures.push(...((gfRows || []) as any));
        overrides.push(...((ovRows || []) as any));
      }

      // Build override lookup: groupId|featureKey -> bool
      const overrideMap = new Map<string, boolean>();
      overrides.forEach((o) => overrideMap.set(`${o.group_id}|${o.feature_key}`, o.is_enabled));

      // For each feature: determine effective access using the precedence above.
      const features: Record<string, boolean> = {};
      for (const key of ALL_FEATURES) {
        // 1. Direct per-user grant wins when enabled.
        if (direct.get(key) === true) {
          features[key] = true;
          continue;
        }

        let granted = false;
        for (const gid of groupIds) {
          const overrideKey = `${gid}|${key}`;
          if (overrideMap.has(overrideKey)) {
            // 2. Per-domain override replaces the group default for this user's domain.
            if (overrideMap.get(overrideKey) === true) {
              granted = true;
              break;
            }
            // explicit override = false → ignore this group's plain feature
            continue;
          }
          // 3. Plain group feature (no override for this domain).
          const gf = groupFeatures.find(
            (f) => f.group_id === gid && f.feature_key === key && f.is_enabled,
          );
          if (gf) {
            granted = true;
            break;
          }
        }
        features[key] = granted;
      }

      setState({ features, loading: false });
    } catch (error) {
      console.error('Error fetching feature access:', error);
      setState({ features: {}, loading: false });
    }
  }, [user?.id, user?.email]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const hasFeature = useCallback(
    (key: FeatureKey): boolean => {
      return state.features[key] === true;
    },
    [state.features],
  );

  return { hasFeature, loading: state.loading, refreshFeatures: fetchFeatures };
}

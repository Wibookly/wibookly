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

      const featureResults = await Promise.all(
        ALL_FEATURES.map(async (key) => {
          const { data, error } = await supabase.rpc('has_feature', {
            _user_id: user.id,
            _feature_key: key,
          });

          if (error) {
            throw error;
          }

          return [key, data === true] as const;
        }),
      );

      const features = Object.fromEntries(featureResults);

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

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type FeatureKey = 'ai_draft' | 'ai_auto_reply' | 'ai_assistant' | 'reports' | 'ai_model_chatgpt' | 'ai_model_claude';

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
      const { data, error } = await supabase
        .from('user_feature_access')
        .select('feature_key, is_enabled')
        .eq('user_id', user.id);

      if (error) throw error;

      const features: Record<string, boolean> = {};
      (data || []).forEach((row) => {
        features[row.feature_key] = row.is_enabled;
      });

      setState({ features, loading: false });
    } catch (error) {
      console.error('Error fetching feature access:', error);
      setState({ features: {}, loading: false });
    }
  }, [user?.id]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const hasFeature = useCallback((key: FeatureKey): boolean => {
    return state.features[key] === true;
  }, [state.features]);

  return { hasFeature, loading: state.loading, refreshFeatures: fetchFeatures };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type FeatureKey =
  | 'ai_draft'
  | 'ai_auto_reply'
  | 'ai_assistant'
  | 'ai_chat'
  | 'ai_chat_web_search'
  | 'daily_brief'
  | 'reports'
  | 'ai_model_chatgpt'
  | 'ai_model_claude'
  | 'email_agent'
  | 'teams_agent'
  | 'meeting_copilot'
  | 'email_intelligence'
  | 'feature.follow_up_reminder';

const ALL_FEATURES: FeatureKey[] = [
  'ai_draft',
  'ai_auto_reply',
  'ai_assistant',
  'ai_chat',
  'ai_chat_web_search',
  'daily_brief',
  'reports',
  'ai_model_chatgpt',
  'ai_model_claude',
  'email_agent',
  'teams_agent',
  'meeting_copilot',
  'email_intelligence',
  'feature.follow_up_reminder',
];

const SUPER_ADMIN_EMAIL = 'arahimi@energyforward.com';

interface FeatureAccessState {
  features: Record<string, boolean>;
  loading: boolean;
}

export function useFeatureAccess() {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<FeatureAccessState>({ features: {}, loading: true });
  const lastFetchRef = useRef<number>(0);
  const loadedUserIdRef = useRef<string | null>(null);

  const fetchFeatures = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!user?.id) {
      loadedUserIdRef.current = null;
      lastFetchRef.current = 0;
      setState({ features: {}, loading: false });
      return;
    }

    const isNewUser = loadedUserIdRef.current !== user.id;
    if (isNewUser || lastFetchRef.current === 0) {
      setState((prev) => ({ features: isNewUser ? {} : prev.features, loading: true }));
    }

    try {
      // Super-admin bypass — everything on.
      if (user.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
        const all: Record<string, boolean> = {};
        ALL_FEATURES.forEach((k) => (all[k] = true));
        setState({ features: all, loading: false });
        loadedUserIdRef.current = user.id;
        lastFetchRef.current = Date.now();
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
      loadedUserIdRef.current = user.id;
      lastFetchRef.current = Date.now();
    } catch (error) {
      console.error('Error fetching feature access:', error);
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [authLoading, user?.id, user?.email]);

  useEffect(() => {
    if (authLoading) return;

    fetchFeatures();

    if (!user?.id) return;

    const maybeRefresh = () => {
      // Throttle: don't refetch more than once every 5 seconds.
      if (Date.now() - lastFetchRef.current < 5000) return;
      fetchFeatures();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };

    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', onVisibility);

    // Safety-net poll while the tab stays open.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchFeatures();
    }, 60_000);

    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [authLoading, user?.id, fetchFeatures]);

  const hasFeature = useCallback(
    (key: FeatureKey): boolean => {
      return state.features[key] === true;
    },
    [state.features],
  );

  return { hasFeature, loading: authLoading || state.loading, refreshFeatures: fetchFeatures };
}

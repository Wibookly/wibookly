import { supabase } from '@/integrations/supabase/client';

interface LogAttemptParams {
  provider: string;
  stage: string;
  errorCode?: string;
  errorMessage?: string;
  meta?: Record<string, unknown>;
}

export function useConnectAttemptLogger() {
  const logAttempt = async (params: LogAttemptParams) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) return;

      // Get org ID from profile
      const { data: profileRows } = await supabase.rpc('get_my_profile');
      const orgId = profileRows?.[0]?.organization_id;
      if (!orgId) return;

      // Use direct insert since we have RLS policy for own records
      const { error } = await supabase.from('connect_attempts' as any).insert({
        user_id: userId,
        organization_id: orgId,
        provider: params.provider,
        stage: params.stage,
        error_code: params.errorCode || null,
        error_message: params.errorMessage || null,
        app_origin: window.location.origin,
        meta: params.meta || {},
      });

      if (error) {
        console.warn('Failed to log connect attempt:', error.message);
      }
    } catch (e) {
      console.warn('Connect attempt logging error:', e);
    }
  };

  return { logAttempt };
}

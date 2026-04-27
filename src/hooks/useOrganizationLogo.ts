import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Fetches the organization's logo_url. Returns null if none set.
 * Used to show per-company branding in the app shell + emails.
 */
export function useOrganizationLogo(organizationId?: string | null) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!organizationId) {
      setLogoUrl(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('organizations')
        .select('logo_url')
        .eq('id', organizationId)
        .maybeSingle();
      if (!cancelled) setLogoUrl((data as any)?.logo_url ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return logoUrl;
}

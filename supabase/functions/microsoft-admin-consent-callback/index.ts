import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    const adminConsent = url.searchParams.get('admin_consent');
    const tenantId = url.searchParams.get('tenant');
    const stateParam = url.searchParams.get('state');

    const state = parseState(stateParam);
    const appUrl = resolveAppUrl(state.appOrigin);

    if (!state.domainId) {
      return redirect(buildAdminRedirect(appUrl, 'error', 'Missing domain reference.'));
    }

    if (error) {
      return redirect(buildAdminRedirect(appUrl, 'error', errorDescription || error, state.domainId));
    }

    if (adminConsent !== 'True') {
      return redirect(buildAdminRedirect(appUrl, 'error', 'Microsoft consent was not completed.', state.domainId));
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return redirect(buildAdminRedirect(appUrl, 'error', 'Backend configuration is incomplete.', state.domainId));
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const update: Record<string, string> = {
      microsoft_consent_granted_at: new Date().toISOString(),
    };

    if (tenantId) {
      update.microsoft_tenant_id = tenantId;
    }

    const { error: updateError } = await adminClient
      .from('allowed_domains')
      .update({
        microsoft_consent_granted: true,
        ...update,
      })
      .eq('id', state.domainId);

    if (updateError) {
      console.error('Failed to persist Microsoft admin consent', updateError);
      return redirect(buildAdminRedirect(appUrl, 'error', 'Failed to save Microsoft consent.', state.domainId));
    }

    return redirect(buildAdminRedirect(appUrl, 'success', 'Tenant authorization recorded.', state.domainId));
  } catch (error) {
    console.error('Microsoft admin consent callback error', error);
    const fallbackUrl = getFallbackAppUrl();
    return redirect(buildAdminRedirect(fallbackUrl, 'error', 'Unexpected Microsoft consent error.'));
  }
});

function buildAdminRedirect(appUrl: string, status: 'success' | 'error', message: string, domainId?: string): string {
  const params = new URLSearchParams({
    tab: 'discovered',
    ms_consent: status,
    message,
  });

  if (domainId) {
    params.set('domain_id', domainId);
    if (status === 'success') {
      params.set('auto_sync', '1');
      params.set('run_check', '1');
    }
  }

  return `${appUrl}/admin?${params.toString()}`;
}

function parseState(stateParam: string | null): { domainId?: string; appOrigin?: string } {
  if (!stateParam) return {};

  try {
    const parsed = JSON.parse(atob(stateParam));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getFallbackAppUrl(): string {
  return 'https://energyforwardai.lovable.app';
}

function resolveAppUrl(appOrigin?: unknown): string {
  const fallback = getFallbackAppUrl();

  if (typeof appOrigin !== 'string' || !appOrigin) return fallback;

  try {
    const url = new URL(appOrigin);
    const host = url.hostname.toLowerCase();
    const isLovable = host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com');
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const isCustomDomain = host === 'inboxiq.energyforward.com';

    if (!isLovable && !isLocal && !isCustomDomain) return fallback;
    if (url.protocol !== 'https:' && !isLocal) return fallback;

    return url.origin;
  } catch {
    return fallback;
  }
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}
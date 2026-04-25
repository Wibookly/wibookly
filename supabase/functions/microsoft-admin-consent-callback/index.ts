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
      return renderResult(appUrl, 'error', 'Missing domain reference.');
    }

    if (error) {
      return renderResult(appUrl, 'error', errorDescription || error, state.domainId);
    }

    if (adminConsent !== 'True') {
      return renderResult(appUrl, 'error', 'Microsoft consent was not completed.', state.domainId);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return renderResult(appUrl, 'error', 'Backend configuration is incomplete.', state.domainId);
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
      return renderResult(appUrl, 'error', 'Failed to save Microsoft consent.', state.domainId);
    }

    return renderResult(appUrl, 'success', 'Tenant authorization recorded.', state.domainId);
  } catch (error) {
    console.error('Microsoft admin consent callback error', error);
    const fallbackUrl = getFallbackAppUrl();
    return renderResult(fallbackUrl, 'error', 'Unexpected Microsoft consent error.');
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

/**
 * Render an HTML page that:
 *  - If opened as a popup: posts a message to the opener and closes itself.
 *    The opener will pick up the result and refresh the dashboard.
 *  - Otherwise: redirects the current tab to /admin?tab=discovered with the result.
 */
function renderResult(appUrl: string, status: 'success' | 'error', message: string, domainId?: string): Response {
  const fallback = buildAdminRedirect(appUrl, status, message, domainId);
  const payload = JSON.stringify({
    type: 'ms-admin-consent-result',
    status,
    message,
    domainId: domainId || null,
  });

  const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Microsoft consent</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; text-align: center; color: #1f2937; }
  .ok { color: #059669; }
  .err { color: #dc2626; }
</style>
</head>
<body>
  <h2 class="${status === 'success' ? 'ok' : 'err'}">
    ${status === 'success' ? '✓ Microsoft consent granted' : '⚠ Microsoft consent failed'}
  </h2>
  <p>${safeMessage}</p>
  <p id="closing">You can close this window.</p>
  <script>
    (function () {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(${payload}, '*');
          setTimeout(function () { window.close(); }, 400);
          return;
        }
      } catch (e) { /* ignore cross-origin issues */ }
      // Not a popup — fall back to a full redirect into the dashboard.
      window.location.replace(${JSON.stringify(fallback)});
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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

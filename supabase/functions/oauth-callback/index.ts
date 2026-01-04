import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AES-GCM encryption for tokens
async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(token)
  );
  
  // Combine IV and encrypted data, encode as base64
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    console.log('OAuth callback received');

    // Try to extract provider from state early for better error reporting
    let earlyProvider: string | undefined;
    let earlyAppUrl: string | undefined;
    if (stateParam) {
      try {
        const earlyState = JSON.parse(atob(stateParam));
        earlyProvider = earlyState.provider;
        earlyAppUrl = resolveAppUrl(earlyState.appOrigin);
      } catch {}
    }

    // Handle OAuth errors
    if (error) {
      console.error(`OAuth error: ${error} - ${errorDescription}`);
      return redirectWithError(`OAuth failed: ${errorDescription || error}`, earlyAppUrl, earlyProvider);
    }

    if (!code || !stateParam) {
      console.error('Missing code or state parameter');
      return redirectWithError('Missing authorization code or state', earlyAppUrl, earlyProvider);
    }

    // Decode state
    let stateData;
    try {
      stateData = JSON.parse(atob(stateParam));
    } catch (e) {
      console.error('Failed to decode state:', e);
      return redirectWithError('Invalid state parameter');
    }

    const { userId, organizationId, provider, redirectUrl, appOrigin } = stateData;
    console.log(`Processing OAuth callback for provider: ${provider}, userId: ${userId}`);

    const resolvedAppUrl = resolveAppUrl(appOrigin);
    console.log('Redirect target (sanitized):', { appOrigin, resolvedAppUrl, redirectUrl });

    // Get Supabase client with service role for database operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

    if (!encryptionKey) {
      console.error('TOKEN_ENCRYPTION_KEY not configured');
      return redirectWithError('Server configuration error', resolvedAppUrl, provider);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Log this callback attempt
    await logConnectAttempt(supabase, userId, organizationId, provider, 'callback_received', appOrigin);

    let tokens;

    if (provider === 'google') {
      tokens = await exchangeGoogleCode(code, supabaseUrl);
    } else if (provider === 'outlook') {
      tokens = await exchangeMicrosoftCode(code, supabaseUrl);
    } else {
      await logConnectAttempt(supabase, userId, organizationId, provider, 'callback_error', appOrigin, 'unsupported_provider');
      return redirectWithError(`Unsupported provider: ${provider}`, resolvedAppUrl, provider);
    }

    if (!tokens) {
      await logConnectAttempt(supabase, userId, organizationId, provider, 'callback_error', appOrigin, 'token_exchange_failed');
      return redirectWithError('Failed to exchange authorization code', resolvedAppUrl, provider);
    }

    console.log(`Successfully obtained tokens for ${provider}`);

    // Encrypt tokens before storing
    const encryptedAccessToken = await encryptToken(tokens.access_token, encryptionKey);
    const encryptedRefreshToken = tokens.refresh_token
      ? await encryptToken(tokens.refresh_token, encryptionKey)
      : null;

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Store encrypted tokens in the vault (not readable by clients)
    const { error: vaultError } = await supabase
      .from('oauth_token_vault')
      .upsert(
        {
          user_id: userId,
          provider: provider,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,provider',
        }
      );

    if (vaultError) {
      console.error('Token vault error:', vaultError);
      await logConnectAttempt(supabase, userId, organizationId, provider, 'callback_error', appOrigin, 'vault_save_failed');
      return redirectWithError('Failed to save tokens securely', resolvedAppUrl, provider);
    }

    // Update provider_connections with status only (NO TOKENS)
    const { error: dbError } = await supabase
      .from('provider_connections')
      .upsert(
        {
          user_id: userId,
          organization_id: organizationId,
          provider: provider,
          is_connected: true,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,provider',
        }
      );

    if (dbError) {
      console.error('Database error:', dbError);
      await logConnectAttempt(supabase, userId, organizationId, provider, 'callback_error', appOrigin, 'connection_save_failed');
      return redirectWithError('Failed to save connection', resolvedAppUrl, provider);
    }

    console.log(`Connection saved for ${provider} (tokens encrypted in vault)`);
    await logConnectAttempt(supabase, userId, organizationId, provider, 'callback_success', appOrigin);

    // Redirect back to the app
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${resolvedAppUrl}${redirectUrl || '/integrations'}?connected=${provider}`,
      },
    });

  } catch (error: unknown) {
    console.error('OAuth callback error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return redirectWithError(message);
  }
});

async function exchangeGoogleCode(code: string, supabaseUrl: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

  console.log('Exchanging Google authorization code');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google token exchange failed:', errorText);
    return null;
  }

  return await response.json();
}

async function exchangeMicrosoftCode(code: string, supabaseUrl: string) {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

  console.log('Exchanging Microsoft authorization code');

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Microsoft token exchange failed:', errorText);
    return null;
  }

  return await response.json();
}

function getAppUrl(): string {
  // Default app URL (fallback only)
  return 'https://jbzctydskdpzrejvpwpn.lovable.app';
}

function resolveAppUrl(appOrigin?: unknown): string {
  const fallback = getAppUrl();
  if (typeof appOrigin !== 'string' || !appOrigin) return fallback;

  try {
    const url = new URL(appOrigin);

    // Prevent open redirects: allow only Lovable preview domains.
    const host = url.hostname.toLowerCase();
    const isLovableDomain = host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com');
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';

    if (!isLovableDomain && !isLocalhost) return fallback;
    if (url.protocol !== 'https:' && !isLocalhost) return fallback;

    // Ensure we only keep the origin (no path/query)
    return url.origin;
  } catch {
    return fallback;
  }
}

// Log connect attempt to database (fire-and-forget, errors swallowed)
async function logConnectAttempt(
  supabase: any,
  userId: string,
  organizationId: string,
  provider: string,
  stage: string,
  appOrigin?: string,
  errorCode?: string,
  errorMessage?: string
): Promise<void> {
  try {
    await supabase.from('connect_attempts').insert({
      user_id: userId,
      organization_id: organizationId,
      provider,
      stage,
      error_code: errorCode || null,
      error_message: errorMessage || null,
      app_origin: appOrigin || null,
      meta: {},
    });
  } catch (e) {
    console.warn('Failed to log connect attempt:', e);
  }
}

function redirectWithError(message: string, appUrl?: string, provider?: string): Response {
  const resolved = appUrl || getAppUrl();
  const providerParam = provider ? `&provider=${encodeURIComponent(provider)}` : '';
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${resolved}/integrations?error=${encodeURIComponent(message)}${providerParam}`,
    },
  });
}

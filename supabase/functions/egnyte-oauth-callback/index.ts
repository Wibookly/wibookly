// Egnyte OAuth authorization-code callback. Exchanges the code for tokens,
// encrypts them with TOKEN_ENCRYPTION_KEY, and stores in egnyte_connections.
// Redirects the user back to the app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptToken } from "../_shared/egnyte-crypto.ts";

function htmlResponse(html: string, status = 200) {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function errorPage(msg: string) {
  return htmlResponse(`<!doctype html><meta charset="utf-8"><title>Egnyte connection failed</title>
<body style="font-family:system-ui;background:#0b0b12;color:#e5e7eb;padding:40px">
<h2>Could not finish Egnyte connection</h2>
<p style="color:#f87171">${msg.replace(/</g, '&lt;')}</p>
<p><a style="color:#60a5fa" href="/egnyte">Return to InboxIQ</a></p></body>`, 400);
}

function decodeState(state: string): { u: string; d: string; r: string } | null {
  try {
    const b64 = state.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) return errorPage(`Egnyte returned an error: ${oauthError}`);
    if (!code || !state) return errorPage('Missing code or state.');

    const parsed = decodeState(state);
    if (!parsed?.u || !parsed?.d) return errorPage('Invalid state.');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const CLIENT_ID = Deno.env.get('EGNYTE_CLIENT_ID')?.trim();
    const CLIENT_SECRET = Deno.env.get('EGNYTE_CLIENT_SECRET')?.trim();
    const ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY');
    if (!CLIENT_ID || !CLIENT_SECRET || !ENC_KEY) return errorPage('Server is missing Egnyte credentials.');

    const redirectUri = `${SUPABASE_URL}/functions/v1/egnyte-oauth-callback`;
    const tokenResp = await fetch(`https://${parsed.d}/puboauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      console.error('Egnyte token exchange failed', tokenResp.status, t);
      return errorPage(`Token exchange failed (${tokenResp.status}): ${t.slice(0, 300)}`);
    }
    const tok = await tokenResp.json();
    const accessToken: string = tok.access_token;
    const refreshToken: string | undefined = tok.refresh_token;
    const expiresIn: number = Number(tok.expires_in ?? 0);
    const scope: string | undefined = tok.token_type ? String(tok.scope ?? 'Egnyte.filesystem') : undefined;

    // Fetch username
    let username: string | null = null;
    try {
      const meResp = await fetch(`https://${parsed.d}/pubapi/v1/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (meResp.ok) {
        const me = await meResp.json();
        username = me?.username ?? me?.email ?? null;
      }
    } catch { /* non-fatal */ }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const encryptedAccess = await encryptToken(accessToken, ENC_KEY);
    const encryptedRefresh = refreshToken ? await encryptToken(refreshToken, ENC_KEY) : null;
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    const { error: upErr } = await admin.from('egnyte_connections').upsert({
      user_id: parsed.u,
      egnyte_domain: parsed.d,
      egnyte_username: username,
      encrypted_access_token: encryptedAccess,
      encrypted_refresh_token: encryptedRefresh,
      expires_at: expiresAt,
      scope: scope ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (upErr) { console.error('save egnyte conn failed', upErr); return errorPage('Could not save Egnyte connection.'); }

    const returnTo = parsed.r && parsed.r.startsWith('/') ? parsed.r : '/egnyte';
    // Origin — we redirect via a tiny HTML page since the app origin isn't known here.
    return htmlResponse(`<!doctype html><meta charset="utf-8"><title>Egnyte connected</title>
<script>
(function(){
  try {
    if (window.opener) { window.opener.postMessage({ type:'egnyte_connected' }, '*'); window.close(); return; }
  } catch(e){}
  location.replace(${JSON.stringify(returnTo)} + '?egnyte=connected');
})();
</script>
<body style="font-family:system-ui;background:#0b0b12;color:#e5e7eb;padding:40px">
<p>Egnyte connected. You can close this window.</p></body>`);
  } catch (e) {
    console.error('egnyte-oauth-callback error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return errorPage(msg);
  }
});

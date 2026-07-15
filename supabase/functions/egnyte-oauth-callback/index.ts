// egnyte-oauth-callback
// GET ?code=&state=  (public, no JWT — Egnyte redirects the user's browser here)
// Exchanges code for tokens, encrypts, updates tenant_integrations, redirects to app.
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

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    const oauthErrDesc = url.searchParams.get('error_description');

    if (!state) return errorPage('Missing state.');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const CLIENT_ID = Deno.env.get('EGNYTE_CLIENT_ID')?.trim();
    const CLIENT_SECRET = Deno.env.get('EGNYTE_CLIENT_SECRET')?.trim();
    const REDIRECT_URI = Deno.env.get('EGNYTE_REDIRECT_URI')?.trim()
      || `${SUPABASE_URL}/functions/v1/egnyte-oauth-callback`;
    const ENC_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY');
    if (!CLIENT_ID || !CLIENT_SECRET || !ENC_KEY) return errorPage('Server is missing Egnyte credentials.');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Consume state atomically
    const { data: stRow } = await admin.from('oauth_states')
      .select('*').eq('state', state).is('consumed_at', null).maybeSingle();
    if (!stRow) return errorPage('This authorization link has expired or was already used. Please try connecting again.');
    if (new Date(stRow.expires_at).getTime() < Date.now()) {
      await admin.from('oauth_states').update({ consumed_at: new Date().toISOString() }).eq('state', state);
      return errorPage('This authorization link has expired. Please try connecting again.');
    }
    await admin.from('oauth_states').update({ consumed_at: new Date().toISOString() }).eq('state', state);

    const orgId = stRow.organization_id as string;
    const subdomain = stRow.subdomain as string;
    const returnPath: string = (stRow.return_path as string) || '/egnyte';

    if (oauthError || !code) {
      const msg = oauthErrDesc || oauthError || 'Missing authorization code.';
      await admin.from('tenant_integrations').update({
        status: 'error',
        last_error: msg,
        updated_at: new Date().toISOString(),
      }).eq('organization_id', orgId).eq('integration_slug', 'egnyte');
      return errorPage(`Egnyte returned an error: ${msg}`);
    }

    // Token exchange
    const tokenResp = await fetch(`https://${subdomain}.egnyte.com/puboauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      console.error('Egnyte token exchange failed', tokenResp.status, t);
      await admin.from('tenant_integrations').update({
        status: 'error',
        last_error: `Token exchange failed (${tokenResp.status}): ${t.slice(0, 300)}`,
        updated_at: new Date().toISOString(),
      }).eq('organization_id', orgId).eq('integration_slug', 'egnyte');
      return errorPage(`Token exchange failed (${tokenResp.status}).`);
    }
    const tok = await tokenResp.json();

    // Optional userinfo
    let connectedEmail: string | null = null;
    try {
      const meResp = await fetch(`https://${subdomain}.egnyte.com/pubapi/v1/userinfo`, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (meResp.ok) {
        const me = await meResp.json();
        connectedEmail = me?.email ?? me?.username ?? null;
      }
    } catch { /* non-fatal */ }

    const accessEnc = await encryptToken(tok.access_token, ENC_KEY);
    const refreshEnc = tok.refresh_token ? await encryptToken(tok.refresh_token, ENC_KEY) : null;
    const expiresAt = tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString() : null;

    const { error: upErr } = await admin.from('tenant_integrations').update({
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: expiresAt,
      granted_scopes: stRow.requested_scopes ?? [],
      status: 'connected',
      enabled: true,
      last_error: null,
      connected_by: stRow.created_by,
      connected_email: connectedEmail,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('organization_id', orgId).eq('integration_slug', 'egnyte');
    if (upErr) { console.error('tenant_integrations update failed', upErr); return errorPage('Could not save Egnyte connection.'); }

    return htmlResponse(`<!doctype html><meta charset="utf-8"><title>Egnyte connected</title>
<script>
(function(){
  var target = ${JSON.stringify(returnPath)} + (${JSON.stringify(returnPath)}.indexOf('?')>-1 ? '&' : '?') + 'connected=egnyte';
  try {
    if (window.opener) { window.opener.postMessage({ type:'egnyte_connected' }, '*'); window.close(); return; }
  } catch(e){}
  location.replace(target);
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

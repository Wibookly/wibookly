// Diagnostic: end-to-end Microsoft Graph connectivity test for a user.
// NOTE: admin-only test endpoint. Returns booleans + counts, no PII payloads.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getValidAccessToken } from "../_shared/oauth-tokens.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const token = await getValidAccessToken(userId, 'outlook');
    if (!token) {
      return new Response(JSON.stringify({ ok: false, step: 'token', error: 'No valid access token (refresh failed or no vault entry)' }), {
        status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const tests: Record<string, any> = { token: 'ok' };

    // 1. /me
    const me = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    tests.me = { status: me.status, ok: me.ok };
    if (me.ok) {
      const j = await me.json();
      tests.me.upn = j.userPrincipalName;
      tests.me.displayName = j.displayName;
    } else {
      tests.me.body = (await me.text()).slice(0, 300);
    }

    // 2. Mail
    const mail = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=subject', {
      headers: { Authorization: `Bearer ${token}` },
    });
    tests.mail = { status: mail.status, ok: mail.ok };
    if (!mail.ok) tests.mail.body = (await mail.text()).slice(0, 300);

    // 3. Calendar
    const cal = await fetch('https://graph.microsoft.com/v1.0/me/events?$top=1&$select=subject', {
      headers: { Authorization: `Bearer ${token}` },
    });
    tests.calendar = { status: cal.status, ok: cal.ok };
    if (!cal.ok) tests.calendar.body = (await cal.text()).slice(0, 300);

    // 4. OneDrive
    const drive = await fetch('https://graph.microsoft.com/v1.0/me/drive/root/children?$top=1&$select=name', {
      headers: { Authorization: `Bearer ${token}` },
    });
    tests.onedrive = { status: drive.status, ok: drive.ok };
    if (!drive.ok) tests.onedrive.body = (await drive.text()).slice(0, 300);

    // 5. SharePoint sites the user follows
    const sites = await fetch('https://graph.microsoft.com/v1.0/sites?search=*&$top=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    tests.sharepoint = { status: sites.status, ok: sites.ok };
    if (!sites.ok) tests.sharepoint.body = (await sites.text()).slice(0, 300);

    const allOk = tests.me.ok && tests.mail.ok && tests.calendar.ok && tests.onedrive.ok && tests.sharepoint.ok;
    return new Response(JSON.stringify({ ok: allOk, tests }, null, 2), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});

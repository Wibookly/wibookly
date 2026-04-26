// Admin-only helper to configure the agent settings and (optionally)
// create or renew the Microsoft Graph mail subscription for the shared
// mailbox. Called from the admin dashboard.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MS_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID')!;
const MS_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;

async function getAppToken(tenantId: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function getGraphAccessDiagnostic(token: string, mailboxUserId: string) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxUserId)}?$select=id,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let detail: unknown = null;
  try {
    detail = await res.json();
  } catch {
    detail = await res.text();
  }

  return {
    ok: res.ok,
    status: res.status,
    detail,
  };
}

function errorResponse(status: number, error: string, detail?: unknown) {
  return new Response(JSON.stringify({ error, detail }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse(401, 'unauthorized');
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return errorResponse(401, 'unauthorized');
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resolve user's org and check admin role
  const { data: profile } = await admin
    .from('user_profiles')
    .select('organization_id, email')
    .eq('user_id', userData.user.id)
    .maybeSingle();

    if (!profile) {
      return errorResponse(403, 'no profile');
    }

  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('organization_id', profile.organization_id);

    const isAdmin = (roles ?? []).some((r) => r.role === 'admin');
    if (!isAdmin) {
      return errorResponse(403, 'admin only');
    }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { action } = body;

    if (action === 'get') {
      const { data: settings } = await admin
        .from('agent_settings')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .maybeSingle();
      return new Response(JSON.stringify({ settings }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'save') {
      const upsert = {
        organization_id: profile.organization_id,
        email_agent_enabled: !!body.email_agent_enabled,
        teams_agent_enabled: !!body.teams_agent_enabled,
        shared_mailbox_address: body.shared_mailbox_address ?? null,
        shared_mailbox_user_id: body.shared_mailbox_user_id ?? null,
        teams_tenant_id: body.teams_tenant_id ?? null,
        teams_bot_app_id: body.teams_bot_app_id ?? null,
        allowed_sender_domains: Array.isArray(body.allowed_sender_domains)
          ? body.allowed_sender_domains.map((d: string) => d.toLowerCase())
          : [],
      };

      const { data, error } = await admin
        .from('agent_settings')
        .upsert(upsert, { onConflict: 'organization_id' })
        .select()
        .single();

      if (error) {
        return errorResponse(500, error.message);
      }
      return new Response(JSON.stringify({ settings: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create_subscription') {
      const { data: settings } = await admin
        .from('agent_settings')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .maybeSingle();
      if (!settings || !settings.shared_mailbox_user_id || !settings.teams_tenant_id) {
        return errorResponse(400, 'Shared mailbox user id and tenant id required');
      }

      let token: string;
      try {
        token = await getAppToken(settings.teams_tenant_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Token exchange failed';
        const invalidClient = message.includes('AADSTS7000215') || message.includes('invalid_client');
        return errorResponse(
          400,
          invalidClient
            ? 'Microsoft app authentication failed. Update the Microsoft client secret in backend secrets using the secret value (not the secret ID).'
            : 'Microsoft token exchange failed. Check the tenant ID and Microsoft app credentials.',
          message
        );
      }

      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 2 - 60_000).toISOString();
      const notificationUrl = `${SUPABASE_URL}/functions/v1/graph-mail-webhook`;

      const subRes = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changeType: 'created',
          notificationUrl,
          resource: `/users/${settings.shared_mailbox_user_id}/mailFolders('Inbox')/messages`,
          expirationDateTime: expiresAt,
          clientState: profile.organization_id,
        }),
      });

      const subData = await subRes.json();
      if (!subRes.ok) {
        if (subRes.status === 403) {
          const diagnostic = await getGraphAccessDiagnostic(token, settings.shared_mailbox_user_id);
          const graphMessage = typeof subData?.error?.message === 'string' ? subData.error.message : null;

          return errorResponse(
            403,
            'Microsoft Graph access denied. In Azure, add Microsoft Graph application permission Mail.Read and grant admin consent for the app. Also confirm the shared mailbox user ID/email belongs to this tenant.',
            {
              subscription_error: subData,
              mailbox_access_check: diagnostic,
              hint: graphMessage?.includes('Access is denied')
                ? 'The app secret is working, but Microsoft is blocking mailbox access or subscription creation for this mailbox.'
                : 'Check Microsoft Graph application permissions and the mailbox identifier entered in Admin → AI Agent.',
            }
          );
        }
        return errorResponse(500, 'Graph subscription failed', subData);
      }

      await admin
        .from('agent_settings')
        .update({
          graph_subscription_id: subData.id,
          graph_subscription_expires_at: subData.expirationDateTime,
        })
        .eq('organization_id', profile.organization_id);

      return new Response(JSON.stringify({ subscription: subData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return errorResponse(400, 'unknown action');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return errorResponse(500, 'agent setup failed', message);
  }
});

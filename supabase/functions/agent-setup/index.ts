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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resolve user's org and check admin role
  const { data: profile } = await admin
    .from('user_profiles')
    .select('organization_id, email')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (!profile) {
    return new Response(JSON.stringify({ error: 'no profile' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('organization_id', profile.organization_id);

  const isAdmin = (roles ?? []).some((r) => r.role === 'admin');
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'admin only' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ settings: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'create_subscription') {
    // Create Graph subscription on the shared mailbox's inbox messages
    const { data: settings } = await admin
      .from('agent_settings')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .maybeSingle();
    if (!settings || !settings.shared_mailbox_user_id || !settings.teams_tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Shared mailbox user id and tenant id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = await getAppToken(settings.teams_tenant_id);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 2 - 60_000).toISOString(); // ~2 days
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
      return new Response(
        JSON.stringify({ error: 'Graph subscription failed', detail: subData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

  return new Response(JSON.stringify({ error: 'unknown action' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

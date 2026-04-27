// accept-invitation
// Validates a one-time invitation token, signs the invited user in via a
// Supabase magic link, and flags their profile so the app auto-launches the
// Outlook OAuth connect flow on first dashboard load.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANONICAL_APP_URL = 'https://inboxiq.energyforward.com';

function getAppUrl(req: Request): string {
  // Invitation links must always land on the real app domain.
  // Preview hosts require Lovable auth and will block external invitees.
  const origin = req.headers.get('origin') || req.headers.get('referer');
  if (origin) {
    try {
      const url = new URL(origin);
      const host = url.hostname.toLowerCase();
      const ok = host === 'localhost' || host === '127.0.0.1' || host === 'inboxiq.energyforward.com';
      if (ok) return url.origin;
    } catch { /* ignore */ }
  }
  return CANONICAL_APP_URL;
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

async function canRetryInvitation(adminClient: ReturnType<typeof createClient>, invitationUserId: string | null): Promise<boolean> {
  if (!invitationUserId) return false;

  const [{ data: profile }, { data: connection }] = await Promise.all([
    adminClient
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', invitationUserId)
      .maybeSingle(),
    adminClient
      .from('provider_connections')
      .select('id, is_connected')
      .eq('user_id', invitationUserId)
      .eq('provider', 'outlook')
      .maybeSingle(),
  ]);

  return !profile || !connection?.is_connected;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const appUrl = getAppUrl(req);

  try {
    // Two modes:
    //  GET  /accept-invitation?token=...  → consumes token, redirects to magic-link
    //  POST { token }                     → JSON validate-only (used by the app to look up info)
    const url = new URL(req.url);
    let token = url.searchParams.get('token');
    let validateOnly = false;

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      token = token || body.token;
      validateOnly = body.validate_only === true;
    }

    if (!token) {
      if (req.method === 'POST') {
        return new Response(JSON.stringify({ error: 'token is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Invitation link is missing a token')}`);
    }

    // Look up invitation
    const { data: invitation, error: invErr } = await adminClient
      .from('user_invitations')
      .select('id, organization_id, domain_id, email, full_name, mode, expires_at, used_at, user_id, group_id')
      .eq('token', token)
      .maybeSingle();

    if (invErr || !invitation) {
      const msg = 'This invitation link is invalid.';
      if (validateOnly) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return redirect(`${appUrl}/auth?error=${encodeURIComponent(msg)}`);
    }

    if (invitation.used_at) {
      const canRetry = await canRetryInvitation(adminClient, invitation.user_id);

      if (canRetry) {
        return new Response(JSON.stringify({
          valid: true,
          email: invitation.email,
          full_name: invitation.full_name,
          mode: invitation.mode,
          retry: true,
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const msg = 'This invitation has already been used. Please sign in normally.';
      if (validateOnly) {
        return new Response(JSON.stringify({ error: msg, already_used: true, email: invitation.email }), {
          status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return redirect(`${appUrl}/auth?info=${encodeURIComponent(msg)}&email=${encodeURIComponent(invitation.email)}`);
    }

    if (new Date(invitation.expires_at) < new Date()) {
      const msg = 'This invitation has expired. Please ask your administrator to resend it.';
      if (validateOnly) {
        return new Response(JSON.stringify({ error: msg, expired: true }), {
          status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return redirect(`${appUrl}/auth?error=${encodeURIComponent(msg)}`);
    }

    if (validateOnly) {
      return new Response(JSON.stringify({
        valid: true,
        email: invitation.email,
        full_name: invitation.full_name,
        mode: invitation.mode,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Ensure auth user exists (admins may have skipped pre-creating one for SSO mode)
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    let authUser = existingUsers?.users?.find((u) => u.email?.toLowerCase() === invitation.email.toLowerCase());

    if (!authUser) {
      // Create with random password — they'll never use it; SSO/magic link is the entry point.
      const tempPassword = crypto.randomUUID() + '!Aa1';
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email: invitation.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: invitation.full_name,
          auto_connect_microsoft: true,
          domain_id: invitation.domain_id,
          invited: true,
        },
      });
      if (createErr || !created?.user) {
        console.error('Failed to create invited auth user', createErr);
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('Failed to create your account. Please contact your administrator.')}`);
      }
      authUser = created.user;
    }

    // Ensure profile row exists with requires_outlook_connect = true
    const { data: existingProfile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (!existingProfile) {
      await adminClient.from('user_profiles').insert({
        user_id: authUser.id,
        email: invitation.email,
        full_name: invitation.full_name,
        organization_id: invitation.organization_id,
        domain_id: invitation.domain_id,
        microsoft_auto_connect: true,
        requires_outlook_connect: true,
      });

      await adminClient.from('organization_members').insert({
        user_id: authUser.id,
        organization_id: invitation.organization_id,
        role: 'member',
      });

      await adminClient.from('user_roles').insert({
        user_id: authUser.id,
        organization_id: invitation.organization_id,
        role: 'member',
      });
    } else {
      // Already has profile — just flip the auto-connect flag so they get redirected.
      await adminClient
        .from('user_profiles')
        .update({ microsoft_auto_connect: true, requires_outlook_connect: true })
        .eq('user_id', authUser.id);
    }

    // Optional group assignment
    if (invitation.group_id) {
      await adminClient
        .from('user_group_memberships')
        .insert({
          group_id: invitation.group_id,
          user_id: authUser.id,
          organization_id: invitation.organization_id,
        })
        .then(() => null, () => null); // ignore conflicts
    }

    // Mark invitation used
    await adminClient
      .from('user_invitations')
      .update({ used_at: new Date().toISOString(), user_id: authUser.id })
      .eq('id', invitation.id);

    // Mark the matching discovered_tenant_users row as invited (best-effort)
    await adminClient
      .from('discovered_tenant_users')
      .update({ status: 'active', invited_user_id: authUser.id })
      .eq('email', invitation.email)
      .eq('domain_id', invitation.domain_id || '');

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: invitation.email,
      options: {
        redirectTo: `${appUrl}/integrations?welcome=1`,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('Failed to generate invitation magic link', linkError);
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Your account was prepared, but sign-in could not be completed. Please try the email sign-in form.')}`);
    }

    return redirect(linkData.properties.action_link);

  } catch (e) {
    console.error('accept-invitation error', e);
    return redirect(`${appUrl}/auth?error=${encodeURIComponent('Could not process invitation. Please contact your administrator.')}`);
  }
});

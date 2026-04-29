import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
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

    let appUrl = getAppUrl();
    let stateData: any = {};

    if (stateParam) {
      try {
        stateData = JSON.parse(atob(stateParam));
        appUrl = resolveAppUrl(stateData.appOrigin);
      } catch {}
    }

    if (error) {
      console.error(`Microsoft SSO error: ${error} - ${errorDescription}`);
      return redirect(`${appUrl}/auth?error=${encodeURIComponent(errorDescription || error)}`);
    }

    if (!code || !stateParam) {
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Missing authorization code')}`);
    }

    // Exchange code for tokens
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')?.trim();
    const clientSecretRaw = Deno.env.get('MICROSOFT_CLIENT_SECRET');
    const clientSecret = clientSecretRaw?.trim();
    const callbackUrl = `${supabaseUrl}/functions/v1/microsoft-sso-callback`;

    if (!clientId || !clientSecret) {
      console.error('Microsoft SSO credentials are not configured correctly', {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        clientSecretLength: clientSecret?.length ?? 0,
        clientSecretTrimmed: Boolean(clientSecretRaw && clientSecretRaw !== clientSecret),
      });
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Authentication is not configured correctly.')}`);
    }

    const tenantIdFromState = typeof stateData.tenantId === 'string' && stateData.tenantId.trim()
      ? stateData.tenantId.trim()
      : null;
    const tenantSegment = tenantIdFromState || 'common';

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('Token exchange failed:', errText, {
        clientSecretLength: clientSecret.length,
        clientSecretTrimmed: Boolean(clientSecretRaw && clientSecretRaw !== clientSecret),
      });
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Authentication failed. Please try again.')}`);
    }

    const tokens = await tokenResponse.json();

    // Get user info from Microsoft Graph — request expanded profile fields
    const graphSelect = '$select=id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,companyName,officeLocation,mobilePhone,businessPhones,preferredLanguage';
    const userInfoResponse = await fetch(`https://graph.microsoft.com/v1.0/me?${graphSelect}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      console.error('Failed to get user info:', await userInfoResponse.text());
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Failed to retrieve user information')}`);
    }

    const userInfo = await userInfoResponse.json();
    const email = (userInfo.mail || userInfo.userPrincipalName)?.toLowerCase();
    const fullName = userInfo.displayName || '';
    const msJobTitle: string | null = userInfo.jobTitle || null;
    const msDepartment: string | null = userInfo.department || null;
    const msCompany: string | null = userInfo.companyName || null;
    const msMobile: string | null = userInfo.mobilePhone || null;
    const msPhone: string | null = (Array.isArray(userInfo.businessPhones) && userInfo.businessPhones[0]) || null;
    const msOffice: string | null = userInfo.officeLocation || null;
    const inviteToken = typeof stateData.inviteToken === 'string' ? stateData.inviteToken : null;

    if (!email) {
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Could not retrieve email from Microsoft account')}`);
    }

    console.log(`Microsoft SSO: user ${email}, name: ${fullName}`);

    // Check domain allowlist
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const domain = email.split('@')[1];
    const isSuperAdmin = email === 'arahimi@energyforward.com';

    let authorizedDomain: { id: string; organization_name: string | null; microsoft_consent_granted: boolean } | null = null;

    if (!isSuperAdmin) {
      const { data: domainData } = await adminClient
        .from('allowed_domains')
        .select('id, organization_name, microsoft_consent_granted')
        .eq('domain', domain)
        .eq('is_active', true)
        .maybeSingle();

      if (!domainData) {
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('Your email domain is not authorized. Contact your administrator.')}`);
      }

      if (!domainData.microsoft_consent_granted) {
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('Your organization has not completed Microsoft tenant authorization yet. Please ask your administrator to grant Microsoft consent first.')}`);
      }

      authorizedDomain = domainData;
    }

    if (inviteToken) {
      const { data: invitation } = await adminClient
        .from('user_invitations')
        .select('id, organization_id, domain_id, email, full_name, used_at, expires_at, group_id')
        .eq('token', inviteToken)
        .maybeSingle();

      if (!invitation) {
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('This invitation link is invalid.')}`);
      }

      if (invitation.used_at) {
        return redirect(`${appUrl}/auth?info=${encodeURIComponent('This invitation has already been used. Please sign in normally.')}&email=${encodeURIComponent(invitation.email)}`);
      }

      if (new Date(invitation.expires_at) < new Date()) {
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('This invitation has expired. Please ask your administrator to resend it.')}`);
      }

      if (invitation.email.toLowerCase() !== email) {
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('Please sign in with the same Microsoft email address that received the invitation.')}`);
      }
    }

    // Check if user exists in Supabase Auth
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email);

    let userId: string;
    let organizationId: string | null = null;

    if (existingUser) {
      userId = existingUser.id;
      console.log(`Existing user found: ${userId}`);

      const { data: existingProfile } = await adminClient
        .from('user_profiles')
        .select('organization_id, domain_id')
        .eq('user_id', userId)
        .maybeSingle();

      organizationId = existingProfile?.organization_id ?? null;

      // Refresh Microsoft 365 profile fields on every sign-in so the app
      // stays in sync with the user's tenant data (job title, dept, phones).
      if (organizationId) {
        await adminClient
          .from('user_profiles')
          .update({
            full_name: fullName || null,
            title: msJobTitle,
            department: msDepartment,
            company: msCompany,
            phone: msPhone,
            mobile: msMobile,
          })
          .eq('user_id', userId);
      }

      if (inviteToken) {
        const { data: invitation } = await adminClient
          .from('user_invitations')
          .select('organization_id, domain_id, group_id')
          .eq('token', inviteToken)
          .maybeSingle();

        if (invitation) {
          await adminClient
            .from('user_profiles')
            .upsert({
              user_id: userId,
              email,
              full_name: fullName || null,
              title: msJobTitle,
              department: msDepartment,
              company: msCompany,
              phone: msPhone,
              mobile: msMobile,
              organization_id: invitation.organization_id,
              domain_id: invitation.domain_id,
              microsoft_auto_connect: false,
              requires_outlook_connect: false,
            }, { onConflict: 'user_id' });

          await adminClient
            .from('organization_members')
            .upsert({ user_id: userId, organization_id: invitation.organization_id, role: 'member' }, { onConflict: 'user_id,organization_id' });

          await adminClient
            .from('user_roles')
            .upsert({ user_id: userId, organization_id: invitation.organization_id, role: 'member' }, { onConflict: 'user_id,organization_id,role' });

          if (invitation.group_id) {
            await adminClient
              .from('user_group_memberships')
              .upsert({ user_id: userId, organization_id: invitation.organization_id, group_id: invitation.group_id }, { onConflict: 'user_id,group_id' });
          }

          await adminClient
            .from('discovered_tenant_users')
            .update({ status: 'active', invited_user_id: userId, invited_at: new Date().toISOString() })
            .eq('email', email)
            .eq('domain_id', invitation.domain_id || '');

          organizationId = invitation.organization_id;
        }
      }
    } else {
      // Create new user
      const tempPassword = crypto.randomUUID() + '!Aa1';
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, auth_provider: 'microsoft' },
      });

      if (createError || !newUser?.user) {
        console.error('Failed to create user:', createError);
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('Failed to create account. Please try again.')}`);
      }

      userId = newUser.user.id;
      console.log(`Created new user: ${userId}`);

      // Create organization
      const orgName = isSuperAdmin ? 'Energy Forward' : (authorizedDomain?.organization_name || domain);
      let orgData: { id: string } | null = null;

      const { data: existingOrg } = await adminClient
        .from('organizations')
        .select('id')
        .ilike('name', orgName)
        .maybeSingle();

      if (existingOrg) {
        orgData = existingOrg;
      } else {
        const { data: createdOrg, error: orgError } = await adminClient
          .from('organizations')
          .insert({ name: orgName })
          .select('id')
          .single();

        if (orgError || !createdOrg) {
          console.error('Failed to create org:', orgError);
        } else {
          orgData = createdOrg;
        }
      }

      if (!orgData) {
        console.error('Failed to resolve org for domain:', domain);
        // Continue anyway, profile creation will handle it
      } else {
        // Create user profile (with Microsoft 365 fields pulled from Graph)
        await adminClient.from('user_profiles').insert({
          user_id: userId,
          organization_id: orgData.id,
          email,
          full_name: fullName,
          title: msJobTitle,
          department: msDepartment,
          company: msCompany,
          phone: msPhone,
          mobile: msMobile,
        });

        // Create user role
        const role = isSuperAdmin ? 'admin' : 'member';
        await adminClient.from('user_roles').insert({
          user_id: userId,
          organization_id: orgData.id,
          role,
        });

        // Create organization member
        await adminClient.from('organization_members').insert({
          user_id: userId,
          organization_id: orgData.id,
          role,
        });

        // Create default categories
        const defaultCategories = [
          { name: 'Urgent', color: '#EF4444', sort_order: 0 },
          { name: 'No Reply Tracker', color: '#F97316', sort_order: 1 },
          { name: 'Approvals', color: '#EAB308', sort_order: 2 },
          { name: 'Events', color: '#22C55E', sort_order: 3 },
          { name: 'Customers', color: '#3B82F6', sort_order: 4 },
          { name: 'Vendors', color: '#8B5CF6', sort_order: 5 },
          { name: 'Internal', color: '#EC4899', sort_order: 6 },
          { name: 'Projects', color: '#06B6D4', sort_order: 7 },
          { name: 'Finance', color: '#84CC16', sort_order: 8 },
          { name: 'FYI', color: '#6B7280', sort_order: 9 },
        ];

        await adminClient.from('categories').insert(
          defaultCategories.map(cat => ({ ...cat, organization_id: orgData.id }))
        );

        // Create default AI settings
        await adminClient.from('ai_settings').insert({
          organization_id: orgData.id,
          writing_style: 'professional',
        });

        await adminClient.from('provider_connections').upsert({
          user_id: userId,
          organization_id: orgData.id,
          provider: 'outlook',
          is_connected: false,
          calendar_connected: false,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,provider',
        });

        organizationId = orgData.id;
      }
    }

    if (userId && organizationId) {
      const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY');

      if (encryptionKey) {
        const encryptedAccessToken = await encryptToken(tokens.access_token, encryptionKey);
        const encryptedRefreshToken = tokens.refresh_token
          ? await encryptToken(tokens.refresh_token, encryptionKey)
          : null;
        const expiresAt = tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null;

        await adminClient.from('oauth_token_vault').upsert({
          user_id: userId,
          provider: 'outlook',
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,provider' });
      }

      await adminClient.from('provider_connections').upsert({
        user_id: userId,
        organization_id: organizationId,
        provider: 'outlook',
        is_connected: true,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        connected_email: email,
        calendar_connected: true,
        calendar_connected_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });

      if (inviteToken) {
        const { data: invitation } = await adminClient
          .from('user_invitations')
          .select('id, organization_id, domain_id, group_id')
          .eq('token', inviteToken)
          .maybeSingle();

        if (invitation) {
          await adminClient
            .from('user_profiles')
            .upsert({
              user_id: userId,
              email,
              full_name: fullName || null,
              title: msJobTitle,
              department: msDepartment,
              company: msCompany,
              phone: msPhone,
              mobile: msMobile,
              organization_id: invitation.organization_id,
              domain_id: invitation.domain_id,
              microsoft_auto_connect: false,
              requires_outlook_connect: false,
            }, { onConflict: 'user_id' });

          await adminClient
            .from('organization_members')
            .upsert({ user_id: userId, organization_id: invitation.organization_id, role: 'member' }, { onConflict: 'user_id,organization_id' });

          await adminClient
            .from('user_roles')
            .upsert({ user_id: userId, organization_id: invitation.organization_id, role: 'member' }, { onConflict: 'user_id,organization_id,role' });

          if (invitation.group_id) {
            await adminClient
              .from('user_group_memberships')
              .upsert({ user_id: userId, organization_id: invitation.organization_id, group_id: invitation.group_id }, { onConflict: 'user_id,group_id' });
          }

          await adminClient
            .from('user_invitations')
            .update({ used_at: new Date().toISOString(), user_id: userId })
            .eq('id', invitation.id);

          await adminClient
            .from('discovered_tenant_users')
            .update({ status: 'active', invited_user_id: userId, invited_at: new Date().toISOString() })
            .eq('email', email)
            .eq('domain_id', invitation.domain_id || '');
        }
      }
    }

    // Generate a magic link / sign the user in by creating a session
    // We use generateLink to create a magic link that auto-signs the user in
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${appUrl}/integrations`,
      },
    });

    if (linkError || !linkData) {
      console.error('Failed to generate sign-in link:', linkError);
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Authentication succeeded but session creation failed. Please sign in with email/password.')}`);
    }

    // The generated link contains a token_hash we can use
    // Redirect to the verification URL which will set the session
    const verificationUrl = linkData.properties?.action_link;
    if (verificationUrl) {
      console.log(`Redirecting user ${email} via magic link`);
      return redirect(verificationUrl);
    }

    // Fallback: redirect to auth with success message
    return redirect(`${appUrl}/auth?sso=success&email=${encodeURIComponent(email)}`);

  } catch (error: unknown) {
    console.error('Microsoft SSO callback error:', error);
    return redirect(`${getAppUrl()}/auth?error=${encodeURIComponent('An unexpected error occurred')}`);
  }
});

const CANONICAL_APP_URL = 'https://inboxiq.energyforward.com';

function getAppUrl(): string {
  return CANONICAL_APP_URL;
}

function resolveAppUrl(appOrigin?: unknown): string {
  const fallback = getAppUrl();
  if (typeof appOrigin !== 'string' || !appOrigin) return fallback;
  try {
    const url = new URL(appOrigin);
    const host = url.hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const isCustomDomain = host === 'inboxiq.energyforward.com';
    if (!isLocal && !isCustomDomain) return fallback;
    if (url.protocol !== 'https:' && !isLocal) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

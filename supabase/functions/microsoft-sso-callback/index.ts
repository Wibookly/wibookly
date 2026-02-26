import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')!;
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;
    const callbackUrl = `${supabaseUrl}/functions/v1/microsoft-sso-callback`;

    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
      console.error('Token exchange failed:', errText);
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Authentication failed. Please try again.')}`);
    }

    const tokens = await tokenResponse.json();

    // Get user info from Microsoft Graph
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      console.error('Failed to get user info:', await userInfoResponse.text());
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Failed to retrieve user information')}`);
    }

    const userInfo = await userInfoResponse.json();
    const email = (userInfo.mail || userInfo.userPrincipalName)?.toLowerCase();
    const fullName = userInfo.displayName || '';

    if (!email) {
      return redirect(`${appUrl}/auth?error=${encodeURIComponent('Could not retrieve email from Microsoft account')}`);
    }

    console.log(`Microsoft SSO: user ${email}, name: ${fullName}`);

    // Check domain allowlist
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const domain = email.split('@')[1];
    const isSuperAdmin = email === 'arahimi@energyforward.com';

    if (!isSuperAdmin) {
      const { data: domainData } = await adminClient
        .from('allowed_domains')
        .select('id')
        .eq('domain', domain)
        .eq('is_active', true)
        .maybeSingle();

      if (!domainData) {
        return redirect(`${appUrl}/auth?error=${encodeURIComponent('Your email domain is not authorized. Contact your administrator.')}`);
      }
    }

    // Check if user exists in Supabase Auth
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email);

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
      console.log(`Existing user found: ${userId}`);
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
      const orgName = isSuperAdmin ? 'Energy Forward' : `${domain} Organization`;
      const { data: orgData, error: orgError } = await adminClient
        .from('organizations')
        .insert({ name: orgName })
        .select()
        .single();

      if (orgError || !orgData) {
        console.error('Failed to create org:', orgError);
        // Continue anyway, profile creation will handle it
      } else {
        // Create user profile
        await adminClient.from('user_profiles').insert({
          user_id: userId,
          organization_id: orgData.id,
          email,
          full_name: fullName,
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
          { name: 'Follow Up', color: '#F97316', sort_order: 1 },
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

function getAppUrl(): string {
  return 'https://jbzctydskdpzrejvpwpn.lovable.app';
}

function resolveAppUrl(appOrigin?: unknown): string {
  const fallback = getAppUrl();
  if (typeof appOrigin !== 'string' || !appOrigin) return fallback;
  try {
    const url = new URL(appOrigin);
    const host = url.hostname.toLowerCase();
    const isLovable = host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com');
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isLovable && !isLocal) return fallback;
    if (url.protocol !== 'https:' && !isLocal) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

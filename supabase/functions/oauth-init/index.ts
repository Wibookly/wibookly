import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authenticated user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { provider, userId, organizationId, redirectUrl } = await req.json();
    
    console.log(`OAuth init request for provider: ${provider}, authenticated user: ${user.id}`);

    if (!provider || !userId || !organizationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: provider, userId, organizationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CRITICAL: Validate userId matches authenticated user
    if (userId !== user.id) {
      console.error(`User mismatch: JWT user ${user.id} tried to init OAuth for ${userId}`);
      return new Response(
        JSON.stringify({ error: 'Unauthorized: User ID mismatch' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate organizationId belongs to user using service role to bypass RLS
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: profile, error: profileError } = await adminClient
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    console.log('Profile lookup result:', { profile, error: profileError?.message, userId: user.id });

    if (profileError || !profile || profile.organization_id !== organizationId) {
      console.error(`Org mismatch: User ${user.id} tried to use org ${organizationId}, profile org: ${profile?.organization_id || 'not found'}`);
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Organization mismatch' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate a random state parameter for CSRF protection
    const state = crypto.randomUUID();
    
    // Store the state in a simple format to pass to callback
    const stateData = btoa(JSON.stringify({
      state,
      userId,
      organizationId,
      provider,
      // Remember which web origin started the flow so the callback can return there.
      // This avoids redirecting to an unpublished/stale domain.
      appOrigin: req.headers.get('origin') || undefined,
      redirectUrl: redirectUrl || '/integrations'
    }));

    let authUrl: string;

    if (provider === 'google') {
      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      if (!clientId) {
        console.error('GOOGLE_CLIENT_ID not configured');
        return new Response(
          JSON.stringify({ error: 'Google OAuth not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/gmail.labels https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
        access_type: 'offline',
        prompt: 'consent select_account',
        state: stateData,
        include_granted_scopes: 'true'
      });

      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      console.log('Generated Google OAuth URL with calendar scopes');

    } else if (provider === 'outlook') {
      const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
      if (!clientId) {
        console.error('MICROSOFT_CLIENT_ID not configured');
        return new Response(
          JSON.stringify({ error: 'Microsoft OAuth not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite',
        response_mode: 'query',
        state: stateData
      });

      authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
      console.log('Generated Microsoft OAuth URL with calendar scopes');

    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ authUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('OAuth init error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

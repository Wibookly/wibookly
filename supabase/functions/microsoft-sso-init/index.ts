import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    
    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if domain is allowed
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check super admin or allowed domain
    const isSuperAdmin = email.toLowerCase() === 'arahimi@energyforward.com';
    
    if (!isSuperAdmin) {
      const { data: domainData } = await adminClient
        .from('allowed_domains')
        .select('id, microsoft_consent_granted')
        .eq('domain', domain)
        .eq('is_active', true)
        .maybeSingle();

      if (!domainData) {
        return new Response(
          JSON.stringify({ error: 'Your email domain is not authorized. Please contact your administrator.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!domainData.microsoft_consent_granted) {
        return new Response(
          JSON.stringify({ error: 'Your organization has not completed Microsoft tenant authorization yet. Please ask your administrator to grant Microsoft consent for your domain first.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    if (!clientId) {
      return new Response(
        JSON.stringify({ error: 'Microsoft OAuth not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const callbackUrl = `${supabaseUrl}/functions/v1/microsoft-sso-callback`;
    
    // Store state for CSRF protection and to pass context
    const state = crypto.randomUUID();
    const stateData = btoa(JSON.stringify({
      state,
      email,
      appOrigin: req.headers.get('origin') || undefined,
    }));

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Calendars.ReadWrite',
      response_mode: 'query',
      state: stateData,
      login_hint: email,
      prompt: 'select_account',
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;

    return new Response(
      JSON.stringify({ authUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Microsoft SSO init error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

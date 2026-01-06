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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Validate authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('Missing or invalid authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create a client with the user's token to validate auth
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Validate JWT and get user
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseUserClient.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.error('JWT validation failed:', claimsError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authenticatedUserId = claimsData.claims.sub;
    if (!authenticatedUserId) {
      console.error('No user ID in claims');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for database operations
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { 
      userId, 
      organizationId, 
      connectionId,
      categoryId,
      categoryName,
      eventTitle,
      eventDate,
      attendees 
    } = await req.json();

    // Verify the userId in the request matches the authenticated user
    if (userId !== authenticatedUserId) {
      console.error('User ID mismatch: request userId does not match authenticated user');
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!userId || !organizationId || !categoryName) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: userId, organizationId, categoryName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Logging calendar event for authenticated user ${userId}: ${eventTitle}`);

    // Log the calendar event as an AI activity
    const { error: logError } = await supabase
      .from('ai_activity_logs')
      .insert({
        user_id: userId,
        organization_id: organizationId,
        connection_id: connectionId || null,
        category_id: categoryId || null,
        category_name: categoryName,
        activity_type: 'scheduled_event',
        email_subject: eventTitle || 'Calendar Event',
        email_from: attendees?.join(', ') || null,
      });

    if (logError) {
      console.error('Failed to log calendar event:', logError);
      return new Response(
        JSON.stringify({ error: 'Failed to log calendar event' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Calendar event logged successfully');

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Log calendar event error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

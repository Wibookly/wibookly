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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
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

    if (!userId || !organizationId || !categoryName) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: userId, organizationId, categoryName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Logging calendar event for user ${userId}: ${eventTitle}`);

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
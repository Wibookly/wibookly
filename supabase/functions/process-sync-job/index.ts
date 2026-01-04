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

    // Create client with user's auth context to verify identity
    const supabaseUserClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's organization
    const { data: profile } = await supabaseUserClient
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) {
      console.error('User profile not found');
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Create the job with pending status
    const { data: job, error: insertError } = await supabaseAdmin
      .from('jobs')
      .insert({
        organization_id: profile.organization_id,
        user_id: user.id,
        job_type: 'sync',
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to create job:', insertError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to create job' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Created job ${job.id} for user ${user.id}`);

    // Update job to running status
    await supabaseAdmin
      .from('jobs')
      .update({ 
        status: 'running', 
        started_at: new Date().toISOString() 
      })
      .eq('id', job.id);

    console.log(`Job ${job.id} started`);

    // Simulate sync processing (in production, this would do actual email sync)
    // TODO: Implement actual email sync logic with provider_connections
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mark job as completed
    await supabaseAdmin
      .from('jobs')
      .update({ 
        status: 'completed', 
        completed_at: new Date().toISOString() 
      })
      .eq('id', job.id);

    console.log(`Job ${job.id} completed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        jobId: job.id,
        message: 'Sync completed successfully' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Process sync job error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

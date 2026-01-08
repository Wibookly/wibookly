import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, connectionId } = await req.json();
    
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user's email context (recent emails, calendar events)
    let emailContext = "";
    let calendarContext = "";

    if (connectionId) {
      // Get recent AI activity logs to understand email patterns
      const { data: activityLogs } = await supabase
        .from("ai_activity_logs")
        .select("email_subject, email_from, category_name, activity_type, created_at")
        .eq("connection_id", connectionId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (activityLogs && activityLogs.length > 0) {
        emailContext = `\n\nRecent email activity:\n${activityLogs.map(log => 
          `- ${log.activity_type}: "${log.email_subject}" from ${log.email_from} (${log.category_name}) at ${new Date(log.created_at).toLocaleString()}`
        ).join("\n")}`;
      }

      // Get categories to understand email organization
      const { data: categories } = await supabase
        .from("categories")
        .select("name, color, is_enabled, ai_draft_enabled, auto_reply_enabled")
        .eq("connection_id", connectionId)
        .eq("is_enabled", true);

      if (categories && categories.length > 0) {
        emailContext += `\n\nEmail categories:\n${categories.map(cat => 
          `- ${cat.name} (AI Draft: ${cat.ai_draft_enabled ? 'enabled' : 'disabled'}, Auto-reply: ${cat.auto_reply_enabled ? 'enabled' : 'disabled'})`
        ).join("\n")}`;
      }

      // Get availability hours
      const { data: availability } = await supabase
        .from("availability_hours")
        .select("day_of_week, start_time, end_time, is_available")
        .eq("connection_id", connectionId)
        .eq("is_available", true);

      if (availability && availability.length > 0) {
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        calendarContext = `\n\nAvailability:\n${availability.map(slot => 
          `- ${dayNames[slot.day_of_week]}: ${slot.start_time} - ${slot.end_time}`
        ).join("\n")}`;
      }
    }

    const systemPrompt = `You are an intelligent AI assistant helping a busy professional manage their emails and calendar. You have access to their email activity, categories, and availability schedule.

Your role is to:
1. Answer questions about their emails and schedule
2. Help prioritize tasks based on email activity
3. Suggest responses or actions for emails
4. Provide insights about their communication patterns
5. Help with calendar management and availability

Be concise, professional, and actionable in your responses. If you don't have specific information, say so clearly.
${emailContext}${calendarContext}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Error in ai-assistant-chat:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

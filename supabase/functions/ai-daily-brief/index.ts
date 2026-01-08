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

    const { connectionId } = await req.json();

    // Gather context about user's day
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();
    const dayOfWeek = new Date().getDay();

    let emailContext: Array<{ email_subject: string | null; email_from: string | null; category_name: string; activity_type: string; created_at: string }> = [];
    let availabilityContext: Array<{ start_time: string; end_time: string; is_available: boolean }> = [];
    let categoriesContext: Array<{ id: string; name: string; color: string; ai_draft_enabled: boolean; auto_reply_enabled: boolean }> = [];

    if (connectionId) {
      // Get today's email activity
      const { data: todayActivity } = await supabase
        .from("ai_activity_logs")
        .select("email_subject, email_from, category_name, activity_type, created_at")
        .eq("connection_id", connectionId)
        .gte("created_at", startOfDay)
        .order("created_at", { ascending: false });

      if (todayActivity) {
        emailContext = todayActivity;
      }

      // Get recent (last 7 days) email activity for patterns
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data: weekActivity } = await supabase
        .from("ai_activity_logs")
        .select("email_subject, email_from, category_name, activity_type, created_at")
        .eq("connection_id", connectionId)
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(50);

      // Get categories with pending items
      const { data: categories } = await supabase
        .from("categories")
        .select("id, name, color, ai_draft_enabled, auto_reply_enabled")
        .eq("connection_id", connectionId)
        .eq("is_enabled", true);

      if (categories) {
        categoriesContext = categories;
      }

      // Get today's availability
      const { data: availability } = await supabase
        .from("availability_hours")
        .select("start_time, end_time, is_available")
        .eq("connection_id", connectionId)
        .eq("day_of_week", dayOfWeek);

      if (availability) {
        availabilityContext = availability;
      }
    }

    // Build context for AI
    const contextData = {
      date: new Date().toLocaleDateString("en-US", { 
        weekday: "long", 
        year: "numeric", 
        month: "long", 
        day: "numeric" 
      }),
      todayEmails: emailContext.length,
      emailActivity: emailContext.slice(0, 10).map(e => ({
        subject: e.email_subject,
        from: e.email_from,
        category: e.category_name,
        type: e.activity_type,
        time: new Date(e.created_at).toLocaleTimeString()
      })),
      categories: categoriesContext.map(c => ({
        name: c.name,
        aiEnabled: c.ai_draft_enabled
      })),
      availability: availabilityContext.filter(a => a.is_available).map(a => ({
        start: a.start_time,
        end: a.end_time
      }))
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an executive assistant creating a daily brief. Analyze the user's email activity and schedule to create a prioritized action list.

Based on the context provided, generate a structured daily brief in JSON format with these sections:
1. "greeting": A personalized morning greeting
2. "summary": Brief 1-2 sentence overview of the day
3. "priorities": Array of 3-5 high priority items (each with "title", "description", "urgency": "high"|"medium"|"low", "type": "email"|"meeting"|"task")
4. "schedule": Array of today's time blocks (each with "time", "title", "type")
5. "emailHighlights": Array of important emails to address (each with "from", "subject", "action")
6. "suggestions": Array of 2-3 productivity suggestions for the day

Be concise, actionable, and prioritize based on urgency. If there's limited data, provide reasonable defaults and suggestions.`;

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
          { role: "user", content: `Here is my context for today:\n${JSON.stringify(contextData, null, 2)}\n\nPlease generate my daily brief.` },
        ],
        response_format: { type: "json_object" },
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

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;
    
    let briefData;
    try {
      briefData = JSON.parse(content);
    } catch {
      briefData = {
        greeting: `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}!`,
        summary: "Here's your daily overview.",
        priorities: [],
        schedule: [],
        emailHighlights: [],
        suggestions: ["Review your email categories", "Check your calendar for upcoming meetings"]
      };
    }

    return new Response(JSON.stringify(briefData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ai-daily-brief:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

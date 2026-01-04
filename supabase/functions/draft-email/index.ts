import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Writing style prompts that control tone, formality, and response length
const WRITING_STYLE_PROMPTS: Record<string, string> = {
  professional: `You write in a Professional & Polished style:
- Use formal business language with proper grammar
- Maintain a respectful, authoritative tone
- Be thorough but concise
- Use complete sentences and proper paragraphs
- Include appropriate greetings and sign-offs`,

  friendly: `You write in a Friendly & Approachable style:
- Use warm, conversational language
- Be personable while remaining professional
- Use contractions naturally (I'm, we're, you'll)
- Keep a positive, upbeat tone
- Be helpful and accommodating`,

  concierge: `You write in a Concierge / White-Glove style:
- Use elegant, refined language
- Be exceptionally courteous and attentive
- Anticipate needs and offer additional assistance
- Use phrases like "It would be my pleasure" and "I'm delighted to assist"
- Make the recipient feel valued and important`,

  direct: `You write in a Direct & Efficient style:
- Get straight to the point
- Use short, clear sentences
- Avoid unnecessary pleasantries
- Focus on actionable information
- Be brief but not curt`,

  empathetic: `You write in an Empathetic & Supportive style:
- Acknowledge emotions and concerns
- Use understanding, compassionate language
- Validate the recipient's situation
- Offer reassurance and support
- Be patient and thorough in explanations`,
};

// Category context prompts
const CATEGORY_CONTEXT: Record<string, string> = {
  'Urgent': 'This is an urgent matter requiring immediate attention.',
  'Follow Up': 'This is a follow-up to a previous conversation or request.',
  'Approvals': 'This relates to approving or reviewing something.',
  'Meetings': 'This relates to scheduling, confirming, or discussing meetings.',
  'Customers': 'This is client-facing communication that represents the business.',
  'Vendors': 'This is communication with vendors, suppliers, or external partners.',
  'Internal': 'This is internal team communication.',
  'Projects': 'This relates to project updates, deliverables, or workstreams.',
  'Finance': 'This relates to billing, payments, receipts, or financial matters.',
  'FYI': 'This is informational communication for awareness purposes.',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      emailSubject,
      emailBody,
      senderName,
      senderEmail,
      categoryName,
      writingStyle,
      action,
      additionalContext 
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get writing style prompt
    const stylePrompt = WRITING_STYLE_PROMPTS[writingStyle] || WRITING_STYLE_PROMPTS.professional;
    
    // Get category context
    const cleanCategoryName = categoryName?.replace(/^\d+:\s*/, '') || 'General';
    const categoryContext = CATEGORY_CONTEXT[cleanCategoryName] || '';

    // Build the system prompt
    const systemPrompt = `You are an expert email assistant for business communication.

${stylePrompt}

CATEGORY CONTEXT: ${cleanCategoryName}
${categoryContext}

RULES:
- Generate a complete, ready-to-send email draft
- Match the writing style exactly
- Keep responses concise and professional
- Avoid unnecessary detail or repetition
- Do not include subject line in your response (it will be handled separately)
- Start directly with the greeting
- End with an appropriate sign-off
- Do not add explanations before or after the email - just the email content`;

    // Build the user prompt based on action
    let userPrompt = '';
    
    if (action === 'reply') {
      userPrompt = `Draft a reply to this email:

FROM: ${senderName} <${senderEmail}>
SUBJECT: ${emailSubject}

${emailBody}

${additionalContext ? `ADDITIONAL INSTRUCTIONS: ${additionalContext}` : ''}`;
    } else if (action === 'compose') {
      userPrompt = `Compose a new email about:

SUBJECT: ${emailSubject}
${additionalContext ? `DETAILS: ${additionalContext}` : ''}`;
    } else if (action === 'improve') {
      userPrompt = `Improve and rewrite this email draft while maintaining its intent:

${emailBody}

${additionalContext ? `ADDITIONAL INSTRUCTIONS: ${additionalContext}` : ''}`;
    }

    console.log(`Drafting email - Style: ${writingStyle}, Category: ${cleanCategoryName}, Action: ${action}`);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.error('Rate limit exceeded');
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        console.error('Payment required');
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to generate email draft' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const draft = data.choices?.[0]?.message?.content || '';

    console.log('Email draft generated successfully');

    return new Response(
      JSON.stringify({ 
        success: true,
        draft,
        category: cleanCategoryName,
        writingStyle 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Draft email error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
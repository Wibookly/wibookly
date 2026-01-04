import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation constants
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_ADDITIONAL_CONTEXT_LENGTH = 500;
const MAX_EXAMPLE_REPLY_LENGTH = 2000;

// Patterns that could indicate prompt injection attempts
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|above|prior)/i,
  /forget\s+(all\s+)?(previous|above|prior)/i,
  /new\s+instructions?:/i,
  /system\s*:/i,
  /\[system\]/i,
  /\[assistant\]/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+(a\s+)?different/i,
  /pretend\s+(to\s+be|you\s+are)/i,
  /override\s+(your\s+)?instructions?/i,
  /bypass\s+(your\s+)?rules?/i,
];

// Sanitize input to remove potential injection patterns
function sanitizeInput(input: string, maxLength: number): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  
  // Trim and limit length
  let sanitized = input.trim().slice(0, maxLength);
  
  // Check for and log potential injection attempts
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      console.warn('Potential prompt injection detected and sanitized:', pattern.toString());
      // Remove the matched pattern
      sanitized = sanitized.replace(pattern, '[removed]');
    }
  }
  
  // Remove any remaining control characters or unusual unicode
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  return sanitized;
}

// Validate category name against allowed values
const ALLOWED_CATEGORIES = [
  'Urgent', 'Follow Up', 'Approvals', 'Meetings', 'Customers',
  'Vendors', 'Internal', 'Projects', 'Finance', 'FYI', 'General'
];

function validateCategoryName(categoryName: string): string {
  const cleaned = categoryName?.replace(/^\d+:\s*/, '').trim() || 'General';
  // If it's in the allowed list, use it; otherwise default to General
  return ALLOWED_CATEGORIES.includes(cleaned) ? cleaned : 'General';
}

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

// Allowed writing styles for validation
const ALLOWED_WRITING_STYLES = ['professional', 'friendly', 'concierge', 'direct', 'empathetic'];

// Format style prompts
const FORMAT_STYLE_PROMPTS: Record<string, string> = {
  concise: 'Keep the response short and direct. Use minimal words while conveying the complete message.',
  detailed: 'Provide a thorough explanation with full context and reasoning.',
  'bullet-points': 'Structure the main content using bullet points for clarity and easy scanning.',
  highlights: 'Focus only on the key highlights and most important points. Skip any fluff.',
};

// Allowed format styles for validation
const ALLOWED_FORMAT_STYLES = ['concise', 'detailed', 'bullet-points', 'highlights'];

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
    const rawBody = await req.json();
    
    // Validate and sanitize all inputs
    const cleanCategoryName = validateCategoryName(rawBody.categoryName || '');
    
    // Validate writing style against allowed values
    const writingStyle = ALLOWED_WRITING_STYLES.includes(rawBody.writingStyle) 
      ? rawBody.writingStyle 
      : 'professional';
    
    // Validate format style against allowed values
    const formatStyle = ALLOWED_FORMAT_STYLES.includes(rawBody.formatStyle)
      ? rawBody.formatStyle
      : 'concise';
    
    // Sanitize free-text inputs with length limits
    const sanitizedExampleReply = sanitizeInput(rawBody.exampleReply || '', MAX_EXAMPLE_REPLY_LENGTH);
    const sanitizedAdditionalContext = sanitizeInput(rawBody.additionalContext || '', MAX_ADDITIONAL_CONTEXT_LENGTH);

    console.log(`Processing draft request - Category: ${cleanCategoryName}, Style: ${writingStyle}, Format: ${formatStyle}`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get writing style prompt (already validated)
    const stylePrompt = WRITING_STYLE_PROMPTS[writingStyle];
    
    // Get format style prompt (already validated)
    const formatPrompt = FORMAT_STYLE_PROMPTS[formatStyle];
    
    // Get category context (already validated)
    const categoryContext = CATEGORY_CONTEXT[cleanCategoryName] || '';

    // Build example reference with sanitized input
    let exampleContext = '';
    if (sanitizedExampleReply) {
      exampleContext = `\n\nEXAMPLE REPLY TEMPLATE (mimic this style and format):
${sanitizedExampleReply}`;
    }

    // Build the system prompt
    const systemPrompt = `You are an expert email assistant for business communication.

${stylePrompt}

FORMAT INSTRUCTIONS: ${formatPrompt}

CATEGORY CONTEXT: ${cleanCategoryName}
${categoryContext}
${exampleContext}

RULES:
- Generate a complete, ready-to-send email reply template
- Match the writing style exactly
- Follow the format instructions precisely
- If an example reply template is provided, closely mimic its structure, tone, and formatting
- Keep responses appropriate for the category
- Do not include subject line in your response
- Start directly with the greeting
- End with an appropriate sign-off
- Do not add explanations before or after the email - just the email content`;

    // Build the user prompt for generating a reply template (using sanitized input)
    const userPrompt = `Generate a sample email reply for the "${cleanCategoryName}" category.

This reply template will be used as a reference for auto-replies to emails in this category.

${sanitizedAdditionalContext ? `ADDITIONAL INSTRUCTIONS: ${sanitizedAdditionalContext}` : ''}

Create a professional reply that could serve as a template for responding to typical emails in this category.`;

    console.log(`Drafting email - Style: ${writingStyle}, Format: ${formatStyle}, Category: ${cleanCategoryName}`);

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
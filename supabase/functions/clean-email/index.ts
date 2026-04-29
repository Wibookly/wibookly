// Clean an email body: strip HTML, signatures, quoted replies, disclaimers.
// Pure utility - no external API calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function stripHtml(html: string): string {
  // Remove style/script blocks entirely
  let text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  // Convert common block tags to newlines
  text = text
    .replace(/<\/(p|div|br|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ");

  return text;
}

const QUOTE_PATTERNS: RegExp[] = [
  // "On <date>, <name> wrote:"
  /^[\s>]*On\s+.+?wrote:\s*$/im,
  // "From: ... Sent: ... To: ..."
  /^[\s>]*From:\s+.+$/im,
  // ">>>" gmail style
  /^[\s>]*-{2,}\s*Original Message\s*-{2,}.*$/im,
  /^[\s>]*-{2,}\s*Forwarded message\s*-{2,}.*$/im,
  // Outlook divider
  /^_{5,}\s*$/m,
];

const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/m, // Standard sig delimiter
  /^Sent from my (iPhone|iPad|Android|Samsung|mobile).*$/im,
  /^Get Outlook for (iOS|Android).*$/im,
];

const DISCLAIMER_PATTERNS: RegExp[] = [
  /CONFIDENTIALITY NOTICE[:\s][\s\S]+/i,
  /This e?mail (and any attachments )?(is|are) (confidential|intended)[\s\S]+/i,
  /DISCLAIMER[:\s][\s\S]+/i,
  /If you are not the intended recipient[\s\S]+/i,
];

function cleanText(input: string): string {
  let text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Find earliest cutoff for quoted replies
  let cutoff = text.length;
  for (const pat of QUOTE_PATTERNS) {
    const m = pat.exec(text);
    if (m && m.index < cutoff) cutoff = m.index;
  }
  text = text.slice(0, cutoff);

  // Strip signature delimiters
  for (const pat of SIGNATURE_PATTERNS) {
    const m = pat.exec(text);
    if (m) text = text.slice(0, m.index);
  }

  // Strip legal disclaimers
  for (const pat of DISCLAIMER_PATTERNS) {
    text = text.replace(pat, "");
  }

  // Remove leading ">" quoted lines
  text = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

  // Collapse whitespace
  text = text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();

  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } =
      await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { body, isHtml } = await req.json();
    if (typeof body !== "string") {
      return new Response(
        JSON.stringify({ error: "body must be a string" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const isHtmlGuess =
      typeof isHtml === "boolean" ? isHtml : /<[a-z][\s\S]*>/i.test(body);
    const plain = isHtmlGuess ? stripHtml(body) : body;
    const cleaned = cleanText(plain);

    return new Response(
      JSON.stringify({
        cleaned,
        original_length: body.length,
        cleaned_length: cleaned.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("clean-email error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

// live-ai-cost
// Returns live spend totals from OpenAI and Anthropic billing APIs for a date range.
// Super-admin only. Falls back gracefully if a provider key is missing or the
// upstream call fails so the panel can still render the per-user log totals.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

interface ProviderResult {
  provider: "openai" | "anthropic";
  available: boolean;
  total_usd: number | null;
  currency: string;
  range: { start: string; end: string };
  error?: string;
  // Optional human readable note (e.g. "OpenAI billing API requires an admin API key").
  note?: string;
}

/**
 * OpenAI exposes per-day cost via /v1/organization/costs (Admin key required).
 * Falls back to /dashboard/billing/usage with a session key for orgs that haven't
 * migrated. We try the modern endpoint first; on 401/404 we surface a helpful note.
 */
async function fetchOpenAISpend(
  startISO: string,
  endISO: string,
): Promise<ProviderResult> {
  const key = Deno.env.get("OPENAI_ADMIN_KEY") || Deno.env.get("OPENAI_API_KEY");
  const result: ProviderResult = {
    provider: "openai",
    available: false,
    total_usd: null,
    currency: "USD",
    range: { start: startISO, end: endISO },
  };
  if (!key) {
    result.error = "OPENAI_API_KEY not configured";
    return result;
  }

  // Costs endpoint takes Unix seconds and returns usd cost buckets per day.
  const startUnix = Math.floor(new Date(startISO).getTime() / 1000);
  const endUnix = Math.floor(new Date(endISO).getTime() / 1000);

  try {
    const resp = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${startUnix}&end_time=${endUnix}&bucket_width=1d&limit=180`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (resp.ok) {
      const json: any = await resp.json();
      let total = 0;
      for (const bucket of json.data ?? []) {
        for (const r of bucket.results ?? []) {
          const amt = r?.amount?.value;
          if (typeof amt === "number") total += amt;
        }
      }
      result.available = true;
      result.total_usd = total;
      return result;
    }
    const txt = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      result.error =
        "OpenAI rejected the API key for billing access. Add an Admin API key as OPENAI_ADMIN_KEY to enable live spend.";
    } else if (resp.status === 404) {
      result.error =
        "OpenAI billing endpoint not available for this account.";
    } else {
      result.error = `OpenAI billing call failed (${resp.status}): ${txt.slice(0, 160)}`;
    }
  } catch (e) {
    result.error = `OpenAI billing call error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return result;
}

/**
 * Anthropic exposes per-day cost via /v1/organizations/usage_report/messages
 * (Admin key required, x-api-key header). For accounts without admin access we
 * surface a friendly note so the UI keeps rendering the per-user logs.
 */
async function fetchAnthropicSpend(
  startISO: string,
  endISO: string,
): Promise<ProviderResult> {
  const key = Deno.env.get("ANTHROPIC_ADMIN_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
  const result: ProviderResult = {
    provider: "anthropic",
    available: false,
    total_usd: null,
    currency: "USD",
    range: { start: startISO, end: endISO },
  };
  if (!key) {
    result.error =
      "Anthropic key not configured. Set ANTHROPIC_ADMIN_KEY to enable live spend.";
    return result;
  }

  try {
    const params = new URLSearchParams({
      starting_at: startISO,
      ending_at: endISO,
      bucket_width: "1d",
    });
    const resp = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`,
      {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      },
    );
    if (resp.ok) {
      const json: any = await resp.json();
      let total = 0;
      for (const bucket of json.data ?? []) {
        for (const r of bucket.results ?? []) {
          const amt = r?.amount?.value ?? r?.cost ?? null;
          if (typeof amt === "number") total += amt;
        }
      }
      result.available = true;
      result.total_usd = total;
      return result;
    }
    const txt = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      result.error =
        "Anthropic rejected the API key for billing access. Use an Admin key as ANTHROPIC_ADMIN_KEY.";
    } else if (resp.status === 404) {
      result.error = "Anthropic billing endpoint not available for this account.";
    } else {
      result.error = `Anthropic billing call failed (${resp.status}): ${txt.slice(0, 160)}`;
    }
  } catch (e) {
    result.error = `Anthropic billing call error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await adminClient.auth.getUser(token);
    if (!caller?.email || caller.email.toLowerCase() !== SUPER_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get("days") ?? "30", 10) || 30, 1),
      180,
    );
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);

    const [openai, anthropic] = await Promise.all([
      fetchOpenAISpend(start.toISOString(), end.toISOString()),
      fetchAnthropicSpend(start.toISOString(), end.toISOString()),
    ]);

    return new Response(
      JSON.stringify({
        days,
        fetched_at: new Date().toISOString(),
        providers: [openai, anthropic],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("live-ai-cost error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

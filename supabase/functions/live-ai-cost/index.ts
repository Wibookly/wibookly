// live-ai-cost
// Returns live spend totals from OpenAI and Anthropic billing APIs for a date range.
// Super-admin only. Falls back gracefully if a provider key is missing or the
// upstream call fails so the panel can still render the per-user log totals.
//
// Key resolution order (per provider):
//   1. Dedicated admin env secret  (OPENAI_ADMIN_KEY / ANTHROPIC_ADMIN_KEY)
//   2. Generic env secret          (OPENAI_API_KEY  / ANTHROPIC_API_KEY)
//   3. Admin-UI managed value      (api_key_config: openai_api_key / claude_api_key)
//
// IMPORTANT: OpenAI's /v1/organization/costs and Anthropic's
// /v1/organizations/cost_report endpoints both require **Admin** API keys
// (sk-admin-... for OpenAI, sk-ant-admin... for Anthropic). A regular project
// key will be rejected with 401. We surface a clear message in that case.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPER_ADMIN_EMAIL = "arahimi@energyforward.com";

interface UserBreakdown {
  user_id: string | null;     // OpenAI org-user id (not our app user_id)
  api_key_id?: string | null; // OpenAI api key id
  total_usd: number;
}

interface ProviderResult {
  provider: "openai" | "anthropic";
  available: boolean;
  total_usd: number | null;
  currency: string;
  range: { start: string; end: string };
  by_user?: UserBreakdown[];
  error?: string;
  note?: string;
}

async function resolveKey(
  adminClient: ReturnType<typeof createClient>,
  envNames: string[],
  dbKeyName: string,
): Promise<string | null> {
  for (const n of envNames) {
    const v = Deno.env.get(n);
    if (v && v.trim()) return v.trim();
  }
  try {
    const { data } = await adminClient
      .from("api_key_config")
      .select("encrypted_value")
      .eq("key_name", dbKeyName)
      .maybeSingle();
    const v = (data as { encrypted_value?: string } | null)?.encrypted_value;
    if (v && v.trim()) return v.trim();
  } catch (_) { /* ignore */ }
  return null;
}

async function fetchOpenAISpend(
  key: string | null,
  startISO: string,
  endISO: string,
): Promise<ProviderResult> {
  const result: ProviderResult = {
    provider: "openai",
    available: false,
    total_usd: null,
    currency: "USD",
    range: { start: startISO, end: endISO },
  };
  if (!key) {
    result.error =
      "OpenAI key not configured. Add an Admin API key (starts with sk-admin-...) in Admin → Settings, or set OPENAI_ADMIN_KEY.";
    return result;
  }

  const startUnix = Math.floor(new Date(startISO).getTime() / 1000);
  const endUnix = Math.floor(new Date(endISO).getTime() / 1000);

  try {
    // Group by user so we can attribute spend per OpenAI org user.
    const url =
      `https://api.openai.com/v1/organization/costs?start_time=${startUnix}&end_time=${endUnix}` +
      `&bucket_width=1d&limit=180&group_by=line_item`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (resp.ok) {
      const json: any = await resp.json();
      let total = 0;
      const perUser = new Map<string, number>();
      for (const bucket of json.data ?? []) {
        for (const r of bucket.results ?? []) {
          const amt = r?.amount?.value;
          if (typeof amt === "number") {
            total += amt;
            const u = r?.user_id ?? r?.line_item ?? null;
            if (u) perUser.set(u, (perUser.get(u) ?? 0) + amt);
          }
        }
      }
      result.available = true;
      result.total_usd = total;
      result.by_user = Array.from(perUser.entries()).map(([user_id, total_usd]) => ({
        user_id,
        total_usd,
      }));
      return result;
    }
    const txt = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      result.error =
        "OpenAI rejected the key. The billing endpoint requires an **Admin API key** (sk-admin-...). " +
        "Create one at platform.openai.com → Settings → Admin keys, then paste it in Admin → Settings → API Keys.";
    } else if (resp.status === 404) {
      result.error =
        "OpenAI billing endpoint not available for this account.";
    } else {
      result.error =
        `OpenAI billing call failed (${resp.status}): ${txt.slice(0, 200)}`;
    }
    console.warn("OpenAI billing failed", resp.status, txt.slice(0, 200));
  } catch (e) {
    result.error =
      `OpenAI billing call error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return result;
}

async function fetchAnthropicSpend(
  key: string | null,
  startISO: string,
  endISO: string,
): Promise<ProviderResult> {
  const result: ProviderResult = {
    provider: "anthropic",
    available: false,
    total_usd: null,
    currency: "USD",
    range: { start: startISO, end: endISO },
  };
  if (!key) {
    result.error =
      "Anthropic key not configured. Add an Admin API key (sk-ant-admin...) in Admin → Settings, or set ANTHROPIC_ADMIN_KEY.";
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
      const perUser = new Map<string, number>();
      for (const bucket of json.data ?? []) {
        for (const r of bucket.results ?? []) {
          const amt = r?.amount?.value ?? r?.cost ?? null;
          if (typeof amt === "number") {
            total += amt;
            const u = r?.workspace_id ?? r?.api_key_id ?? null;
            if (u) perUser.set(u, (perUser.get(u) ?? 0) + amt);
          }
        }
      }
      result.available = true;
      result.total_usd = total;
      result.by_user = Array.from(perUser.entries()).map(([user_id, total_usd]) => ({
        user_id,
        total_usd,
      }));
      return result;
    }
    const txt = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      result.error =
        "Anthropic rejected the key. The cost endpoint requires an **Admin API key** (sk-ant-admin...). " +
        "Create one at console.anthropic.com → Settings → Admin Keys, then paste it in Admin → Settings.";
    } else if (resp.status === 404) {
      result.error = "Anthropic billing endpoint not available for this account.";
    } else {
      result.error =
        `Anthropic billing call failed (${resp.status}): ${txt.slice(0, 200)}`;
    }
    console.warn("Anthropic billing failed", resp.status, txt.slice(0, 200));
  } catch (e) {
    result.error =
      `Anthropic billing call error: ${e instanceof Error ? e.message : String(e)}`;
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

    // Accept `days` from query string OR JSON body.
    const url = new URL(req.url);
    let daysRaw = url.searchParams.get("days");
    if (!daysRaw && (req.method === "POST" || req.method === "PUT")) {
      try {
        const body = await req.json();
        if (body?.days) daysRaw = String(body.days);
      } catch (_) { /* no body */ }
    }
    const days = Math.min(Math.max(parseInt(daysRaw ?? "30", 10) || 30, 1), 180);
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);

    const [openaiKey, anthropicKey] = await Promise.all([
      resolveKey(adminClient, ["OPENAI_ADMIN_KEY", "OPENAI_API_KEY"], "openai_api_key"),
      resolveKey(adminClient, ["ANTHROPIC_ADMIN_KEY", "ANTHROPIC_API_KEY"], "claude_api_key"),
    ]);

    console.log("live-ai-cost: keys resolved", {
      openai: openaiKey ? `${openaiKey.slice(0, 10)}…` : null,
      anthropic: anthropicKey ? `${anthropicKey.slice(0, 10)}…` : null,
      days,
    });

    const [openai, anthropic] = await Promise.all([
      fetchOpenAISpend(openaiKey, start.toISOString(), end.toISOString()),
      fetchAnthropicSpend(anthropicKey, start.toISOString(), end.toISOString()),
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

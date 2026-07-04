import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function client(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_priority_emails",
  title: "List priority emails",
  description: "List the signed-in user's open priority items from their inbox (needs-reply, decisions, big-3).",
  inputSchema: {
    limit: z.number().int().min(1).max(50).default(10).describe("Max items to return."),
    tier: z.enum(["big3", "decision", "focus", "auto", "any"]).default("any").describe("Filter by priority tier."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, tier }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = client(ctx)
      .from("helm_items")
      .select("id, subject, from_name, from_address, tier, score, created_at, ai_draft")
      .eq("status", "open")
      .order("score", { ascending: false })
      .limit(limit);
    if (tier !== "any") q = q.in("tier", [tier]);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});

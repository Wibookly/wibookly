import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { finalizeReply } from "./reply-guards.ts";

Deno.test("keeps reconnect response when there is a real auth tool failure", () => {
  const result = finalizeReply({
    finalText: "some other text",
    sawAuthToolFailure: true,
    sawSuccessfulDataTool: false,
    citationsLength: 0,
  });

  assertEquals(
    result,
    "I need you to reconnect your Microsoft 365 account from Integrations before I can access your email, files, or calendar. Once you've reconnected it, try again and I'll continue.",
  );
});

Deno.test("replaces hallucinated reconnect response after successful tool access", () => {
  const result = finalizeReply({
    finalText: "It looks like I need you to reconnect your account to access and search for the total Microsoft code invoice for this month.",
    sawAuthToolFailure: false,
    sawSuccessfulDataTool: true,
    citationsLength: 1,
  });

  assertEquals(
    result,
    "I searched your Microsoft 365 data, but I couldn't confirm the exact total from the results I found. Please give me a narrower vendor name, invoice number, sender, or date range and I'll keep digging.",
  );
});
import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";

const RECONNECT_RESPONSE_RE = /\b(reconnect|reauthoriz|re-authoriz|token expired|isn't connected|is not connected|connect your microsoft 365)\b/i;

function finalizeReply(input: {
  finalText: string;
  sawAuthToolFailure: boolean;
  sawSuccessfulDataTool: boolean;
  citationsLength: number;
}) {
  if (input.sawAuthToolFailure) {
    return "I need you to reconnect your Microsoft 365 account from Integrations before I can access your email, files, or calendar. Once you've reconnected it, try again and I'll continue.";
  }

  if (input.sawSuccessfulDataTool && RECONNECT_RESPONSE_RE.test(input.finalText || "")) {
    return input.citationsLength > 0
      ? "I searched your Microsoft 365 data, but I couldn't confirm the exact total from the results I found. Please give me a narrower vendor name, invoice number, sender, or date range and I'll keep digging."
      : "I searched your Microsoft 365 data, but I couldn't confirm the exact total yet. Please give me a narrower vendor name, invoice number, sender, or date range and I'll keep digging.";
  }

  return input.finalText;
}

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
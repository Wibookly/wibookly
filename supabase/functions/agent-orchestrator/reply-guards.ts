export const FRIENDLY_RECONNECT_MESSAGE = "I need you to reconnect your Microsoft 365 account from Integrations before I can access your email, files, or calendar. Once you've reconnected it, try again and I'll continue.";
export const RECONNECT_RESPONSE_RE = /\b(reconnect|reauthoriz|re-authoriz|token expired|isn't connected|is not connected|connect your microsoft 365)\b/i;

function hasNestedAuthFailure(result: any): boolean {
  const extracted = Array.isArray(result?.extracted) ? result.extracted : [];
  return extracted.some((item: any) => {
    const kind = item?.error_kind || item?.error?.kind;
    if (kind === "no_token" || kind === "unauthorized" || kind === "forbidden_scope") return true;

    const code = String(item?.error_code || item?.error?.code || "");
    const message = String(item?.error || item?.error?.message || "");
    return /\b(no_token|unauthorized|forbidden|access denied|not authorized|insufficient privileges)\b/i.test(`${code} ${message}`);
  });
}

export function isAuthRelatedToolError(result: any): boolean {
  const kind = result?.error?.kind;
  return kind === "no_token" || kind === "unauthorized" || kind === "forbidden_scope" || hasNestedAuthFailure(result);
}

export function looksLikeReconnectResponse(text: string): boolean {
  return RECONNECT_RESPONSE_RE.test(text || "");
}

export function finalizeReply(input: {
  finalText: string;
  sawAuthToolFailure: boolean;
  sawSuccessfulDataTool: boolean;
  citationsLength: number;
}) {
  if (input.sawAuthToolFailure) {
    return FRIENDLY_RECONNECT_MESSAGE;
  }

  if (input.sawSuccessfulDataTool && looksLikeReconnectResponse(input.finalText)) {
    return input.citationsLength > 0
      ? "I searched your Microsoft 365 data, but I couldn't confirm the exact total from the results I found. Please give me a narrower vendor name, invoice number, sender, or date range and I'll keep digging."
      : "I searched your Microsoft 365 data, but I couldn't confirm the exact total yet. Please give me a narrower vendor name, invoice number, sender, or date range and I'll keep digging.";
  }

  return input.finalText;
}
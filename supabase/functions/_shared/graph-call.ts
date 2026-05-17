// Shared Microsoft Graph caller.
// - Resolves a valid access token via getValidAccessToken (multi-account aware)
// - Logs every call to m365_api_health
// - Returns structured { ok, status, data, error } so tools can react
// deno-lint-ignore-file no-explicit-any
import { getValidAccessToken } from "./oauth-tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const restHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

export type GraphApiName = "mail" | "onedrive" | "sharepoint" | "calendar" | "user" | "auth";

async function logHealth(row: {
  user_id: string;
  connection_id: string | null;
  api_name: GraphApiName;
  status: "healthy" | "degraded" | "failed";
  endpoint?: string;
  response_ms?: number;
  error_code?: string | null;
  error_message?: string | null;
}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/m365_api_health`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify(row),
    });
  } catch { /* swallow */ }
}

export interface CallGraphResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  bytes?: Uint8Array;
  contentType?: string;
  error?: {
    code: string;
    message: string;
    kind: "no_token" | "unauthorized" | "forbidden_scope" | "rate_limited" | "not_found" | "other";
  };
}

/** Download raw bytes from Microsoft Graph. Endpoint is path-only. */
export async function callGraphBinary(
  userId: string,
  connectionId: string,
  apiName: GraphApiName,
  endpoint: string,
  maxBytes = 25 * 1024 * 1024,
): Promise<CallGraphResult<never>> {
  const token = await getValidAccessToken(userId, "outlook", connectionId);
  if (!token) {
    await logHealth({
      user_id: userId, connection_id: connectionId, api_name: apiName,
      status: "failed", endpoint, error_code: "NO_TOKEN",
      error_message: "No valid access token (locked or missing).",
    });
    return {
      ok: false, status: 0,
      error: { code: "NO_TOKEN", kind: "no_token",
        message: "Microsoft 365 isn't connected or the token expired. Please reconnect from Integrations." },
    };
  }
  const url = `https://graph.microsoft.com/v1.0${endpoint}`;
  const start = Date.now();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const ms = Date.now() - start;
    if (!res.ok) {
      const text = await res.text();
      let errCode = `HTTP_${res.status}`;
      let errMsg = text.slice(0, 500);
      try { const j = JSON.parse(text); errCode = j?.error?.code || errCode; errMsg = (j?.error?.message || errMsg).slice(0,500); } catch {}
      let kind: CallGraphResult["error"]["kind"] = "other";
      if (res.status === 401) kind = "unauthorized";
      else if (res.status === 403) kind = "forbidden_scope";
      else if (res.status === 404) kind = "not_found";
      else if (res.status === 429) kind = "rate_limited";
      await logHealth({
        user_id: userId, connection_id: connectionId, api_name: apiName,
        status: "failed", endpoint, response_ms: ms,
        error_code: errCode, error_message: errMsg,
      });
      return { ok: false, status: res.status, error: { code: errCode, kind, message: errMsg } };
    }
    const len = Number(res.headers.get("content-length") || "0");
    if (len && len > maxBytes) {
      await logHealth({
        user_id: userId, connection_id: connectionId, api_name: apiName,
        status: "failed", endpoint, response_ms: ms,
        error_code: "FILE_TOO_LARGE", error_message: `Content-Length ${len} > ${maxBytes}`,
      });
      return { ok: false, status: 413, error: { code: "FILE_TOO_LARGE", kind: "other", message: `File exceeds ${maxBytes} bytes` } };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      return { ok: false, status: 413, error: { code: "FILE_TOO_LARGE", kind: "other", message: `File exceeds ${maxBytes} bytes` } };
    }
    await logHealth({
      user_id: userId, connection_id: connectionId, api_name: apiName,
      status: "healthy", endpoint, response_ms: ms,
    });
    return { ok: true, status: res.status, bytes: buf, contentType: res.headers.get("content-type") || undefined };
  } catch (e: any) {
    const ms = Date.now() - start;
    const msg = String(e?.message ?? e).slice(0, 500);
    await logHealth({
      user_id: userId, connection_id: connectionId, api_name: apiName,
      status: "failed", endpoint, response_ms: ms,
      error_code: "NETWORK_ERROR", error_message: msg,
    });
    return { ok: false, status: 0, error: { code: "NETWORK_ERROR", kind: "other", message: msg } };
  }
}

/**
 * Call Microsoft Graph for a given user+connection. Endpoint is path-only (e.g. "/me/messages?...").
 */
export async function callGraph<T = any>(
  userId: string,
  connectionId: string,
  apiName: GraphApiName,
  endpoint: string,
  init?: RequestInit,
): Promise<CallGraphResult<T>> {
  const token = await getValidAccessToken(userId, "outlook", connectionId);
  if (!token) {
    await logHealth({
      user_id: userId, connection_id: connectionId, api_name: apiName,
      status: "failed", endpoint, error_code: "NO_TOKEN",
      error_message: "No valid access token (locked or missing).",
    });
    return {
      ok: false, status: 0,
      error: { code: "NO_TOKEN", kind: "no_token",
        message: "Microsoft 365 isn't connected or the token expired. Please reconnect from Integrations." },
    };
  }

  const url = `https://graph.microsoft.com/v1.0${endpoint}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const ms = Date.now() - start;
    const text = await res.text();
    let data: any = undefined;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }

    if (res.ok) {
      await logHealth({
        user_id: userId, connection_id: connectionId, api_name: apiName,
        status: "healthy", endpoint, response_ms: ms,
      });
      return { ok: true, status: res.status, data };
    }

    const errCode = data?.error?.code || `HTTP_${res.status}`;
    const errMsg = (data?.error?.message || text || "Graph error").slice(0, 500);
    let kind: CallGraphResult["error"]["kind"] = "other";
    if (res.status === 401) kind = "unauthorized";
    else if (res.status === 403) kind = "forbidden_scope";
    else if (res.status === 404) kind = "not_found";
    else if (res.status === 429) kind = "rate_limited";

    await logHealth({
      user_id: userId, connection_id: connectionId, api_name: apiName,
      status: "failed", endpoint, response_ms: ms,
      error_code: errCode, error_message: errMsg,
    });

    return {
      ok: false, status: res.status,
      error: { code: errCode, kind, message: errMsg },
    };
  } catch (e: any) {
    const ms = Date.now() - start;
    const msg = String(e?.message ?? e).slice(0, 500);
    await logHealth({
      user_id: userId, connection_id: connectionId, api_name: apiName,
      status: "failed", endpoint, response_ms: ms,
      error_code: "NETWORK_ERROR", error_message: msg,
    });
    return {
      ok: false, status: 0,
      error: { code: "NETWORK_ERROR", kind: "other", message: msg },
    };
  }
}

// Pre-flight Microsoft Graph probe.
// Hits cheap read-only endpoints to verify whether a token is actually
// unauthorized before we surface a "reconnect" prompt to the user. Prevents
// false reauth prompts caused by parser failures or transient errors.
import { getValidAccessToken } from "./oauth-tokens.ts";

export type ProbeResult = {
  ok: boolean;
  mail_status?: number;
  drive_status?: number;
  has_token: boolean;
  reason: "no_token" | "unauthorized" | "forbidden_scope" | "network" | "ok";
};

async function ping(token: string, path: string): Promise<number> {
  try {
    const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.status;
  } catch {
    return 0;
  }
}

export async function probeMicrosoftGraph(
  userId: string,
  connectionId?: string,
): Promise<ProbeResult> {
  const token = await getValidAccessToken(userId, "outlook", connectionId);
  if (!token) return { ok: false, has_token: false, reason: "no_token" };

  const [mailStatus, driveStatus] = await Promise.all([
    ping(token, "/me/messages?$top=1&$select=id"),
    ping(token, "/me/drive/root?$select=id"),
  ]);

  const allOk = mailStatus >= 200 && mailStatus < 300 && driveStatus >= 200 && driveStatus < 300;
  if (allOk) return { ok: true, has_token: true, mail_status: mailStatus, drive_status: driveStatus, reason: "ok" };
  if (mailStatus === 401 || driveStatus === 401)
    return { ok: false, has_token: true, mail_status: mailStatus, drive_status: driveStatus, reason: "unauthorized" };
  if (mailStatus === 403 || driveStatus === 403)
    return { ok: false, has_token: true, mail_status: mailStatus, drive_status: driveStatus, reason: "forbidden_scope" };
  return { ok: false, has_token: true, mail_status: mailStatus, drive_status: driveStatus, reason: "network" };
}

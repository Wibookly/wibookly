// Save a file to the connected user's OneDrive under "InboxIQ Chat".
// Uses the multi-account-aware token resolver and Graph's
// "PUT /me/drive/root:/{path}:/content" upload endpoint.
//
// Naming + versioning:
//   - Caller provides a base name (e.g. "Project Kickoff").
//   - We sanitize and place files under "/InboxIQ Chat/<safe-base>/<base>.<ext>".
//   - If a file with the same name already exists, we append " v2", " v3" …
//     until we find a free slot (best-effort, fire-and-forget on failure).
// deno-lint-ignore-file no-explicit-any
import { getValidAccessToken } from "./oauth-tokens.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const ROOT_FOLDER = "InboxIQ Chat";

export interface SaveResult {
  ok: boolean;
  webUrl?: string;
  path?: string;        // /drive/root:/InboxIQ Chat/...
  error?: string;
}

/** Make a string safe for a OneDrive file or folder segment. */
function sanitizeSegment(s: string): string {
  return (s || "untitled")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "untitled";
}

async function tokenOrNull(userId: string, connectionId: string): Promise<string | null> {
  try { return await getValidAccessToken(userId, "outlook", connectionId); } catch { return null; }
}

/** Returns the next non-conflicting filename (adds " v2", " v3" …). */
async function resolveUniqueName(
  token: string,
  folderPath: string,
  base: string,
  ext: string,
): Promise<string> {
  for (let v = 1; v <= 50; v++) {
    const name = v === 1 ? `${base}.${ext}` : `${base} v${v}.${ext}`;
    const url = `${GRAPH}/me/drive/root:/${encodeURI(folderPath)}/${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return name;
    if (!res.ok) return name; // be permissive — let upload try
  }
  return `${base} ${Date.now()}.${ext}`;
}

export interface SaveFileOptions {
  userId: string;
  connectionId: string;
  /** Base name without extension (e.g. conversation title). */
  baseName: string;
  /** File extension without dot (e.g. "md", "json", "pdf"). */
  ext: string;
  /** Raw bytes or string content. */
  content: Uint8Array | string;
  contentType: string;
  /** Optional sub-folder inside InboxIQ Chat (e.g. conversation id). */
  subfolder?: string;
  /** If true, overwrite the same filename instead of versioning. */
  overwrite?: boolean;
}

/** Upload a single file to OneDrive. Best-effort: never throws. */
export async function saveToOneDrive(opts: SaveFileOptions): Promise<SaveResult> {
  const token = await tokenOrNull(opts.userId, opts.connectionId);
  if (!token) return { ok: false, error: "No Microsoft 365 token (reconnect required)." };

  const safeBase = sanitizeSegment(opts.baseName);
  const sub = opts.subfolder ? `/${sanitizeSegment(opts.subfolder)}` : "";
  const folderPath = `${ROOT_FOLDER}${sub}`;

  const filename = opts.overwrite
    ? `${safeBase}.${opts.ext}`
    : await resolveUniqueName(token, folderPath, safeBase, opts.ext);

  const uploadUrl =
    `${GRAPH}/me/drive/root:/${encodeURI(folderPath)}/${encodeURIComponent(filename)}:/content`;

  const body = typeof opts.content === "string"
    ? new TextEncoder().encode(opts.content)
    : opts.content;

  try {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": opts.contentType,
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `OneDrive ${res.status}: ${txt.slice(0, 300)}` };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      webUrl: data?.webUrl,
      path: `/${ROOT_FOLDER}${sub}/${filename}`,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }
}

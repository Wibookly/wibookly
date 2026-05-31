import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Single short prefix for all InboxIQ-managed Outlook Master Categories.
// Keep this short — it shows on every email row in Outlook next to the
// category name (e.g. "IQ: Approvals").
const IQ_TAG_PREFIX = "IQ: ";

// ──────────────────────────────────────────────────────────────────────
// Invisible sort-order prefix for Outlook folders.
//
// Outlook sorts mail folders alphabetically by displayName and offers no
// API to set a manual order. To force the folders to appear in the same
// order as the app's category list, we prepend a short string of
// zero-width Unicode characters whose codepoints sort in the desired
// order. The prefix is invisible in every Outlook surface (Desktop, Web,
// Mobile) but participates in the lexicographic sort.
//
// We use a base-N positional encoding (N = ZW_ALPHABET.length) so the
// scheme scales beyond 10 categories without collisions.
// ──────────────────────────────────────────────────────────────────────
const ZW_ALPHABET = [
  "\u200B", // ZERO WIDTH SPACE
  "\u200C", // ZERO WIDTH NON-JOINER
  "\u200D", // ZERO WIDTH JOINER
  "\u2060", // WORD JOINER
  "\u2061", // FUNCTION APPLICATION
  "\u2062", // INVISIBLE TIMES
  "\u2063", // INVISIBLE SEPARATOR
  "\u2064", // INVISIBLE PLUS
  "\u2065", // (reserved, treated as invisible)
  "\u2066", // LEFT-TO-RIGHT ISOLATE
];
// Char-class matching every zero-width / invisible codepoint we may have
// ever placed at the start of a managed folder/label name. Used to strip
// the prefix when normalising names for dedup / lookup.
const ZW_PREFIX_RE = /^[\u200B-\u200F\u2060-\u206F\uFEFF]+/u;

// Build a stable invisible prefix string for the given 1-based sort
// position. Always pads to 2 invisible chars so positions sort correctly
// regardless of how many categories exist.
function invisibleSortPrefix(position: number): string {
  const n = Math.max(1, Math.floor(position || 1));
  const base = ZW_ALPHABET.length;
  // Convert to base-N digits (most-significant first), pad to width 2.
  const digits: number[] = [];
  let v = n - 1; // 0-indexed
  if (v === 0) {
    digits.push(0);
  } else {
    while (v > 0) {
      digits.unshift(v % base);
      v = Math.floor(v / base);
    }
  }
  while (digits.length < 2) digits.unshift(0);
  return digits.map((d) => ZW_ALPHABET[d]).join("");
}

// Strip any leading zero-width / invisible chars from an Outlook folder
// or category displayName so we can match against the clean app name.
function stripInvisiblePrefix(name: string): string {
  return String(name || "").replace(ZW_PREFIX_RE, "");
}

// Returns true if the given Outlook category name was created/managed by
// InboxIQ (current short prefix or any legacy variant) and should therefore
// be cleaned up before applying the current single category tag.
function isManagedCategoryName(name: string): boolean {
  if (!name) return false;
  const n = name.trim();
  // Current short prefix + every legacy variant InboxIQ has ever applied to
  // an Outlook message. Includes the numbered Gmail-style labels we used to
  // mirror onto Outlook ("02: Follow Up", "0. AI Draft", "11. AI Sent") so
  // each email ends up with exactly ONE current "IQ: <Category>" chip.
  if (
    n.startsWith("IQ: ") ||
    n.startsWith("★ IQ: ") ||
    n.startsWith("InboxIQ: ") ||
    n.startsWith("★ InboxIQ: ") ||
    n.startsWith("Wibookly: ") ||
    n.startsWith("vBookly: ") ||
    n.startsWith("Vbookly: ")
  )
    return true;
  // AI Draft / AI Sent helper tags — never expose these in Outlook.
  if (/^\d+\.\s*AI\s+(Draft|Sent)\b/i.test(n)) return true;
  if (/^AI\s+(Draft|Sent)\b/i.test(n)) return true;
  // Numbered category mirrors like "02: Follow Up", "10: FYI", or the
  // current "⭐ 02: Follow Up" / "🔴 02: Follow Up" prefixed variants.
  if (/^\s*(?:[⭐★]|\p{Extended_Pictographic})?\s*\d{1,2}:\s/u.test(n))
    return true;
  return false;
}

// Map a hex color to the nearest colored Unicode dot — used to prefix folder
// names so each category shows its color even on Outlook Web / Mac, where the
// PowerShell setup script can't run.
const COLOR_DOTS_SYNC: { dot: string; hex: string }[] = [
  { dot: "🔴", hex: "#E81123" },
  { dot: "🟠", hex: "#F7630C" },
  { dot: "🟡", hex: "#FFB900" },
  { dot: "🟢", hex: "#107C10" },
  { dot: "🔵", hex: "#0078D4" },
  { dot: "🟣", hex: "#5C2D91" },
  { dot: "🟤", hex: "#A4262C" },
  { dot: "⚫", hex: "#000000" },
  { dot: "⚪", hex: "#737373" },
];
function nearestColorDot(hex: string): string {
  const h = (hex || "#737373").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  let best = COLOR_DOTS_SYNC[0];
  let bestDist = Infinity;
  for (const c of COLOR_DOTS_SYNC) {
    const ch = c.hex.replace("#", "");
    const cr = parseInt(ch.slice(0, 2), 16);
    const cg = parseInt(ch.slice(2, 4), 16);
    const cb = parseInt(ch.slice(4, 6), 16);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.dot;
}

function normalizeManagedCategoryName(value: string): string {
  return String(value || "")
    .replace(ZW_PREFIX_RE, "") // strip invisible sort-order prefix
    .replace(/^\s*(?:[⭐★]|\p{Extended_Pictographic})\s*/u, "")
    .replace(/^\s*\d+\s*[:.\-]\s*/u, "")
    .trim()
    .toLowerCase();
}

// AES-GCM decryption for tokens (server-side only)
async function decryptToken(
  encryptedData: string,
  keyString: string,
): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, "0").slice(0, 32));

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );

  return new TextDecoder().decode(decrypted);
}

// AES-GCM encryption for tokens
async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, "0").slice(0, 32));

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(token),
  );

  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

// Refresh Google access token using refresh token
async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  console.log("Refreshing Google access token...");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    console.error("Failed to refresh Google token:", await response.text());
    return null;
  }

  const tokens = await response.json();
  console.log("Successfully refreshed Google token");
  return tokens;
}

// Refresh Microsoft access token using refresh token
async function refreshMicrosoftToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
} | null> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");

  console.log("Refreshing Microsoft access token...");

  const response = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId!,
        client_secret: clientSecret!,
        grant_type: "refresh_token",
      }),
    },
  );

  if (!response.ok) {
    console.error("Failed to refresh Microsoft token:", await response.text());
    return null;
  }

  const tokens = await response.json();
  console.log("Successfully refreshed Microsoft token");
  return tokens;
}

interface TokenData {
  provider: string;
  connection_id: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

function normalizeMailboxProvider(provider: string | null | undefined): string {
  const normalized = String(provider || "").trim().toLowerCase();
  return normalized === "microsoft" ? "outlook" : normalized;
}

function pickTokenForConnection(
  tokens: TokenData[],
  connectionId: string,
  provider: string,
  providerConnectionCount: number,
): TokenData | null {
  const normalizedProvider = normalizeMailboxProvider(provider);

  const exactMatch = tokens.find(
    (token) =>
      token.connection_id === connectionId &&
      normalizeMailboxProvider(token.provider) === normalizedProvider,
  );
  if (exactMatch) return exactMatch;

  if (providerConnectionCount === 1) {
    return (
      tokens.find(
        (token) =>
          !token.connection_id &&
          normalizeMailboxProvider(token.provider) === normalizedProvider,
      ) ?? null
    );
  }

  return null;
}

// Get valid access token, refreshing if expired
// deno-lint-ignore no-explicit-any
async function getValidAccessToken(
  tokenData: TokenData,
  encryptionKey: string,
  supabaseAdmin: any,
  userId: string,
): Promise<string | null> {
  const isExpired =
    tokenData.expires_at && new Date(tokenData.expires_at) < new Date();

  // If not expired, return decrypted access token
  if (!isExpired) {
    return await decryptToken(tokenData.encrypted_access_token, encryptionKey);
  }

  console.log(
    `Token for ${tokenData.provider} is expired, attempting refresh...`,
  );

  // Need to refresh - check if we have a refresh token
  if (!tokenData.encrypted_refresh_token) {
    console.error(`No refresh token available for ${tokenData.provider}`);
    return null;
  }

  const refreshToken = await decryptToken(
    tokenData.encrypted_refresh_token,
    encryptionKey,
  );
  let newTokens;

  if (tokenData.provider === "google") {
    newTokens = await refreshGoogleToken(refreshToken);
  } else if (
    tokenData.provider === "microsoft" ||
    tokenData.provider === "outlook"
  ) {
    newTokens = await refreshMicrosoftToken(refreshToken);
  }

  if (!newTokens) {
    console.error(`Failed to refresh token for ${tokenData.provider}`);
    return null;
  }

  // Encrypt and save new tokens
  const encryptedAccessToken = await encryptToken(
    newTokens.access_token,
    encryptionKey,
  );
  const expiresAt = new Date(
    Date.now() + newTokens.expires_in * 1000,
  ).toISOString();

  // Update token in vault using direct fetch to avoid type issues
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const updatePayload: Record<string, string> = {
    encrypted_access_token: encryptedAccessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  // Microsoft may return a new refresh token
  if (
    (tokenData.provider === "microsoft" || tokenData.provider === "outlook") &&
    "refresh_token" in newTokens &&
    newTokens.refresh_token
  ) {
    updatePayload.encrypted_refresh_token = await encryptToken(
      String(newTokens.refresh_token),
      encryptionKey,
    );
  }

  const tokenRowFilter = tokenData.connection_id
    ? `user_id=eq.${userId}&provider=eq.${tokenData.provider}&connection_id=eq.${tokenData.connection_id}`
    : `user_id=eq.${userId}&provider=eq.${tokenData.provider}&connection_id=is.null`;

  const updateResponse = await fetch(
    `${supabaseUrl}/rest/v1/oauth_token_vault?${tokenRowFilter}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(updatePayload),
    },
  );

  if (!updateResponse.ok) {
    console.error(
      `Failed to save refreshed token for ${tokenData.provider}:`,
      await updateResponse.text(),
    );
  } else {
    console.log(`Saved refreshed token for ${tokenData.provider}`);
  }

  return newTokens.access_token;
}

// Convert hex color to Gmail color palette (Gmail only supports specific colors)
function hexToGmailColor(hex: string): {
  backgroundColor: string;
  textColor: string;
} {
  // Gmail only allows specific color values from their palette
  // Map common colors to Gmail's supported palette
  const colorMap: Record<
    string,
    { backgroundColor: string; textColor: string }
  > = {
    // Reds
    "#EF4444": { backgroundColor: "#cc3a21", textColor: "#ffffff" },
    "#DC2626": { backgroundColor: "#cc3a21", textColor: "#ffffff" },
    "#B91C1C": { backgroundColor: "#ac2b16", textColor: "#ffffff" },
    // Oranges
    "#F97316": { backgroundColor: "#f2a600", textColor: "#000000" },
    "#EA580C": { backgroundColor: "#cf8933", textColor: "#000000" },
    // Yellows
    "#EAB308": { backgroundColor: "#f2c960", textColor: "#000000" },
    "#FACC15": { backgroundColor: "#f2c960", textColor: "#000000" },
    // Greens
    "#22C55E": { backgroundColor: "#149e60", textColor: "#ffffff" },
    "#16A34A": { backgroundColor: "#0d804f", textColor: "#ffffff" },
    // Teals
    "#14B8A6": { backgroundColor: "#2da2bb", textColor: "#ffffff" },
    "#06B6D4": { backgroundColor: "#2da2bb", textColor: "#ffffff" },
    // Blues
    "#3B82F6": { backgroundColor: "#285bac", textColor: "#ffffff" },
    "#2563EB": { backgroundColor: "#1a73e8", textColor: "#ffffff" },
    // Purples
    "#8B5CF6": { backgroundColor: "#653e9b", textColor: "#ffffff" },
    "#7C3AED": { backgroundColor: "#653e9b", textColor: "#ffffff" },
    // Pinks
    "#EC4899": { backgroundColor: "#c9649b", textColor: "#ffffff" },
    "#DB2777": { backgroundColor: "#c9649b", textColor: "#ffffff" },
    // Grays
    "#6B7280": { backgroundColor: "#666666", textColor: "#ffffff" },
    "#9CA3AF": { backgroundColor: "#999999", textColor: "#000000" },
  };

  const upperHex = hex.toUpperCase();
  if (colorMap[upperHex]) return colorMap[upperHex];

  // Default fallback - parse hex and find closest match
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Simple heuristic: map to closest category
  if (r > 180 && g < 100 && b < 100)
    return { backgroundColor: "#cc3a21", textColor: "#ffffff" }; // Red
  if (r > 180 && g > 100 && g < 180)
    return { backgroundColor: "#f2a600", textColor: "#000000" }; // Orange
  if (r > 180 && g > 180)
    return { backgroundColor: "#f2c960", textColor: "#000000" }; // Yellow
  if (g > r && g > b)
    return { backgroundColor: "#149e60", textColor: "#ffffff" }; // Green
  if (b > r && b > 150)
    return { backgroundColor: "#285bac", textColor: "#ffffff" }; // Blue
  if (r > 100 && b > 100 && g < 100)
    return { backgroundColor: "#653e9b", textColor: "#ffffff" }; // Purple

  return { backgroundColor: "#666666", textColor: "#ffffff" }; // Default gray
}

// Create Gmail label with color
async function createGmailLabel(
  accessToken: string,
  labelName: string,
  hexColor: string,
): Promise<boolean> {
  try {
    // Check if label already exists
    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!listRes.ok) {
      console.error("Failed to list Gmail labels:", await listRes.text());
      return false;
    }

    const { labels } = await listRes.json();
    const targetCore = normalizeManagedCategoryName(labelName);
    const matchingLabels = (labels || []).filter(
      (l: { name: string }) =>
        normalizeManagedCategoryName(l.name) === targetCore,
    );
    const existingLabel =
      matchingLabels.find((l: { name: string }) => l.name === labelName) ||
      matchingLabels[0];
    const gmailColor = hexToGmailColor(hexColor);

    if (existingLabel) {
      console.log(
        `Gmail label "${existingLabel.name}" already exists, updating to "${labelName}"...`,
      );
      const updateRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/labels/${existingLabel.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: labelName,
            color: gmailColor,
          }),
        },
      );

      if (!updateRes.ok) {
        console.error(
          `Failed to update Gmail label color:`,
          await updateRes.text(),
        );
      } else {
        console.log(`Updated color for Gmail label: ${labelName}`);
      }

      return true;
    }

    // Create the label with color
    const createRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
          color: gmailColor,
        }),
      },
    );

    if (!createRes.ok) {
      console.error(
        `Failed to create Gmail label "${labelName}":`,
        await createRes.text(),
      );
      return false;
    }

    console.log(`Created Gmail label with color: ${labelName}`);
    return true;
  } catch (error) {
    console.error(`Error creating Gmail label "${labelName}":`, error);
    return false;
  }
}

// Move all messages with this Gmail label back to Inbox, then delete the label.
// Gmail keeps the message in INBOX automatically when we just remove the custom label;
// but if INBOX was removed (label-as-folder behaviour), we add it back explicitly.
async function deleteGmailLabel(
  accessToken: string,
  labelName: string,
): Promise<boolean> {
  try {
    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!listRes.ok) return false;

    const { labels } = await listRes.json();
    const targetCore = normalizeManagedCategoryName(labelName);
    const matchingLabels = (labels || []).filter(
      (l: { name: string }) =>
        normalizeManagedCategoryName(l.name) === targetCore,
    );

    if (matchingLabels.length === 0) {
      console.log(
        `Gmail label "${labelName}" doesn't exist, nothing to delete`,
      );
      return true;
    }

    let allOk = true;
    for (const label of matchingLabels) {
      try {
        let pageToken: string | undefined = undefined;
        let movedTotal = 0;
        do {
          const url = new URL(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
          );
          url.searchParams.set("labelIds", label.id);
          url.searchParams.set("maxResults", "500");
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          const msgRes = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!msgRes.ok) break;
          const { messages, nextPageToken } = await msgRes.json();
          if (messages?.length) {
            const ids = messages.map((m: { id: string }) => m.id);
            const modRes = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  ids,
                  addLabelIds: ["INBOX"],
                  removeLabelIds: [label.id],
                }),
              },
            );
            if (modRes.ok) movedTotal += ids.length;
            else
              console.error(
                `batchModify failed for "${label.name}":`,
                await modRes.text(),
              );
          }
          pageToken = nextPageToken;
        } while (pageToken);
        if (movedTotal > 0)
          console.log(
            `Moved ${movedTotal} message(s) from "${label.name}" back to Inbox`,
          );
      } catch (moveErr) {
        console.error(`Error moving messages out of "${label.name}":`, moveErr);
      }

      const deleteRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/labels/${label.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!deleteRes.ok && deleteRes.status !== 404) {
        console.error(
          `Failed to delete Gmail label "${label.name}":`,
          await deleteRes.text(),
        );
        allOk = false;
      } else {
        console.log(`Deleted Gmail label: ${label.name}`);
      }
    }

    return allOk;
  } catch (error) {
    console.error(`Error deleting Gmail label "${labelName}":`, error);
    return false;
  }
}

// Move every message inside an Outlook folder to the Inbox, paginating through results.
async function emptyOutlookFolderToInbox(
  accessToken: string,
  folderId: string,
  folderName: string,
): Promise<number> {
  // Resolve the well-known Inbox id once
  let inboxId = "inbox";
  try {
    const inboxRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (inboxRes.ok) {
      const j = await inboxRes.json();
      if (j?.id) inboxId = j.id;
    }
  } catch {
    /* fall back to 'inbox' alias */
  }

  let movedTotal = 0;
  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$select=id&$top=50`;

  while (nextLink) {
    const res: Response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error(
        `Failed to list messages in "${folderName}":`,
        await res.text(),
      );
      break;
    }
    const data = await res.json();
    const messages: Array<{ id: string }> = data?.value ?? [];
    for (const m of messages) {
      const moveRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${m.id}/move`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId: inboxId }),
        },
      );
      if (moveRes.ok) movedTotal++;
      else
        console.error(`Move failed for message ${m.id}:`, await moveRes.text());
    }
    nextLink = data?.["@odata.nextLink"] ?? null;
  }

  if (movedTotal > 0)
    console.log(
      `Moved ${movedTotal} message(s) from "${folderName}" back to Inbox`,
    );
  return movedTotal;
}

async function moveOutlookFolderMessages(
  accessToken: string,
  sourceFolderId: string,
  sourceFolderName: string,
  destinationFolderId: string,
  destinationFolderName: string,
): Promise<number> {
  let movedTotal = 0;
  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/${sourceFolderId}/messages?$select=id&$top=50`;

  while (nextLink) {
    const res: Response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error(
        `Failed to list messages in "${sourceFolderName}":`,
        await res.text(),
      );
      break;
    }

    const data = await res.json();
    const messages: Array<{ id: string }> = data?.value ?? [];
    for (const message of messages) {
      const moveRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${message.id}/move`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId: destinationFolderId }),
        },
      );

      if (moveRes.ok) movedTotal++;
      else
        console.error(
          `Move failed for message ${message.id} into "${destinationFolderName}":`,
          await moveRes.text(),
        );
    }

    nextLink = data?.["@odata.nextLink"] ?? null;
  }

  if (movedTotal > 0) {
    console.log(
      `Moved ${movedTotal} message(s) from "${sourceFolderName}" into "${destinationFolderName}"`,
    );
  }

  return movedTotal;
}

// Delete every Outlook server-side messageRule whose name targets the given
// label (e.g. "02: Follow Up"). We match the InboxIQ-managed rule name shape
// `InboxIQ: <label> - <type>:<value>` so we don't touch unrelated user rules.
async function deleteOutlookRulesForLabel(
  accessToken: string,
  labelName: string,
): Promise<number> {
  try {
    const listRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) return 0;
    const { value } = await listRes.json();
    let deleted = 0;
    const labelLower = labelName.toLowerCase();
    const baseLower = normalizeManagedCategoryName(labelName);
    for (const r of value || []) {
      const name = String(r.displayName || "");
      const nameLower = name.toLowerCase();
      const isManaged =
        nameLower.startsWith("inboxiq:") ||
        nameLower.startsWith("wibookly:") ||
        nameLower.startsWith("vbookly:");
      if (!isManaged) continue;
      // Must reference this category label (with or without numeric prefix).
      if (!nameLower.includes(labelLower) && !nameLower.includes(baseLower))
        continue;
      const delRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules/${r.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (delRes.ok || delRes.status === 404) deleted++;
    }
    if (deleted > 0)
      console.log(
        `Deleted ${deleted} Outlook rule(s) for label "${labelName}"`,
      );
    return deleted;
  } catch (err) {
    console.warn(`deleteOutlookRulesForLabel failed for "${labelName}":`, err);
    return 0;
  }
}

// Delete Outlook folder — also removes ALL legacy/duplicate variants
// (e.g., deleting "01: Urgent" also clears stray "1: Urgent", "1. Urgent",
// or unnumbered "Urgent" folders so the mailbox stays clean).
// IMPORTANT: never deletes the special unprefixed "Follow-up" tracker folder
// used by cron-follow-ups; numbered "02: Follow Up" categories ARE deletable.
async function deleteOutlookFolder(
  accessToken: string,
  folderName: string,
): Promise<boolean> {
  try {
    const listRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!listRes.ok) return false;

    const { value: folders } = await listRes.json();
    // Strip optional leading favorite glyph (⭐ or ★) plus the numeric prefix
    // so dedup matches across legacy "01: Name" and current "⭐ 01: Name".
    const hasNumericPrefix = (s: string) =>
      /^\s*(?:[⭐★]|\p{Extended_Pictographic})?\s*\d+\s*[:.\-]/u.test(s);
    // Detect a leading emoji/colored-dot prefix (current label format "🟠 Name").
    const hasEmojiPrefix = (s: string) =>
      /^\s*(?:[⭐★]|\p{Extended_Pictographic})\s+/u.test(s);
    const stripPrefix = (s: string) => normalizeManagedCategoryName(s);
    // Also strip Outlook's duplicate-name suffix (e.g. "Follow Up1",
    // "Follow Up 2", "Follow Up (3)") so we catch stray duplicates Outlook
    // auto-creates when a folder briefly already existed.
    const stripDupSuffix = (s: string) =>
      s.replace(/\s*\(?\d+\)?\s*$/u, "").trim();
    const targetCore = stripPrefix(folderName);
    const targetCoreNoDup = stripDupSuffix(targetCore);
    const targetHasDupSuffix = targetCoreNoDup !== targetCore;

    // Protected folders we must NEVER delete: ONLY the dedicated hyphenated
    // "Follow-up" tracker folder used by cron-follow-ups. The unprefixed
    // "Follow Up" / "No Reply Tracker" folders ARE managed category folders
    // and MUST be deletable when the user disables them.
    const PROTECTED_UNPREFIXED = new Set([
      "follow-up",
    ]);

    // Match every folder whose normalized name equals our target (or whose
    // duplicate-suffix-stripped name equals it). For each match, only skip
    // the unprefixed hyphenated tracker folder.
    const matches = (folders ?? [])
      .filter((f: { id: string; displayName: string }) => {
        const core = stripPrefix(f.displayName);
        const coreNoDup = stripDupSuffix(core);
        const candidateHasDupSuffix = coreNoDup !== core;
        return (
          core === targetCore ||
          (coreNoDup === targetCoreNoDup &&
            (!targetHasDupSuffix || candidateHasDupSuffix))
        );
      })
      .filter((f: { displayName: string }) => {
        const isPrefixed =
          hasNumericPrefix(f.displayName) || hasEmojiPrefix(f.displayName);
        if (
          !isPrefixed &&
          PROTECTED_UNPREFIXED.has(stripPrefix(f.displayName))
        ) {
          console.log(
            `Skipping protected unprefixed folder "${f.displayName}"`,
          );
          return false;
        }
        return true;
      });

    if (matches.length === 0) {
      console.log(
        `Outlook folder matching "${folderName}" doesn't exist, nothing to delete`,
      );
      return true;
    }

    let allOk = true;
    for (const f of matches) {
      // First move any remaining messages back to Inbox so the user doesn't lose mail
      try {
        await emptyOutlookFolderToInbox(accessToken, f.id, f.displayName);
      } catch (moveErr) {
        console.error(`Error emptying "${f.displayName}":`, moveErr);
      }
      const deleteRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${f.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!deleteRes.ok && deleteRes.status !== 404) {
        console.error(
          `Failed to delete Outlook folder "${f.displayName}":`,
          await deleteRes.text(),
        );
        allOk = false;
      } else {
        console.log(`Deleted Outlook folder: ${f.displayName}`);
      }
    }
    return allOk;
  } catch (error) {
    console.error(`Error deleting Outlook folder "${folderName}":`, error);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Outlook Master Categories: the only API-surfaced way to show a color in
// the Outlook UI. Folders themselves cannot be colored via Graph (Microsoft
// limitation). We create a Master Category that mirrors each app category's
// color, then tag every message that lives inside the folder with it so
// the colored stripe shows next to the email subject in Outlook.
// ────────────────────────────────────────────────────────────────────────
// Hex values below are the colors Outlook actually RENDERS for each preset
// across Web, Desktop, and Mobile (iOS/Android) — sourced from the official
// Outlook category color swatches. Using these values (instead of arbitrary
// approximations) makes the nearest-color match align with what users see on
// every Outlook client, including iPhone where the palette is most limited.
const OUTLOOK_PRESET_COLORS: Array<{
  preset: string;
  hex: [number, number, number];
}> = [
  { preset: "preset0", hex: [0xe8, 0x11, 0x23] }, // Red
  { preset: "preset1", hex: [0xf7, 0x63, 0x0c] }, // Orange
  { preset: "preset2", hex: [0x85, 0x57, 0x23] }, // Brown
  { preset: "preset3", hex: [0xff, 0xb9, 0x00] }, // Yellow
  { preset: "preset4", hex: [0x49, 0x82, 0x05] }, // Green
  { preset: "preset5", hex: [0x00, 0xb2, 0x94] }, // Teal
  { preset: "preset6", hex: [0x7a, 0x75, 0x74] }, // Olive
  { preset: "preset7", hex: [0x00, 0x78, 0xd4] }, // Blue
  { preset: "preset8", hex: [0x5c, 0x2d, 0x91] }, // Purple
  { preset: "preset9", hex: [0xe3, 0x00, 0x8c] }, // Cranberry / Pink
  { preset: "preset10", hex: [0x51, 0x5c, 0x6b] }, // Steel
  { preset: "preset11", hex: [0x4a, 0x54, 0x59] }, // DarkSteel
  { preset: "preset12", hex: [0x69, 0x79, 0x7e] }, // Gray
  { preset: "preset13", hex: [0x39, 0x39, 0x39] }, // DarkGray
  { preset: "preset14", hex: [0x00, 0x00, 0x00] }, // Black
  { preset: "preset15", hex: [0xa4, 0x26, 0x2c] }, // DarkRed
  { preset: "preset16", hex: [0xca, 0x50, 0x10] }, // DarkOrange
  { preset: "preset17", hex: [0x4c, 0x2a, 0x0a] }, // DarkBrown
  { preset: "preset18", hex: [0xc1, 0x9c, 0x00] }, // DarkYellow
  { preset: "preset19", hex: [0x0b, 0x6a, 0x0b] }, // DarkGreen
  { preset: "preset20", hex: [0x03, 0x83, 0x87] }, // DarkTeal
  { preset: "preset21", hex: [0x52, 0x5c, 0x36] }, // DarkOlive
  { preset: "preset22", hex: [0x00, 0x3f, 0x87] }, // DarkBlue
  { preset: "preset23", hex: [0x32, 0x14, 0x5a] }, // DarkPurple
  { preset: "preset24", hex: [0x5c, 0x00, 0x5c] }, // DarkCranberry
];

// Perceptual color distance using weighted RGB (approximates CIE76 well enough
// for palette matching while staying dependency-free). Gives much better
// hue-matching than plain Euclidean — important for distinguishing the
// multiple blues/purples Outlook ships in its preset palette.
function colorDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return (
    (((512 + rmean) * dr * dr) >> 8) +
    4 * dg * dg +
    (((767 - rmean) * db * db) >> 8)
  );
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function nearestOutlookPreset(
  hex: string,
  excluded: Set<string> = new Set(),
): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "preset7";
  let best = OUTLOOK_PRESET_COLORS[0];
  let bestDist = Infinity;
  for (const p of OUTLOOK_PRESET_COLORS) {
    if (excluded.has(p.preset)) continue;
    const d = colorDistance(rgb, p.hex);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best.preset;
}

// Build a per-sync map of category-name → preset that guarantees no two
// categories collapse to the same Outlook preset color (when the user has ≤25
// categories). Without this, similar app-side colors (two purples, two blues)
// would render identically on Outlook mobile.
function buildOutlookPresetMap(
  categories: Array<{ name: string; color: string }>,
): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  // Sort by descending saturation so the most "distinctive" colors get first
  // pick of their ideal preset; neutrals fall back to whatever remains.
  const ranked = [...categories]
    .map((c) => {
      const rgb = hexToRgb(c.color) || [128, 128, 128];
      const max = Math.max(...rgb);
      const min = Math.min(...rgb);
      const sat = max === 0 ? 0 : (max - min) / max;
      return { c, sat };
    })
    .sort((a, b) => b.sat - a.sat);
  for (const { c } of ranked) {
    const excluded = used.size < OUTLOOK_PRESET_COLORS.length
      ? used
      : new Set<string>();
    const preset = nearestOutlookPreset(c.color, excluded);
    result[c.name] = preset;
    used.add(preset);
  }
  return result;
}

async function ensureOutlookMasterCategory(
  accessToken: string,
  displayName: string,
  hexColor: string,
  presetOverride?: string,
): Promise<boolean> {
  try {
    const preset = presetOverride ?? nearestOutlookPreset(hexColor);
    const listRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) {
      console.warn(
        "listMasterCategories failed:",
        (await listRes.text()).slice(0, 200),
      );
      return false;
    }
    const { value } = await listRes.json();
    const existing = (value || []).find(
      (c: { displayName: string; id: string; color: string }) =>
        c.displayName === displayName,
    );
    if (existing) {
      if (existing.color === preset) return true;
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/outlook/masterCategories/${existing.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ color: preset }),
        },
      );
      return patchRes.ok;
    }
    const createRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ displayName, color: preset }),
      },
    );
    return createRes.ok;
  } catch (err) {
    console.warn("ensureOutlookMasterCategory failed:", err);
    return false;
  }
}

// Delete a single Outlook Master Category by displayName (no-op if missing).
async function deleteOutlookMasterCategory(
  accessToken: string,
  displayName: string,
): Promise<boolean> {
  try {
    const listRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) return false;
    const { value } = await listRes.json();
    const existing = (value || []).find(
      (c: { displayName: string; id: string }) => c.displayName === displayName,
    );
    if (!existing) return true;
    const delRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/outlook/masterCategories/${existing.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return delRes.ok;
  } catch (err) {
    console.warn("deleteOutlookMasterCategory failed:", err);
    return false;
  }
}

// colored Master Category so existing emails — not just new arrivals — show
// the color stripe in Outlook.
async function tagOutlookFolderMessages(
  accessToken: string,
  folderId: string,
  categoryName: string,
  maxMessages = 200,
): Promise<number> {
  let tagged = 0;
  try {
    const listRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=${maxMessages}&$select=id,categories`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) return 0;
    const { value: messages } = await listRes.json();
    for (const m of messages ?? []) {
      const existing: string[] = Array.isArray(m.categories)
        ? m.categories
        : [];
      // Strip ALL InboxIQ-managed tags (current + legacy) so each email ends
      // up with exactly one IQ category — eliminates duplicates like
      // "InboxIQ: Approvals" + "★ InboxIQ: Approvals" + "IQ: Approvals".
      const preserved = existing.filter((c) => !isManagedCategoryName(c));
      const next = [...preserved, categoryName];
      // Skip the PATCH if nothing actually changes.
      if (
        existing.length === next.length &&
        existing.every((c, i) => c === next[i])
      ) {
        continue;
      }
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${m.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ categories: next }),
        },
      );
      if (patchRes.ok) tagged++;
    }
  } catch (err) {
    console.warn(`tagOutlookFolderMessages(${categoryName}) failed:`, err);
  }
  return tagged;
}

// Look up an Outlook folder ID by displayName (handles numeric prefix and
// invisible zero-width sort-prefix variants).
async function findOutlookFolderId(
  accessToken: string,
  folderName: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const { value: folders } = await res.json();
    const exact = (folders ?? []).find(
      (f: { displayName: string; id: string }) => f.displayName === folderName,
    );
    if (exact?.id) return exact.id;
    const target = normalizeManagedCategoryName(folderName);
    const fuzzy = (folders ?? []).find(
      (f: { displayName: string; id: string }) =>
        normalizeManagedCategoryName(f.displayName) === target,
    );
    return fuzzy?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort: ask Microsoft Graph to pin (or unpin) the given mail folder
 * in the Outlook **Favorites** pane.
 *
 * Microsoft Graph does NOT have an officially documented endpoint for the
 * Favorites pane on consumer/business mailboxes — it is stored in a
 * client-side roaming configuration item ("OWA.UserOptions") that is not
 * mutable via the public REST API. This function tries the beta endpoint
 * exposed on some tenants (`/me/mailFolders/{id}` with `isHidden`/
 * `isFavorite` properties) and silently no-ops on failure. The UI tooltip
 * already explains the manual fallback to the user.
 *
 * Returns `true` on a successful API write, `false` otherwise.
 */
async function setOutlookFolderFavorite(
  accessToken: string,
  folderId: string,
  favorite: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/beta/me/mailFolders/${folderId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        // `isFavorite` is recognised by Graph beta on some tenants; older
        // tenants ignore it without error. We always send `isHidden:false`
        // so a previously-hidden folder is also resurfaced.
        body: JSON.stringify({ isFavorite: favorite, isHidden: false }),
      },
    );
    if (!res.ok) {
      console.warn(
        `setOutlookFolderFavorite(${favorite}) PATCH failed [${res.status}]:`,
        await res.text(),
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn("setOutlookFolderFavorite error:", e);
    return false;
  }
}
async function createOutlookFolder(
  accessToken: string,
  folderName: string,
): Promise<boolean> {
  try {
    // Check if folder already exists; pull a wide page so we see all of them
    const listRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!listRes.ok) {
      console.error("Failed to list Outlook folders:", await listRes.text());
      return false;
    }

    const { value: folders } = await listRes.json();

    // Strip the numeric prefix ("01: ", "1: ", "11. ") so duplicates match
    const stripPrefix = (s: string) => normalizeManagedCategoryName(s);
    const targetCore = stripPrefix(folderName);

    const matches: Array<{ id: string; displayName: string }> = (
      folders ?? []
    ).filter(
      (f: { id: string; displayName: string }) =>
        stripPrefix(f.displayName) === targetCore,
    );

    let canonical = matches.find((f) => f.displayName === folderName) ?? null;

    // If we already have a folder with the same core name but a different
    // displayName (e.g. user reordered categories so prefix changed from
    // "01: 🟡 Approvals" → "02: 🟡 Approvals"), RENAME it in place via PATCH
    // instead of creating a new folder + deleting the old one. This preserves
    // the folder ID, the messages inside, and any Outlook rules pointing at it.
    if (!canonical && matches.length > 0) {
      const renameTarget = matches[0];
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${renameTarget.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName: folderName }),
        },
      );
      if (patchRes.ok) {
        canonical = await patchRes.json();
        console.log(
          `Renamed Outlook folder "${renameTarget.displayName}" → "${folderName}"`,
        );
      } else {
        console.warn(
          `Failed to rename Outlook folder "${renameTarget.displayName}" → "${folderName}":`,
          await patchRes.text(),
        );
      }
    }

    if (!canonical) {
      const createRes = await fetch(
        "https://graph.microsoft.com/v1.0/me/mailFolders",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName: folderName }),
        },
      );

      if (!createRes.ok) {
        console.error(
          `Failed to create Outlook folder "${folderName}":`,
          await createRes.text(),
        );
        return false;
      }

      canonical = await createRes.json();
      console.log(`Created Outlook folder: ${folderName}`);
    }

    // Any leftover duplicates (rare): merge their messages into canonical and delete.
    const toDelete = matches.filter(
      (f) => f.id !== canonical?.id && f.displayName !== folderName,
    );
    for (const dup of toDelete) {
      console.log(
        `Deduplicating Outlook folder "${dup.displayName}" into "${folderName}"`,
      );
      try {
        if (canonical?.id) {
          await moveOutlookFolderMessages(
            accessToken,
            dup.id,
            dup.displayName,
            canonical.id,
            folderName,
          );
        }
      } catch (moveErr) {
        console.error(
          `Failed moving messages from duplicate folder "${dup.displayName}":`,
          moveErr,
        );
      }
      await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${dup.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null);
    }

    return true;
  } catch (error) {
    console.error(`Error creating Outlook folder "${folderName}":`, error);
    return false;
  }
}

const REORDER_TEMP_PREFIX = "InboxIQ reorder ";

async function listOutlookFolders(
  accessToken: string,
): Promise<Array<{ id: string; displayName: string }>> {
  const listRes = await fetch(
    "https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    console.warn("Unable to list Outlook folders:", await listRes.text());
    return [];
  }
  const { value } = await listRes.json();
  return value ?? [];
}

async function getOutlookInboxId(accessToken: string): Promise<string | null> {
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.id ?? null;
}

/**
 * Cleans up orphaned "InboxIQ reorder ..." temporary folders left behind by
 * a previously-interrupted reorder pass. If the temp folder name corresponds
 * to a known category, we try to rename it into its final form. Otherwise we
 * move any messages back to the Inbox and delete the folder so users never
 * see these temp folders in Outlook Web/Desktop.
 */
async function cleanupOrphanedReorderFolders(
  accessToken: string,
  desired: Array<{
    folderName: string;
    coreName: string;
    name: string;
    show_in_favorites?: boolean;
  }>,
): Promise<void> {
  const folders = await listOutlookFolders(accessToken);
  const orphans = folders.filter((f) =>
    (f.displayName || "").startsWith(REORDER_TEMP_PREFIX),
  );
  if (orphans.length === 0) return;

  console.log(
    `Found ${orphans.length} orphaned reorder folder(s); cleaning up...`,
  );
  const inboxId = await getOutlookInboxId(accessToken);

  for (const orphan of orphans) {
    // Extract the original category name: "InboxIQ reorder {8hex} {Name}"
    const match = orphan.displayName.match(
      /^InboxIQ reorder [0-9a-f]+\s+(.+)$/i,
    );
    const originalName = match?.[1]?.trim() ?? "";
    const matchedDesired = originalName
      ? desired.find(
          (d) =>
            normalizeManagedCategoryName(d.name) ===
            normalizeManagedCategoryName(originalName),
        )
      : undefined;

    // Check if a folder with the final desired name already exists.
    const finalAlreadyExists = matchedDesired
      ? folders.some(
          (f) =>
            f.id !== orphan.id &&
            normalizeManagedCategoryName(f.displayName) ===
              matchedDesired.coreName,
        )
      : false;

    if (matchedDesired && !finalAlreadyExists) {
      // Recover: rename the temp folder to its proper final name.
      const renameRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${orphan.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName: matchedDesired.folderName }),
        },
      );
      if (renameRes.ok) {
        console.log(
          `Recovered orphan reorder folder -> ${matchedDesired.folderName}`,
        );
        await setOutlookFolderFavorite(
          accessToken,
          orphan.id,
          Boolean(matchedDesired.show_in_favorites),
        );
        continue;
      }
      console.warn(
        `Failed to recover orphan ${orphan.displayName}, will delete instead:`,
        await renameRes.text(),
      );
    }

    // Otherwise: move any messages back to inbox and delete.
    if (inboxId) {
      try {
        await moveOutlookFolderMessages(
          accessToken,
          orphan.id,
          orphan.displayName,
          inboxId,
          "Inbox",
        );
      } catch (error) {
        console.error(
          `Failed moving messages out of orphan ${orphan.displayName}:`,
          error,
        );
      }
    }
    await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${orphan.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    ).catch((error) =>
      console.error(`Failed deleting orphan ${orphan.displayName}:`, error),
    );
    console.log(`Deleted orphaned reorder folder: ${orphan.displayName}`);
  }
}

async function enforceOutlookManagedFolderOrder(
  accessToken: string,
  categories: Array<{
    name: string;
    color: string;
    show_in_favorites?: boolean;
  }>,
): Promise<void> {
  if (categories.length === 0) return;

  const desired = categories.map((category, idx) => ({
    ...category,
    folderName: `${invisibleSortPrefix(idx + 1)}${nearestColorDot(category.color)} ${category.name}`,
    coreName: normalizeManagedCategoryName(category.name),
  }));

  // Outlook already sorts folders alphabetically by displayName, so the
  // invisible prefix on each managed folder is the true source of order.
  // Rebuilding folders through temporary "InboxIQ reorder ..." folders made
  // the sync path fragile and could leave visible leftovers if Outlook or
  // Graph lagged. Instead, we now do a non-destructive stabilization pass:
  // clean up any old temp folders, ensure each canonical folder name exists,
  // merge duplicates, and leave the existing folder IDs/messages intact.
  await cleanupOrphanedReorderFolders(accessToken, desired);

  let folders = await listOutlookFolders(accessToken);
  const inboxId = await getOutlookInboxId(accessToken);
  if (folders.length === 0 && !inboxId) {
    console.warn("Unable to inspect Outlook folders for stabilization.");
    return;
  }

  console.log(
    `Stabilizing Outlook folder names/order: ${desired.map((item) => item.folderName).join(" -> ")}`,
  );

  for (const item of desired) {
    let matches = folders.filter(
      (folder) =>
        normalizeManagedCategoryName(folder.displayName) === item.coreName,
    );

    if (matches.length === 0) {
      const created = await createOutlookFolder(accessToken, item.folderName);
      if (!created) {
        console.warn(
          `Failed creating missing Outlook folder during stabilization: ${item.folderName}`,
        );
        continue;
      }
      folders = await listOutlookFolders(accessToken);
      matches = folders.filter(
        (folder) =>
          normalizeManagedCategoryName(folder.displayName) === item.coreName,
      );
    }

    if (matches.length === 0) continue;

    let canonical =
      matches.find((folder) => folder.displayName === item.folderName) ??
      matches[0];

    if (canonical.displayName !== item.folderName) {
      const renameRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${canonical.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName: item.folderName }),
        },
      );

      if (renameRes.ok) {
        canonical = { ...canonical, displayName: item.folderName };
        folders = folders.map((folder) =>
          folder.id === canonical.id ? canonical : folder,
        );
        console.log(
          `Stabilized Outlook folder "${matches[0].displayName}" → "${item.folderName}"`,
        );
      } else {
        console.warn(
          `Failed stabilizing Outlook folder to ${item.folderName}:`,
          await renameRes.text(),
        );
      }
    }

    for (const duplicate of matches.filter(
      (folder) => folder.id !== canonical.id,
    )) {
      if (inboxId && duplicate.displayName.startsWith(REORDER_TEMP_PREFIX)) {
        try {
          await moveOutlookFolderMessages(
            accessToken,
            duplicate.id,
            duplicate.displayName,
            inboxId,
            "Inbox",
          );
        } catch (error) {
          console.error(
            `Failed moving messages from temp folder ${duplicate.displayName} back to Inbox:`,
            error,
          );
        }
      }

      try {
        await moveOutlookFolderMessages(
          accessToken,
          duplicate.id,
          duplicate.displayName,
          canonical.id,
          canonical.displayName,
        );
      } catch (error) {
        console.error(
          `Failed moving messages from duplicate folder ${duplicate.displayName}:`,
          error,
        );
      }

      await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${duplicate.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ).catch((error) =>
        console.error(
          `Failed deleting duplicate Outlook folder ${duplicate.displayName}:`,
          error,
        ),
      );

      folders = folders.filter((folder) => folder.id !== duplicate.id);
    }

    await setOutlookFolderFavorite(
      accessToken,
      canonical.id,
      Boolean(item.show_in_favorites),
    );
  }

  await cleanupOrphanedReorderFolders(accessToken, desired);
}

/**
 * Rename pre-pass.
 *
 * Looks at every category whose DB name has changed since the last successful
 * sync (`last_synced_name !== name`) and renames the matching Outlook folder
 * / Gmail label IN PLACE — preserving the folder ID, the messages inside, and
 * any server-side rules pointing at it. Without this step, the regular create
 * loop would only see the NEW name, fail to find a matching folder under the
 * new core name, and create a brand-new folder — leaving the old one (e.g.
 * "Project") sitting next to the new one (e.g. "Project One") in Outlook.
 */
async function renameRenamedOutlookFolders(
  accessToken: string,
  renames: Array<{ oldName: string; newName: string; color: string }>,
): Promise<void> {
  if (renames.length === 0) return;

  const listRes = await fetch(
    "https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    console.warn(
      "Rename pre-pass: failed listing Outlook folders:",
      await listRes.text(),
    );
    return;
  }
  const { value: folders } = await listRes.json();
  const allFolders = (folders ?? []) as Array<{
    id: string;
    displayName: string;
  }>;

  for (const { oldName, newName, color } of renames) {
    const oldCore = normalizeManagedCategoryName(oldName);
    const newCore = normalizeManagedCategoryName(newName);
    if (oldCore === newCore) continue; // not actually renamed

    // If a folder with the new core name already exists, skip — the regular
    // create loop will handle prefix updates / dedup. The old-named folder
    // (if any) will be cleaned up by the legacy sweep.
    const newAlreadyExists = allFolders.some(
      (f) => normalizeManagedCategoryName(f.displayName) === newCore,
    );
    if (newAlreadyExists) continue;

    const oldMatch = allFolders.find(
      (f) => normalizeManagedCategoryName(f.displayName) === oldCore,
    );
    if (!oldMatch) continue;

    // Rename to the visible portion ("🟣 Project One"); the ordering pre-pass
    // will add the invisible sort prefix on the next call. We use the visible
    // name here so any ordering changes also get applied a moment later.
    const dot = nearestColorDot(color);
    const renamedDisplay = `${dot} ${newName}`;
    const patchRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${oldMatch.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ displayName: renamedDisplay }),
      },
    );
    if (patchRes.ok) {
      console.log(
        `Renamed Outlook folder "${oldMatch.displayName}" → "${renamedDisplay}" (DB rename)`,
      );
    } else {
      console.warn(
        `Rename pre-pass: failed renaming "${oldMatch.displayName}" → "${renamedDisplay}":`,
        await patchRes.text(),
      );
    }
  }
}

async function renameRenamedGmailLabels(
  accessToken: string,
  renames: Array<{ oldName: string; newName: string; color: string }>,
): Promise<void> {
  if (renames.length === 0) return;
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/labels",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!listRes.ok) {
    console.warn(
      "Rename pre-pass: failed listing Gmail labels:",
      await listRes.text(),
    );
    return;
  }
  const { labels } = await listRes.json();
  const all = (labels ?? []) as Array<{ id: string; name: string }>;

  for (const { oldName, newName, color } of renames) {
    const oldCore = normalizeManagedCategoryName(oldName);
    const newCore = normalizeManagedCategoryName(newName);
    if (oldCore === newCore) continue;

    const newAlreadyExists = all.some(
      (l) => normalizeManagedCategoryName(l.name) === newCore,
    );
    if (newAlreadyExists) continue;

    const oldMatch = all.find(
      (l) => normalizeManagedCategoryName(l.name) === oldCore,
    );
    if (!oldMatch) continue;

    const dot = nearestColorDot(color);
    const renamedName = `${dot} ${newName}`;
    const patchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/labels/${oldMatch.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: renamedName,
          color: hexToGmailColor(color),
        }),
      },
    );
    if (patchRes.ok) {
      console.log(
        `Renamed Gmail label "${oldMatch.name}" → "${renamedName}" (DB rename)`,
      );
    } else {
      console.warn(
        `Rename pre-pass: failed renaming Gmail label "${oldMatch.name}" → "${renamedName}":`,
        await patchRes.text(),
      );
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUserClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseUserClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let connectionId: string | null = null;
    try {
      const body = await req.json();
      connectionId = body?.connection_id || body?.connectionId || null;
    } catch {
      // No body provided; fall back to the user's connected accounts.
    }

    // Get user's organization using RPC function
    const { data: profileData } =
      await supabaseUserClient.rpc("get_my_profile");
    const profile = profileData?.[0];

    if (!profile?.organization_id) {
      return new Response(JSON.stringify({ error: "User profile not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create service role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let scopedConnections: Array<{ id: string; provider: string }> = [];

    if (connectionId) {
      const { data: requestedConnection, error: connectionError } =
        await supabaseAdmin
          .from("provider_connections")
          .select("id, provider")
          .eq("id", connectionId)
          .eq("user_id", user.id)
          .eq("organization_id", profile.organization_id)
          .eq("is_connected", true)
          .maybeSingle();

      if (connectionError || !requestedConnection) {
        return new Response(
          JSON.stringify({ error: "Connected email account not found" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      scopedConnections = [requestedConnection];
    } else {
      const { data: userConnections, error: connectionsError } =
        await supabaseAdmin
          .from("provider_connections")
          .select("id, provider")
          .eq("user_id", user.id)
          .eq("organization_id", profile.organization_id)
          .eq("is_connected", true);

      if (connectionsError || !userConnections?.length) {
        return new Response(
          JSON.stringify({ error: "No connected email providers found" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      scopedConnections = userConnections;
    }

    const scopedConnectionIds = scopedConnections.map((connection) => connection.id);

    // Get ALL categories for the selected connection(s)
    const { data: allCategories, error: catError } = await supabaseAdmin
      .from("categories")
      .select(
        "id, name, color, is_enabled, sort_order, connection_id, show_in_favorites, last_synced_name",
      )
      .eq("organization_id", profile.organization_id)
      .in("connection_id", scopedConnectionIds)
      .order("sort_order");

    if (catError || !allCategories) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch categories" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const enabledCategories = allCategories.filter((c) => c.is_enabled);
    const disabledCategories = allCategories.filter((c) => !c.is_enabled);

    const encryptionKey = Deno.env.get("TOKEN_ENCRYPTION_KEY")!;

    // Get tokens from vault (including refresh token and expiry for refresh logic)
    const { data: tokenDataList, error: tokenError } = await supabaseAdmin
      .from("oauth_token_vault")
      .select(
        "provider, connection_id, encrypted_access_token, encrypted_refresh_token, expires_at",
      )
      .eq("user_id", user.id);

    if (tokenError || !tokenDataList?.length) {
      return new Response(
        JSON.stringify({ error: "No connected email providers found" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const results: {
      provider: string;
      created: number;
      deleted: number;
      failed: number;
      error?: string;
    }[] = [];
    const syncedCategoryIds: string[] = [];

    // Process each connected provider
    for (const tokenRecord of tokenDataList) {
      try {
        // Get valid access token (will refresh if expired)
        const accessToken = await getValidAccessToken(
          tokenRecord as TokenData,
          encryptionKey,
          supabaseAdmin,
          user.id,
        );

        if (!accessToken) {
          console.error(
            `Could not get valid access token for ${tokenRecord.provider}`,
          );
          results.push({
            provider: tokenRecord.provider,
            created: 0,
            deleted: 0,
            failed: enabledCategories.length + disabledCategories.length,
            error:
              "Reconnect your Microsoft mailbox, then run Re-sync All again.",
          });
          continue;
        }
        let created = 0;
        let deleted = 0;
        let failed = 0;

        // Create labels/folders for enabled categories using the plain visible
        // name plus the color dot. Number prefixes are legacy and must not be
        // recreated because the user wants the mailbox folders shown without
        // leading order numbers.
        const sortedEnabled = [...enabledCategories].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
        );

        // Pre-compute a deduplicated preset color per category so two
        // categories with similar app-side colors don't collapse to the same
        // Outlook preset on iPhone/Web/Desktop. The map is keyed by the
        // managed-category display name ("IQ: <name>").
        const outlookPresetMap = (tokenRecord.provider === "microsoft" ||
            tokenRecord.provider === "outlook")
          ? buildOutlookPresetMap(
            sortedEnabled.map((c: { name: string; color: string }) => ({
              name: `${IQ_TAG_PREFIX}${c.name}`,
              color: c.color,
            })),
          )
          : {};

        // RENAME PRE-PASS — handle categories whose name changed in the DB
        // since the last successful sync (e.g. "Project" → "Project One").
        // Without this, the create loop below would not match the old folder
        // and would create a brand-new one, leaving a duplicate behind.
        const renames = sortedEnabled
          .filter(
            (c: any) => c.last_synced_name && c.last_synced_name !== c.name,
          )
          .map((c: any) => ({
            oldName: c.last_synced_name as string,
            newName: c.name as string,
            color: c.color as string,
          }));
        if (renames.length > 0) {
          if (tokenRecord.provider === "google") {
            await renameRenamedGmailLabels(accessToken, renames);
          } else if (
            tokenRecord.provider === "microsoft" ||
            tokenRecord.provider === "outlook"
          ) {
            await renameRenamedOutlookFolders(accessToken, renames);
          }
        }

        for (let idx = 0; idx < sortedEnabled.length; idx++) {
          const category = sortedEnabled[idx];
          const dot = nearestColorDot(category.color);
          // Gmail: clean visible name only — Gmail does not auto-sort labels.
          // Outlook: prepend an INVISIBLE zero-width prefix so the folder
          // pane sorts in the same order as the app. The prefix is
          // imperceptible in Outlook Desktop, Web (OWA), and Mobile.
          const visibleName = `${dot} ${category.name}`;
          const outlookSortPrefix = invisibleSortPrefix(idx + 1);
          const outlookFolderName = `${outlookSortPrefix}${visibleName}`;
          let success = false;

          if (tokenRecord.provider === "google") {
            success = await createGmailLabel(
              accessToken,
              visibleName,
              category.color,
            );
          } else if (
            tokenRecord.provider === "microsoft" ||
            tokenRecord.provider === "outlook"
          ) {
            success = await createOutlookFolder(accessToken, outlookFolderName);
            // Also create / refresh the colored Outlook Master Category and
            // retroactively tag every message inside the folder so the
            // color stripe is visible in the Outlook UI today (folders
            // themselves cannot be colored via Graph).
            // The tag uses the short "IQ: <name>" prefix so it stays compact
            // in the email row. Each email is guaranteed to carry exactly one
            // managed category — see tagOutlookFolderMessages for dedupe.
            if (success) {
              const categoryTag = `${IQ_TAG_PREFIX}${category.name}`;
              await ensureOutlookMasterCategory(
                accessToken,
                categoryTag,
                category.color,
                outlookPresetMap[categoryTag],
              );
              const folderId = await findOutlookFolderId(
                accessToken,
                outlookFolderName,
              );
              if (folderId) {
                const tagged = await tagOutlookFolderMessages(
                  accessToken,
                  folderId,
                  categoryTag,
                );
                if (tagged > 0) {
                  console.log(
                    `Tagged ${tagged} msg(s) in "${visibleName}" with "${categoryTag}"`,
                  );
                }
                // Best-effort: pin/unpin in Outlook Favorites pane based on
                // the category's `show_in_favorites` toggle. Graph beta
                // accepts isFavorite on some tenants; on others it silently
                // no-ops and the user must drag the folder to Favorites
                // manually (the UI tooltip already explains this).
                const favPinned = await setOutlookFolderFavorite(
                  accessToken,
                  folderId,
                  Boolean(category.show_in_favorites),
                );
                if (favPinned) {
                  console.log(
                    `Outlook Favorites updated for "${visibleName}" → ${category.show_in_favorites ? "pinned" : "unpinned"}`,
                  );
                }
              }
              // Clean up legacy master-category variants for this same
              // category name (long "InboxIQ:" prefix, the old "★ " favorite
              // prefix, and the legacy "Wibookly:" prefix). Without this,
              // Outlook accumulates stale colored chips that show up
              // alongside the new IQ: tag on every message.
              const staleVariants = [
                `InboxIQ: ${category.name}`,
                `★ InboxIQ: ${category.name}`,
                `★ IQ: ${category.name}`,
                `Wibookly: ${category.name}`,
              ];
              for (const stale of staleVariants) {
                if (stale === categoryTag) continue;
                await deleteOutlookMasterCategory(accessToken, stale).catch(
                  (e: unknown) =>
                    console.warn(
                      `Failed deleting stale category "${stale}":`,
                      e,
                    ),
                );
              }
            }
          }

          if (success) {
            created++;
            // Track successfully synced categories
            if (!syncedCategoryIds.includes(category.id)) {
              syncedCategoryIds.push(category.id);
            }
          } else {
            failed++;
          }
        }

        if (
          (tokenRecord.provider === "microsoft" ||
            tokenRecord.provider === "outlook") &&
          sortedEnabled.length > 0
        ) {
          await enforceOutlookManagedFolderOrder(
            accessToken,
            sortedEnabled.map((category) => ({
              name: category.name,
              color: category.color,
              show_in_favorites: category.show_in_favorites,
            })),
          );
        }

        // Delete labels/folders for disabled categories AND remove the
        // server-side Outlook rules that were routing email into them, so
        // newly-arriving messages stop being filed under a disabled category
        // and land in the Inbox instead. Existing messages are moved back
        // to Inbox by emptyOutlookFolderToInbox inside deleteOutlookFolder.
        for (const category of disabledCategories) {
          const dot = nearestColorDot(category.color);
          const labelName = `${dot} ${category.name}`;
          let success = false;

          if (tokenRecord.provider === "google") {
            success = await deleteGmailLabel(accessToken, labelName);
          } else if (
            tokenRecord.provider === "microsoft" ||
            tokenRecord.provider === "outlook"
          ) {
            // Remove Outlook server-side rules first so they don't recreate the folder.
            await deleteOutlookRulesForLabel(accessToken, labelName);
            success = await deleteOutlookFolder(accessToken, labelName);
          }

          if (success) {
            deleted++;
          }
        }

        // Clean up legacy labels/folders with old naming format
        // Delete old "04: Meetings" (renamed to Events) and any unnumbered "Meetings" labels
        const legacyLabelsToClean = ["04: Meetings", "Meetings", "4: Meetings"];
        for (const legacyLabel of legacyLabelsToClean) {
          if (tokenRecord.provider === "google") {
            await deleteGmailLabel(accessToken, legacyLabel);
          } else if (
            tokenRecord.provider === "microsoft" ||
            tokenRecord.provider === "outlook"
          ) {
            await deleteOutlookFolder(accessToken, legacyLabel);
          }
        }

        // Aggressive cleanup: nuke EVERY variant of the 10 default category names
        // (handles old "1: Urgent" duplicates left over after we moved to "01:" padding
        // and after disabling all default categories in favor of the dedicated Follow-up folder)
        const defaultCategoryNames = [
          "Urgent",
          "Follow Up",
          "Follow Up1",
          "No Reply Tracker",
          "Approvals",
          "Events",
          "Customers",
          "Vendors",
          "Internal",
          "Projects",
          "Finance",
          "FYI",
          "Meetings",
        ];
        // Skip names that match an enabled category for THIS connection so we don't
        // delete a folder we just created.
        const enabledNamesLower = new Set(
          enabledCategories
            .filter((c) => c.connection_id === undefined || true)
            .map((c) => c.name.trim().toLowerCase()),
        );
        for (const baseName of defaultCategoryNames) {
          if (enabledNamesLower.has(baseName.toLowerCase())) continue;
          // deleteOutlookFolder / deleteGmailLabel already strip numeric prefixes
          // and remove every matching variant in one call.
          if (tokenRecord.provider === "google") {
            await deleteGmailLabel(accessToken, baseName);
          } else if (
            tokenRecord.provider === "microsoft" ||
            tokenRecord.provider === "outlook"
          ) {
            await deleteOutlookFolder(accessToken, baseName);
          }
        }

        // FINAL SWEEP — numbered legacy duplicates.
        // Canonical folder names no longer include any numeric prefix, so any
        // managed folder whose name starts with digits is stale and should be removed.
        // Protects: the dedicated "Follow-up" folder (no numeric prefix) and well-known
        // mailbox folders (Inbox, Drafts, etc. — they don't start with a digit anyway).
        if (
          tokenRecord.provider === "microsoft" ||
          tokenRecord.provider === "outlook"
        ) {
          try {
            const listRes = await fetch(
              "https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName",
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (listRes.ok) {
              const { value: folders } = await listRes.json();
              const legacy = (folders ?? []).filter(
                (f: { displayName: string }) =>
                  /^\s*(?:[⭐★]|\p{Extended_Pictographic})?\s*\d+\s*[:.\-]/u.test(
                    f.displayName,
                  ),
              );
              for (const f of legacy as Array<{
                id: string;
                displayName: string;
              }>) {
                console.log(
                  `Cleaning legacy numbered folder: ${f.displayName}`,
                );
                try {
                  await emptyOutlookFolderToInbox(
                    accessToken,
                    f.id,
                    f.displayName,
                  );
                } catch (e) {
                  console.error(`Empty failed for ${f.displayName}:`, e);
                }
                await fetch(
                  `https://graph.microsoft.com/v1.0/me/mailFolders/${f.id}`,
                  {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${accessToken}` },
                  },
                ).catch((e) =>
                  console.error(`Delete failed for ${f.displayName}:`, e),
                );
              }
            }
          } catch (e) {
            console.error("Single-digit sweep failed:", e);
          }
        } else if (tokenRecord.provider === "google") {
          try {
            const listRes = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/labels",
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              },
            );
            if (listRes.ok) {
              const { labels } = await listRes.json();
              const legacy = (labels ?? []).filter((l: { name: string }) =>
                /^\s*(?:[⭐★]|\p{Extended_Pictographic})?\s*\d+\s*[:.\-]/u.test(
                  l.name,
                ),
              );
              for (const l of legacy as Array<{ name: string }>) {
                console.log(`Cleaning legacy single-digit label: ${l.name}`);
                await deleteGmailLabel(accessToken, l.name);
              }
            }
          } catch (e) {
            console.error("Single-digit Gmail sweep failed:", e);
          }
        }

        // FINAL SWEEP — Outlook only — remove legacy managed category tags
        // ("InboxIQ:" / "★ InboxIQ:" / "Wibookly:") from every message in
        // the mailbox AND delete the orphan colored master categories.
        // Without this, emails keep displaying duplicate chips like
        // "InboxIQ: Approvals" + "★ InboxIQ: Approvals" alongside the new
        // short "IQ: Approvals" chip.
        if (
          tokenRecord.provider === "microsoft" ||
          tokenRecord.provider === "outlook"
        ) {
          try {
            // 1) List every master category and pick out the legacy ones.
            const mcRes = await fetch(
              "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            const legacyTagNames = new Set<string>();
            // Build the allow-list of currently-valid IQ tags so the sweep
            // never deletes the chip the user is actively using.
            const currentValid = new Set<string>();
            try {
              const { data: cats } = await supabaseAdmin
                .from("categories")
                .select("name")
                .eq("connection_id", connectionId);
              for (const c of (cats ?? []) as Array<{ name: string }>) {
                currentValid.add(`${IQ_TAG_PREFIX}${c.name}`);
              }
            } catch (_) {
              /* best-effort */
            }
            if (mcRes.ok) {
              const { value: mcList } = await mcRes.json();
              for (const c of (mcList ?? []) as Array<{
                id: string;
                displayName: string;
              }>) {
                const dn = c.displayName || "";
                // Skip the live, currently-used IQ chips.
                if (currentValid.has(dn)) continue;
                // Anything else our system has ever produced gets purged:
                // legacy prefixes, numbered Gmail mirrors, AI Draft / AI Sent.
                if (isManagedCategoryName(dn)) {
                  legacyTagNames.add(dn);
                  // Delete the orphan colored chip so it disappears from the
                  // Outlook Categorize menu.
                  await fetch(
                    `https://graph.microsoft.com/v1.0/me/outlook/masterCategories/${c.id}`,
                    {
                      method: "DELETE",
                      headers: { Authorization: `Bearer ${accessToken}` },
                    },
                  ).catch(() => {});
                }
              }
            }

            // 2) Scan recent messages across the mailbox and enforce that
            // each message has AT MOST ONE managed "IQ:" tag — the one that
            // matches its current parent folder. Strip every other managed
            // tag (legacy prefixes, numbered mirrors, AI Draft/Sent, and any
            // stale IQ chips left over from earlier rules). We cap at 1000
            // messages per sync to stay inside Graph throttling.
            // Build folderId -> "IQ: <Category>" map by listing the user's
            // mail folders and matching their displayName (with or without
            // numeric prefix like "02: ") to the connection's category names.
            const folderToIqTag = new Map<string, string>();
            try {
              const { data: cats2 } = await supabaseAdmin
                .from("categories")
                .select("name")
                .eq("connection_id", connectionId);
              const catNames = new Map<string, string>(); // lower(name) -> "IQ: <Name>"
              for (const c of (cats2 ?? []) as Array<{ name: string }>) {
                catNames.set(
                  c.name.trim().toLowerCase(),
                  `${IQ_TAG_PREFIX}${c.name}`,
                );
              }
              if (catNames.size > 0) {
                const fRes = await fetch(
                  "https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName",
                  { headers: { Authorization: `Bearer ${accessToken}` } },
                );
                if (fRes.ok) {
                  const { value: folders } = await fRes.json();
                  for (const f of (folders ?? []) as Array<{
                    id: string;
                    displayName: string;
                  }>) {
                    // Strip a leading numeric prefix like "02: " so "02: Follow Up" still matches "Follow Up".
                    const core = normalizeManagedCategoryName(
                      f.displayName || "",
                    );
                    const iqTag = catNames.get(core);
                    if (iqTag) folderToIqTag.set(f.id, iqTag);
                  }
                }
              }
            } catch (_) {
              /* best-effort */
            }

            const scanRes = await fetch(
              "https://graph.microsoft.com/v1.0/me/messages?$top=1000&$select=id,categories,parentFolderId&$orderby=receivedDateTime desc",
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (scanRes.ok) {
              const { value: msgs } = await scanRes.json();
              let stripped = 0;
              for (const m of (msgs ?? []) as Array<{
                id: string;
                categories?: string[];
                parentFolderId?: string;
              }>) {
                const existing = Array.isArray(m.categories)
                  ? m.categories
                  : [];
                if (existing.length === 0) continue;
                // Keep all non-managed (user) categories untouched.
                const userTags = existing.filter(
                  (c) => !isManagedCategoryName(c),
                );
                // Decide which (if any) single managed tag this message
                // should keep, based on the folder it's currently in.
                const folderTag = m.parentFolderId
                  ? folderToIqTag.get(m.parentFolderId)
                  : undefined;
                const next = folderTag ? [...userTags, folderTag] : userTags;
                if (
                  existing.length === next.length &&
                  existing.every((c, i) => c === next[i])
                )
                  continue;
                const patchRes = await fetch(
                  `https://graph.microsoft.com/v1.0/me/messages/${m.id}`,
                  {
                    method: "PATCH",
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ categories: next }),
                  },
                );
                if (patchRes.ok) stripped++;
              }
              if (stripped > 0) {
                console.log(`Normalized IQ tags on ${stripped} message(s)`);
              }
            }
          } catch (e) {
            console.warn("Legacy IQ tag sweep failed:", e);
          }
        }

        results.push({
          provider: tokenRecord.provider,
          created,
          deleted,
          failed,
        });
      } catch (error) {
        console.error(`Failed to process ${tokenRecord.provider}:`, error);
        results.push({
          provider: tokenRecord.provider,
          created: 0,
          deleted: 0,
          failed: enabledCategories.length + disabledCategories.length,
          error: error instanceof Error ? error.message : "Unknown sync error",
        });
      }
    }

    // Update last_synced_at AND last_synced_name for successfully synced
    // categories. Snapshotting the name here is what lets the next sync
    // detect a rename (DB name !== last_synced_name) and rename the
    // existing Outlook folder / Gmail label in place instead of creating
    // a duplicate.
    if (syncedCategoryIds.length > 0) {
      const now = new Date().toISOString();
      const byId = new Map(allCategories.map((c) => [c.id, c.name] as const));
      // Bulk-stamp last_synced_at, then per-row update last_synced_name so
      // each row stores its own current name.
      await supabaseAdmin
        .from("categories")
        .update({ last_synced_at: now })
        .in("id", syncedCategoryIds);
      await Promise.all(
        syncedCategoryIds.map((id) =>
          supabaseAdmin
            .from("categories")
            .update({ last_synced_name: byId.get(id) ?? null })
            .eq("id", id),
        ),
      );
      console.log(
        `Updated last_synced_at + last_synced_name for ${syncedCategoryIds.length} categories`,
      );
    }

    const totalCreated = results.reduce((sum, r) => sum + r.created, 0);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        syncedCategoryIds,
        message: `Synced ${totalCreated} labels/folders across ${results.length} provider(s)`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Sync categories error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

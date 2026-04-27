import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AES-GCM decryption for tokens (server-side only)
async function decryptToken(encryptedData: string, keyString: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  return new TextDecoder().decode(decrypted);
}

// AES-GCM encryption for tokens
async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(token)
  );
  
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

// Refresh Google access token using refresh token
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  
  console.log('Refreshing Google access token...');
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) {
    console.error('Failed to refresh Google token:', await response.text());
    return null;
  }
  
  const tokens = await response.json();
  console.log('Successfully refreshed Google token');
  return tokens;
}

// Refresh Microsoft access token using refresh token
async function refreshMicrosoftToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number } | null> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  
  console.log('Refreshing Microsoft access token...');
  
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) {
    console.error('Failed to refresh Microsoft token:', await response.text());
    return null;
  }
  
  const tokens = await response.json();
  console.log('Successfully refreshed Microsoft token');
  return tokens;
}

interface TokenData {
  provider: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

// Get valid access token, refreshing if expired
// deno-lint-ignore no-explicit-any
async function getValidAccessToken(
  tokenData: TokenData,
  encryptionKey: string,
  supabaseAdmin: any,
  userId: string
): Promise<string | null> {
  const isExpired = tokenData.expires_at && new Date(tokenData.expires_at) < new Date();
  
  // If not expired, return decrypted access token
  if (!isExpired) {
    return await decryptToken(tokenData.encrypted_access_token, encryptionKey);
  }
  
  console.log(`Token for ${tokenData.provider} is expired, attempting refresh...`);
  
  // Need to refresh - check if we have a refresh token
  if (!tokenData.encrypted_refresh_token) {
    console.error(`No refresh token available for ${tokenData.provider}`);
    return null;
  }
  
  const refreshToken = await decryptToken(tokenData.encrypted_refresh_token, encryptionKey);
  let newTokens;
  
  if (tokenData.provider === 'google') {
    newTokens = await refreshGoogleToken(refreshToken);
  } else if (tokenData.provider === 'microsoft' || tokenData.provider === 'outlook') {
    newTokens = await refreshMicrosoftToken(refreshToken);
  }
  
  if (!newTokens) {
    console.error(`Failed to refresh token for ${tokenData.provider}`);
    return null;
  }
  
  // Encrypt and save new tokens
  const encryptedAccessToken = await encryptToken(newTokens.access_token, encryptionKey);
  const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
  
  // Update token in vault using direct fetch to avoid type issues
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const updatePayload: Record<string, string> = {
    encrypted_access_token: encryptedAccessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };
  
  // Microsoft may return a new refresh token
  if ((tokenData.provider === 'microsoft' || tokenData.provider === 'outlook') && 'refresh_token' in newTokens && newTokens.refresh_token) {
    updatePayload.encrypted_refresh_token = await encryptToken(String(newTokens.refresh_token), encryptionKey);
  }
  
  const updateResponse = await fetch(
    `${supabaseUrl}/rest/v1/oauth_token_vault?user_id=eq.${userId}&provider=eq.${tokenData.provider}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updatePayload)
    }
  );
  
  if (!updateResponse.ok) {
    console.error(`Failed to save refreshed token for ${tokenData.provider}:`, await updateResponse.text());
  } else {
    console.log(`Saved refreshed token for ${tokenData.provider}`);
  }
  
  return newTokens.access_token;
}

// Convert hex color to Gmail color palette (Gmail only supports specific colors)
function hexToGmailColor(hex: string): { backgroundColor: string; textColor: string } {
  // Gmail only allows specific color values from their palette
  // Map common colors to Gmail's supported palette
  const colorMap: Record<string, { backgroundColor: string; textColor: string }> = {
    // Reds
    '#EF4444': { backgroundColor: '#cc3a21', textColor: '#ffffff' },
    '#DC2626': { backgroundColor: '#cc3a21', textColor: '#ffffff' },
    '#B91C1C': { backgroundColor: '#ac2b16', textColor: '#ffffff' },
    // Oranges
    '#F97316': { backgroundColor: '#f2a600', textColor: '#000000' },
    '#EA580C': { backgroundColor: '#cf8933', textColor: '#000000' },
    // Yellows
    '#EAB308': { backgroundColor: '#f2c960', textColor: '#000000' },
    '#FACC15': { backgroundColor: '#f2c960', textColor: '#000000' },
    // Greens
    '#22C55E': { backgroundColor: '#149e60', textColor: '#ffffff' },
    '#16A34A': { backgroundColor: '#0d804f', textColor: '#ffffff' },
    // Teals
    '#14B8A6': { backgroundColor: '#2da2bb', textColor: '#ffffff' },
    '#06B6D4': { backgroundColor: '#2da2bb', textColor: '#ffffff' },
    // Blues
    '#3B82F6': { backgroundColor: '#285bac', textColor: '#ffffff' },
    '#2563EB': { backgroundColor: '#1a73e8', textColor: '#ffffff' },
    // Purples
    '#8B5CF6': { backgroundColor: '#653e9b', textColor: '#ffffff' },
    '#7C3AED': { backgroundColor: '#653e9b', textColor: '#ffffff' },
    // Pinks
    '#EC4899': { backgroundColor: '#c9649b', textColor: '#ffffff' },
    '#DB2777': { backgroundColor: '#c9649b', textColor: '#ffffff' },
    // Grays
    '#6B7280': { backgroundColor: '#666666', textColor: '#ffffff' },
    '#9CA3AF': { backgroundColor: '#999999', textColor: '#000000' },
  };

  const upperHex = hex.toUpperCase();
  if (colorMap[upperHex]) return colorMap[upperHex];

  // Default fallback - parse hex and find closest match
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Simple heuristic: map to closest category
  if (r > 180 && g < 100 && b < 100) return { backgroundColor: '#cc3a21', textColor: '#ffffff' }; // Red
  if (r > 180 && g > 100 && g < 180) return { backgroundColor: '#f2a600', textColor: '#000000' }; // Orange
  if (r > 180 && g > 180) return { backgroundColor: '#f2c960', textColor: '#000000' }; // Yellow
  if (g > r && g > b) return { backgroundColor: '#149e60', textColor: '#ffffff' }; // Green
  if (b > r && b > 150) return { backgroundColor: '#285bac', textColor: '#ffffff' }; // Blue
  if (r > 100 && b > 100 && g < 100) return { backgroundColor: '#653e9b', textColor: '#ffffff' }; // Purple
  
  return { backgroundColor: '#666666', textColor: '#ffffff' }; // Default gray
}

// Create Gmail label with color
async function createGmailLabel(accessToken: string, labelName: string, hexColor: string): Promise<boolean> {
  try {
    // Check if label already exists
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) {
      console.error('Failed to list Gmail labels:', await listRes.text());
      return false;
    }
    
    const { labels } = await listRes.json();
    const existingLabel = labels?.find((l: { name: string }) => l.name === labelName);
    const gmailColor = hexToGmailColor(hexColor);
    
    if (existingLabel) {
      console.log(`Gmail label "${labelName}" already exists, updating color...`);
      // Update existing label's color
      const updateRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${existingLabel.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          color: gmailColor
        })
      });
      
      if (!updateRes.ok) {
        console.error(`Failed to update Gmail label color:`, await updateRes.text());
      } else {
        console.log(`Updated color for Gmail label: ${labelName}`);
      }
      return true;
    }
    
    // Create the label with color
    const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        color: gmailColor
      })
    });
    
    if (!createRes.ok) {
      console.error(`Failed to create Gmail label "${labelName}":`, await createRes.text());
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
async function deleteGmailLabel(accessToken: string, labelName: string): Promise<boolean> {
  try {
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) return false;
    
    const { labels } = await listRes.json();
    const label = labels?.find((l: { name: string }) => l.name === labelName);
    
    if (!label) {
      console.log(`Gmail label "${labelName}" doesn't exist, nothing to delete`);
      return true;
    }

    // Step 1: pull every message that still carries this label and re-add INBOX,
    // remove the custom label so the user sees them back in their main inbox.
    try {
      let pageToken: string | undefined = undefined;
      let movedTotal = 0;
      do {
        const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
        url.searchParams.set('labelIds', label.id);
        url.searchParams.set('maxResults', '500');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const msgRes = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!msgRes.ok) break;
        const { messages, nextPageToken } = await msgRes.json();
        if (messages?.length) {
          // batchModify supports up to 1000 ids per call
          const ids = messages.map((m: { id: string }) => m.id);
          const modRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ids,
              addLabelIds: ['INBOX'],
              removeLabelIds: [label.id]
            })
          });
          if (modRes.ok) movedTotal += ids.length;
          else console.error(`batchModify failed for "${labelName}":`, await modRes.text());
        }
        pageToken = nextPageToken;
      } while (pageToken);
      if (movedTotal > 0) console.log(`Moved ${movedTotal} message(s) from "${labelName}" back to Inbox`);
    } catch (moveErr) {
      console.error(`Error moving messages out of "${labelName}":`, moveErr);
      // continue with deletion regardless
    }
    
    const deleteRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${label.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!deleteRes.ok && deleteRes.status !== 404) {
      console.error(`Failed to delete Gmail label "${labelName}":`, await deleteRes.text());
      return false;
    }
    
    console.log(`Deleted Gmail label: ${labelName}`);
    return true;
  } catch (error) {
    console.error(`Error deleting Gmail label "${labelName}":`, error);
    return false;
  }
}

// Move every message inside an Outlook folder to the Inbox, paginating through results.
async function emptyOutlookFolderToInbox(accessToken: string, folderId: string, folderName: string): Promise<number> {
  // Resolve the well-known Inbox id once
  let inboxId = 'inbox';
  try {
    const inboxRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (inboxRes.ok) {
      const j = await inboxRes.json();
      if (j?.id) inboxId = j.id;
    }
  } catch { /* fall back to 'inbox' alias */ }

  let movedTotal = 0;
  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$select=id&$top=50`;

  while (nextLink) {
    const res: Response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      console.error(`Failed to list messages in "${folderName}":`, await res.text());
      break;
    }
    const data = await res.json();
    const messages: Array<{ id: string }> = data?.value ?? [];
    for (const m of messages) {
      const moveRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${m.id}/move`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ destinationId: inboxId })
        }
      );
      if (moveRes.ok) movedTotal++;
      else console.error(`Move failed for message ${m.id}:`, await moveRes.text());
    }
    nextLink = data?.['@odata.nextLink'] ?? null;
  }

  if (movedTotal > 0) console.log(`Moved ${movedTotal} message(s) from "${folderName}" back to Inbox`);
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
  let nextLink: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/${sourceFolderId}/messages?$select=id&$top=50`;

  while (nextLink) {
    const res: Response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      console.error(`Failed to list messages in "${sourceFolderName}":`, await res.text());
      break;
    }

    const data = await res.json();
    const messages: Array<{ id: string }> = data?.value ?? [];
    for (const message of messages) {
      const moveRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${message.id}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ destinationId: destinationFolderId })
      });

      if (moveRes.ok) movedTotal++;
      else console.error(`Move failed for message ${message.id} into "${destinationFolderName}":`, await moveRes.text());
    }

    nextLink = data?.['@odata.nextLink'] ?? null;
  }

  if (movedTotal > 0) {
    console.log(`Moved ${movedTotal} message(s) from "${sourceFolderName}" into "${destinationFolderName}"`);
  }

  return movedTotal;
}

// Delete every Outlook server-side messageRule whose name targets the given
// label (e.g. "02: Follow Up"). We match the InboxIQ-managed rule name shape
// `InboxIQ: <label> - <type>:<value>` so we don't touch unrelated user rules.
async function deleteOutlookRulesForLabel(accessToken: string, labelName: string): Promise<number> {
  try {
    const listRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) return 0;
    const { value } = await listRes.json();
    let deleted = 0;
    const labelLower = labelName.toLowerCase();
    const baseLower = labelName.replace(/^\s*\d+\s*[:.\-]\s*/, '').trim().toLowerCase();
    for (const r of value || []) {
      const name = String(r.displayName || '');
      const nameLower = name.toLowerCase();
      const isManaged =
        nameLower.startsWith('inboxiq:') ||
        nameLower.startsWith('wibookly:') ||
        nameLower.startsWith('vbookly:');
      if (!isManaged) continue;
      // Must reference this category label (with or without numeric prefix).
      if (!nameLower.includes(labelLower) && !nameLower.includes(baseLower)) continue;
      const delRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules/${r.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (delRes.ok || delRes.status === 404) deleted++;
    }
    if (deleted > 0) console.log(`Deleted ${deleted} Outlook rule(s) for label "${labelName}"`);
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
async function deleteOutlookFolder(accessToken: string, folderName: string): Promise<boolean> {
  try {
    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!listRes.ok) return false;

    const { value: folders } = await listRes.json();
    const hasNumericPrefix = (s: string) => /^\s*\d+\s*[:.\-]/.test(s);
    const stripPrefix = (s: string) => s.replace(/^\s*\d+\s*[:.\-]\s*/, '').trim().toLowerCase();
    const targetCore = stripPrefix(folderName);

    // Protected folders we must NEVER delete: only the dedicated unprefixed
    // "Follow-up" tracker folder used by cron-follow-ups. A user-created
    // category called "Follow Up" lives at "02: Follow Up" (numeric prefix)
    // and MUST be deletable when the user disables the category.
    const PROTECTED_UNPREFIXED = new Set(['follow-up', 'follow up', 'followup']);

    // Match every folder whose normalized name equals our target.
    // For each match, only skip the unprefixed tracker folder.
    const matches = (folders ?? []).filter(
      (f: { id: string; displayName: string }) => stripPrefix(f.displayName) === targetCore
    ).filter((f: { displayName: string }) => {
      if (!hasNumericPrefix(f.displayName) && PROTECTED_UNPREFIXED.has(stripPrefix(f.displayName))) {
        console.log(`Skipping protected unprefixed folder "${f.displayName}"`);
        return false;
      }
      return true;
    });

    if (matches.length === 0) {
      console.log(`Outlook folder matching "${folderName}" doesn't exist, nothing to delete`);
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
      const deleteRes = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!deleteRes.ok && deleteRes.status !== 404) {
        console.error(`Failed to delete Outlook folder "${f.displayName}":`, await deleteRes.text());
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
const OUTLOOK_PRESET_COLORS: Array<{ preset: string; hex: [number, number, number] }> = [
  { preset: 'preset0',  hex: [0xE7, 0x4C, 0x3C] },
  { preset: 'preset1',  hex: [0xE6, 0x7E, 0x22] },
  { preset: 'preset2',  hex: [0xC1, 0x9A, 0x6B] },
  { preset: 'preset3',  hex: [0xF1, 0xC4, 0x0F] },
  { preset: 'preset4',  hex: [0x2E, 0xCC, 0x71] },
  { preset: 'preset5',  hex: [0x16, 0xA0, 0x85] },
  { preset: 'preset6',  hex: [0x95, 0xA5, 0xA6] },
  { preset: 'preset7',  hex: [0x34, 0x98, 0xDB] },
  { preset: 'preset8',  hex: [0x9B, 0x59, 0xB6] },
  { preset: 'preset9',  hex: [0xE8, 0x4F, 0x9C] },
  { preset: 'preset10', hex: [0x7F, 0x8C, 0x8D] },
  { preset: 'preset11', hex: [0x2C, 0x3E, 0x50] },
  { preset: 'preset12', hex: [0xBD, 0xC3, 0xC7] },
  { preset: 'preset13', hex: [0x34, 0x49, 0x5E] },
  { preset: 'preset14', hex: [0x00, 0x00, 0x00] },
  { preset: 'preset15', hex: [0xC0, 0x39, 0x2B] },
  { preset: 'preset16', hex: [0xD3, 0x54, 0x00] },
  { preset: 'preset17', hex: [0x8B, 0x4F, 0x2F] },
  { preset: 'preset18', hex: [0xB7, 0x95, 0x0B] },
  { preset: 'preset19', hex: [0x27, 0xAE, 0x60] },
  { preset: 'preset20', hex: [0x0E, 0x80, 0x68] },
  { preset: 'preset21', hex: [0x6B, 0x6F, 0x39] },
  { preset: 'preset22', hex: [0x21, 0x6F, 0xA8] },
  { preset: 'preset23', hex: [0x71, 0x36, 0x8A] },
  { preset: 'preset24', hex: [0xAD, 0x14, 0x57] },
];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function nearestOutlookPreset(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'preset7';
  let best = OUTLOOK_PRESET_COLORS[0];
  let bestDist = Infinity;
  for (const p of OUTLOOK_PRESET_COLORS) {
    const d = (rgb[0] - p.hex[0]) ** 2 + (rgb[1] - p.hex[1]) ** 2 + (rgb[2] - p.hex[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best.preset;
}

async function ensureOutlookMasterCategory(
  accessToken: string,
  displayName: string,
  hexColor: string,
): Promise<boolean> {
  try {
    const preset = nearestOutlookPreset(hexColor);
    const listRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) {
      console.warn('listMasterCategories failed:', (await listRes.text()).slice(0, 200));
      return false;
    }
    const { value } = await listRes.json();
    const existing = (value || []).find(
      (c: { displayName: string; id: string; color: string }) => c.displayName === displayName,
    );
    if (existing) {
      if (existing.color === preset) return true;
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/outlook/masterCategories/${existing.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ color: preset }),
        },
      );
      return patchRes.ok;
    }
    const createRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, color: preset }),
      },
    );
    return createRes.ok;
  } catch (err) {
    console.warn('ensureOutlookMasterCategory failed:', err);
    return false;
  }
}

// Retroactively tag every message currently inside an Outlook folder with the
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
      const existing: string[] = Array.isArray(m.categories) ? m.categories : [];
      if (existing.includes(categoryName)) continue;
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${m.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: [...existing, categoryName] }),
        },
      );
      if (patchRes.ok) tagged++;
    }
  } catch (err) {
    console.warn(`tagOutlookFolderMessages(${categoryName}) failed:`, err);
  }
  return tagged;
}

// Look up an Outlook folder ID by displayName (handles numeric prefix variants).
async function findOutlookFolderId(accessToken: string, folderName: string): Promise<string | null> {
  try {
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const { value: folders } = await res.json();
    const exact = (folders ?? []).find((f: { displayName: string; id: string }) => f.displayName === folderName);
    return exact?.id ?? null;
  } catch {
    return null;
  }
}

// Create Outlook folder (also dedupes legacy duplicates like "1: X" vs "01: X")
async function createOutlookFolder(accessToken: string, folderName: string): Promise<boolean> {
  try {
    // Check if folder already exists; pull a wide page so we see all of them
    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) {
      console.error('Failed to list Outlook folders:', await listRes.text());
      return false;
    }
    
    const { value: folders } = await listRes.json();

    // Strip the numeric prefix ("01: ", "1: ", "11. ") so duplicates match
    const stripPrefix = (s: string) => s.replace(/^\s*\d+\s*[:.\-]\s*/, '').trim().toLowerCase();
    const targetCore = stripPrefix(folderName);

    const matches: Array<{ id: string; displayName: string }> =
      (folders ?? []).filter((f: { id: string; displayName: string }) => stripPrefix(f.displayName) === targetCore);

    let canonical = matches.find((f) => f.displayName === folderName) ?? null;
    if (!canonical) {
      const createRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ displayName: folderName })
      });

      if (!createRes.ok) {
        console.error(`Failed to create Outlook folder "${folderName}":`, await createRes.text());
        return false;
      }

      canonical = await createRes.json();
      console.log(`Created Outlook folder: ${folderName}`);
    }

    const toDelete = matches.filter((f) => f.displayName !== folderName);
    for (const dup of toDelete) {
      console.log(`Deduplicating Outlook folder "${dup.displayName}" into "${folderName}"`);
      try {
        if (canonical?.id) {
          await moveOutlookFolderMessages(accessToken, dup.id, dup.displayName, canonical.id, folderName);
        }
      } catch (moveErr) {
        console.error(`Failed moving messages from duplicate folder "${dup.displayName}":`, moveErr);
      }
      await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${dup.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }
      }).catch(() => null);
    }

    if (matches.some((f) => f.displayName === folderName)) {
      console.log(`Outlook folder "${folderName}" already exists`);
      return true;
    }

    return true;
  } catch (error) {
    console.error(`Error creating Outlook folder "${folderName}":`, error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUserClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let connectionId: string | null = null;
    try {
      const body = await req.json();
      connectionId = body?.connection_id || body?.connectionId || null;
    } catch {
      // No body provided; fall back to the user's connected accounts.
    }

    // Get user's organization using RPC function
    const { data: profileData } = await supabaseUserClient.rpc('get_my_profile');
    const profile = profileData?.[0];
    
    if (!profile?.organization_id) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let scopedConnectionIds: string[] = [];

    if (connectionId) {
      const { data: requestedConnection, error: connectionError } = await supabaseAdmin
        .from('provider_connections')
        .select('id')
        .eq('id', connectionId)
        .eq('user_id', user.id)
        .eq('organization_id', profile.organization_id)
        .eq('is_connected', true)
        .maybeSingle();

      if (connectionError || !requestedConnection) {
        return new Response(
          JSON.stringify({ error: 'Connected email account not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      scopedConnectionIds = [requestedConnection.id];
    } else {
      const { data: userConnections, error: connectionsError } = await supabaseAdmin
        .from('provider_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('organization_id', profile.organization_id)
        .eq('is_connected', true);

      if (connectionsError || !userConnections?.length) {
        return new Response(
          JSON.stringify({ error: 'No connected email providers found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      scopedConnectionIds = userConnections.map((connection) => connection.id);
    }

    // Get ALL categories for the selected connection(s)
    const { data: allCategories, error: catError } = await supabaseAdmin
      .from('categories')
      .select('id, name, color, is_enabled, sort_order, connection_id, show_in_favorites')
      .eq('organization_id', profile.organization_id)
      .in('connection_id', scopedConnectionIds)
      .order('sort_order');

    if (catError || !allCategories) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch categories' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const enabledCategories = allCategories.filter(c => c.is_enabled);
    const disabledCategories = allCategories.filter(c => !c.is_enabled);

    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

    // Get tokens from vault (including refresh token and expiry for refresh logic)
    const { data: tokenDataList, error: tokenError } = await supabaseAdmin
      .from('oauth_token_vault')
      .select('provider, encrypted_access_token, encrypted_refresh_token, expires_at')
      .eq('user_id', user.id);

    if (tokenError || !tokenDataList?.length) {
      return new Response(
        JSON.stringify({ error: 'No connected email providers found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: { provider: string; created: number; deleted: number; failed: number; error?: string }[] = [];
    const syncedCategoryIds: string[] = [];

    // Process each connected provider
    for (const tokenRecord of tokenDataList) {
      try {
        // Get valid access token (will refresh if expired)
        const accessToken = await getValidAccessToken(
          tokenRecord as TokenData, 
          encryptionKey, 
          supabaseAdmin, 
          user.id
        );
        
        if (!accessToken) {
          console.error(`Could not get valid access token for ${tokenRecord.provider}`);
          results.push({
            provider: tokenRecord.provider,
            created: 0,
            deleted: 0,
            failed: enabledCategories.length + disabledCategories.length,
            error: 'Reconnect your Microsoft mailbox, then run Re-sync All again.'
          });
          continue;
        }
        let created = 0;
        let deleted = 0;
        let failed = 0;

        // Create labels/folders for enabled categories
        for (const category of enabledCategories) {
          // Create label/folder name with zero-padded number prefix based on actual sort_order (1-indexed)
          // Format: "01: Name" so alphabetical sorting matches numeric order (01..09, 10, 11)
          const labelName = `${String(category.sort_order + 1).padStart(2, '0')}: ${category.name}`;
          let success = false;
          
          if (tokenRecord.provider === 'google') {
            success = await createGmailLabel(accessToken, labelName, category.color);
          } else if (tokenRecord.provider === 'microsoft' || tokenRecord.provider === 'outlook') {
            success = await createOutlookFolder(accessToken, labelName);
            // Also create / refresh the colored Outlook Master Category and
            // retroactively tag every message inside the folder so the
            // color stripe is visible in the Outlook UI today (folders
            // themselves cannot be colored via Graph).
            // Favorites are prefixed with "★ " so they sort to the top of
            // the Outlook Categorize menu and stand out visually.
            if (success) {
              const isFavorite = (category as any).show_in_favorites === true;
              const categoryTag = `${isFavorite ? '★ ' : ''}InboxIQ: ${category.name}`;
              await ensureOutlookMasterCategory(accessToken, categoryTag, category.color);
              const folderId = await findOutlookFolderId(accessToken, labelName);
              if (folderId) {
                const tagged = await tagOutlookFolderMessages(accessToken, folderId, categoryTag);
                if (tagged > 0) {
                  console.log(`Tagged ${tagged} msg(s) in "${labelName}" with "${categoryTag}"`);
                }
              }
              // Clean up the non-favorite version when the user toggles favorite ON,
              // and the favorite version when they toggle it OFF — prevents duplicate
              // master categories accumulating in Outlook.
              const stalePrefix = isFavorite ? '' : '★ ';
              const staleTag = `${stalePrefix}InboxIQ: ${category.name}`;
              if (staleTag !== categoryTag) {
                await deleteOutlookMasterCategory(accessToken, staleTag).catch((e) =>
                  console.warn(`Failed deleting stale category "${staleTag}":`, e)
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

        // Delete labels/folders for disabled categories AND remove the
        // server-side Outlook rules that were routing email into them, so
        // newly-arriving messages stop being filed under a disabled category
        // and land in the Inbox instead. Existing messages are moved back
        // to Inbox by emptyOutlookFolderToInbox inside deleteOutlookFolder.
        for (const category of disabledCategories) {
          const labelName = `${String(category.sort_order + 1).padStart(2, '0')}: ${category.name}`;
          let success = false;

          if (tokenRecord.provider === 'google') {
            success = await deleteGmailLabel(accessToken, labelName);
          } else if (tokenRecord.provider === 'microsoft' || tokenRecord.provider === 'outlook') {
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
        const legacyLabelsToClean = ['04: Meetings', 'Meetings', '4: Meetings'];
        for (const legacyLabel of legacyLabelsToClean) {
          if (tokenRecord.provider === 'google') {
            await deleteGmailLabel(accessToken, legacyLabel);
          } else if (tokenRecord.provider === 'microsoft' || tokenRecord.provider === 'outlook') {
            await deleteOutlookFolder(accessToken, legacyLabel);
          }
        }

        // Aggressive cleanup: nuke EVERY variant of the 10 default category names
        // (handles old "1: Urgent" duplicates left over after we moved to "01:" padding
        // and after disabling all default categories in favor of the dedicated Follow-up folder)
        const defaultCategoryNames = [
          'Urgent', 'Follow Up', 'Approvals', 'Events', 'Customers',
          'Vendors', 'Internal', 'Projects', 'Finance', 'FYI', 'Meetings'
        ];
        // Skip names that match an enabled category for THIS connection so we don't
        // delete a folder we just created.
        const enabledNamesLower = new Set(
          enabledCategories
            .filter((c) => c.connection_id === undefined || true)
            .map((c) => c.name.trim().toLowerCase())
        );
        for (const baseName of defaultCategoryNames) {
          if (enabledNamesLower.has(baseName.toLowerCase())) continue;
          // deleteOutlookFolder / deleteGmailLabel already strip numeric prefixes
          // and remove every matching variant in one call.
          if (tokenRecord.provider === 'google') {
            await deleteGmailLabel(accessToken, baseName);
          } else if (tokenRecord.provider === 'microsoft' || tokenRecord.provider === 'outlook') {
            await deleteOutlookFolder(accessToken, baseName);
          }
        }

        // FINAL SWEEP — single-digit legacy duplicates ("1: Urgent" .. "9: Finance")
        // The canonical folder names always use zero-padded prefixes ("01:" .. "10:"),
        // so any folder whose displayName starts with a single digit followed by ":" is
        // by definition a duplicate left behind from older versions. Delete unconditionally.
        // Protects: the dedicated "Follow-up" folder (no numeric prefix) and well-known
        // mailbox folders (Inbox, Drafts, etc. — they don't start with a digit anyway).
        if (tokenRecord.provider === 'microsoft' || tokenRecord.provider === 'outlook') {
          try {
            const listRes = await fetch(
              'https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName',
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (listRes.ok) {
              const { value: folders } = await listRes.json();
              const legacy = (folders ?? []).filter((f: { displayName: string }) =>
                /^\s*\d\s*[:.\-]/.test(f.displayName)   // single digit prefix
              );
              for (const f of legacy as Array<{ id: string; displayName: string }>) {
                console.log(`Cleaning legacy single-digit folder: ${f.displayName}`);
                try {
                  await emptyOutlookFolderToInbox(accessToken, f.id, f.displayName);
                } catch (e) {
                  console.error(`Empty failed for ${f.displayName}:`, e);
                }
                await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${f.id}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${accessToken}` }
                }).catch((e) => console.error(`Delete failed for ${f.displayName}:`, e));
              }
            }
          } catch (e) {
            console.error('Single-digit sweep failed:', e);
          }
        } else if (tokenRecord.provider === 'google') {
          try {
            const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (listRes.ok) {
              const { labels } = await listRes.json();
              const legacy = (labels ?? []).filter((l: { name: string }) =>
                /^\s*\d\s*[:.\-]/.test(l.name)
              );
              for (const l of legacy as Array<{ name: string }>) {
                console.log(`Cleaning legacy single-digit label: ${l.name}`);
                await deleteGmailLabel(accessToken, l.name);
              }
            }
          } catch (e) {
            console.error('Single-digit Gmail sweep failed:', e);
          }
        }

        results.push({ provider: tokenRecord.provider, created, deleted, failed });
      } catch (error) {
        console.error(`Failed to process ${tokenRecord.provider}:`, error);
        results.push({
          provider: tokenRecord.provider,
          created: 0,
          deleted: 0,
          failed: enabledCategories.length + disabledCategories.length,
          error: error instanceof Error ? error.message : 'Unknown sync error'
        });
      }
    }

    // Update last_synced_at for successfully synced categories
    if (syncedCategoryIds.length > 0) {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from('categories')
        .update({ last_synced_at: now })
        .in('id', syncedCategoryIds);
      console.log(`Updated last_synced_at for ${syncedCategoryIds.length} categories`);
    }

    const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        syncedCategoryIds,
        message: `Synced ${totalCreated} labels/folders across ${results.length} provider(s)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Sync categories error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

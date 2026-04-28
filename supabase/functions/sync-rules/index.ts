import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Single short prefix for all InboxIQ-managed Outlook Master Categories
// (must match the value used by the sync-categories function).
const IQ_TAG_PREFIX = 'IQ: ';

// Map a hex color to the nearest colored Unicode dot (must match
// nearestColorDot in sync-categories so folder/label names stay aligned).
function nearestColorDot(hex: string): string {
  const palette: { dot: string; r: number; g: number; b: number }[] = [
    { dot: '🔴', r: 239, g: 68, b: 68 },
    { dot: '🟠', r: 249, g: 115, b: 22 },
    { dot: '🟡', r: 234, g: 179, b: 8 },
    { dot: '🟢', r: 34, g: 197, b: 94 },
    { dot: '🔵', r: 59, g: 130, b: 246 },
    { dot: '🟣', r: 139, g: 92, b: 246 },
    { dot: '🟤', r: 120, g: 80, b: 60 },
    { dot: '⚫', r: 30, g: 30, b: 30 },
    { dot: '⚪', r: 230, g: 230, b: 230 },
  ];
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return '⚪';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  let best = palette[0]; let bestD = Infinity;
  for (const p of palette) {
    const d = (p.r - r) ** 2 + (p.g - g) ** 2 + (p.b - b) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best.dot;
}

// Returns true if the given Outlook category name was created/managed by
// InboxIQ (current short prefix or any legacy variant).
function isManagedCategoryName(name: string): boolean {
  if (!name) return false;
  const n = name.trim();
  // Mirrors the matcher in sync-categories — keep both in sync. Includes
  // numbered Gmail-style mirrors ("02: Follow Up") and the AI helper tags
  // ("0. AI Draft", "11. AI Sent") so they get stripped on every sync.
  if (
    n.startsWith('IQ: ') ||
    n.startsWith('★ IQ: ') ||
    n.startsWith('InboxIQ: ') ||
    n.startsWith('★ InboxIQ: ') ||
    n.startsWith('Wibookly: ') ||
    n.startsWith('vBookly: ') ||
    n.startsWith('Vbookly: ')
  ) return true;
  if (/^\d+\.\s*AI\s+(Draft|Sent)\b/i.test(n)) return true;
  if (/^AI\s+(Draft|Sent)\b/i.test(n)) return true;
  if (/^\d{1,2}:\s/.test(n)) return true;
  return false;
}

// IMPORTANT: Do NOT request MailboxSettings.* scopes — they trigger Microsoft 365
// admin-consent prompts that block end users from completing OAuth.
// Inbox-rule management is therefore not available; we enforce categorization by
// directly MOVING matching emails into the target folder using Mail.ReadWrite.
const MICROSOFT_OUTLOOK_SCOPES = 'openid email profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read';

function isOutlookRuleAccessDenied(errorText: string): boolean {
  return errorText.includes('ErrorAccessDenied') || errorText.includes('Access is denied');
}

// Outlook only supports a fixed set of 25 named "preset" colors on Master Categories.
// Map any hex color (from our categories.color field) to the closest preset.
const OUTLOOK_PRESET_COLORS: Array<{ preset: string; hex: [number, number, number] }> = [
  { preset: 'preset0',  hex: [0xE7, 0x4C, 0x3C] }, // Red
  { preset: 'preset1',  hex: [0xE6, 0x7E, 0x22] }, // Orange
  { preset: 'preset2',  hex: [0xC1, 0x9A, 0x6B] }, // Brown
  { preset: 'preset3',  hex: [0xF1, 0xC4, 0x0F] }, // Yellow
  { preset: 'preset4',  hex: [0x2E, 0xCC, 0x71] }, // Green
  { preset: 'preset5',  hex: [0x16, 0xA0, 0x85] }, // Teal
  { preset: 'preset6',  hex: [0x95, 0xA5, 0xA6] }, // Olive
  { preset: 'preset7',  hex: [0x34, 0x98, 0xDB] }, // Blue
  { preset: 'preset8',  hex: [0x9B, 0x59, 0xB6] }, // Purple
  { preset: 'preset9',  hex: [0xE8, 0x4F, 0x9C] }, // Cranberry
  { preset: 'preset10', hex: [0x7F, 0x8C, 0x8D] }, // Steel
  { preset: 'preset11', hex: [0x2C, 0x3E, 0x50] }, // Dark Steel
  { preset: 'preset12', hex: [0xBD, 0xC3, 0xC7] }, // Gray
  { preset: 'preset13', hex: [0x34, 0x49, 0x5E] }, // Dark Gray
  { preset: 'preset14', hex: [0x00, 0x00, 0x00] }, // Black
  { preset: 'preset15', hex: [0xC0, 0x39, 0x2B] }, // Dark Red
  { preset: 'preset16', hex: [0xD3, 0x54, 0x00] }, // Dark Orange
  { preset: 'preset17', hex: [0x8B, 0x4F, 0x2F] }, // Dark Brown
  { preset: 'preset18', hex: [0xB7, 0x95, 0x0B] }, // Dark Yellow
  { preset: 'preset19', hex: [0x27, 0xAE, 0x60] }, // Dark Green
  { preset: 'preset20', hex: [0x0E, 0x80, 0x68] }, // Dark Teal
  { preset: 'preset21', hex: [0x6B, 0x6F, 0x39] }, // Dark Olive
  { preset: 'preset22', hex: [0x21, 0x6F, 0xA8] }, // Dark Blue
  { preset: 'preset23', hex: [0x71, 0x36, 0x8A] }, // Dark Purple
  { preset: 'preset24', hex: [0xAD, 0x14, 0x57] }, // Dark Cranberry
];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function nearestOutlookPreset(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'preset7'; // default Blue
  let best = OUTLOOK_PRESET_COLORS[0];
  let bestDist = Infinity;
  for (const p of OUTLOOK_PRESET_COLORS) {
    const d =
      (rgb[0] - p.hex[0]) ** 2 +
      (rgb[1] - p.hex[1]) ** 2 +
      (rgb[2] - p.hex[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best.preset;
}

// Ensure an Outlook Master Category exists with the given name + color preset.
// Returns true on success (created or already exists with correct color).
async function ensureOutlookMasterCategory(
  accessToken: string,
  displayName: string,
  hexColor: string
): Promise<boolean> {
  try {
    const preset = nearestOutlookPreset(hexColor);
    const listRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) {
      const errText = await listRes.text();
      console.warn(`Could not list Outlook master categories: ${errText.slice(0, 200)}`);
      return false;
    }
    const { value } = await listRes.json();
    const existing = (value || []).find(
      (c: { displayName: string; id: string; color: string }) =>
        c.displayName === displayName
    );
    if (existing) {
      if (existing.color === preset) return true;
      // Update color to match
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/outlook/masterCategories/${existing.id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ color: preset }),
        }
      );
      return patchRes.ok;
    }
    const createRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ displayName, color: preset }),
      }
    );
    return createRes.ok;
  } catch (err) {
    console.warn('ensureOutlookMasterCategory failed:', err);
    return false;
  }
}

// Tag an Outlook message with a single InboxIQ-managed category. Strips
// any other managed (legacy or current) tags so each message ends up with
// exactly one IQ category — eliminates the duplicate chips users were
// seeing in Outlook (e.g. "InboxIQ: Approvals" + "★ InboxIQ: Approvals" +
// "IQ: Approvals" all on the same message).
async function tagOutlookMessageCategory(
  accessToken: string,
  messageId: string,
  categoryName: string
): Promise<boolean> {
  try {
    const getRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=categories`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    let existing: string[] = [];
    if (getRes.ok) {
      const body = await getRes.json();
      existing = Array.isArray(body.categories) ? body.categories : [];
    }
    // Keep only non-managed user categories, then add the single new tag.
    const preserved = existing.filter((c) => !isManagedCategoryName(c));
    const next = [...preserved, categoryName];
    if (
      existing.length === next.length &&
      existing.every((c, i) => c === next[i])
    ) {
      return true;
    }
    const patchRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ categories: next }),
      }
    );
    return patchRes.ok;
  } catch {
    return false;
  }
}

// Remove all legacy "Wibookly:" prefixed rules from Outlook (one-shot per sync).
async function purgeLegacyOutlookRules(accessToken: string): Promise<number> {
  try {
    const listRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) return 0;
    const { value } = await listRes.json();
    let deleted = 0;
    for (const r of value || []) {
      const name = String(r.displayName || '');
      if (name.startsWith('Wibookly:') || name.startsWith('Wibookly ')) {
        const delRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules/${r.id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (delRes.ok || delRes.status === 404) deleted++;
      }
    }
    if (deleted > 0) console.log(`Purged ${deleted} legacy Wibookly: Outlook rule(s)`);
    return deleted;
  } catch (err) {
    console.warn('purgeLegacyOutlookRules failed:', err);
    return 0;
  }
}

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
      grant_type: 'refresh_token',
      scope: MICROSOFT_OUTLOOK_SCOPES,
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
  userId: string,
  forceRefresh = false,
): Promise<string | null> {
  const isExpired = tokenData.expires_at && new Date(tokenData.expires_at) < new Date();
  
  // If not expired, return decrypted access token
  if (!forceRefresh && !isExpired) {
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

// Apply Gmail filter for a rule AND apply to existing emails
// deno-lint-ignore no-explicit-any
async function applyGmailFilter(accessToken: string, rule: any, labelId: string): Promise<boolean> {
  try {
    // deno-lint-ignore no-explicit-any
    let criteria: any = {};
    const queryParts: string[] = [];
    
    // Primary condition
    if (rule.rule_type === 'sender') {
      criteria.from = rule.rule_value;
      queryParts.push(`from:${rule.rule_value}`);
    } else if (rule.rule_type === 'domain') {
      criteria.from = `@${rule.rule_value}`;
      queryParts.push(`from:@${rule.rule_value}`);
    } else if (rule.rule_type === 'keyword') {
      criteria.query = rule.rule_value;
      queryParts.push(rule.rule_value);
    }

    // Recipient filter (to:me, cc:me)
    if (rule.recipient_filter) {
      if (rule.recipient_filter === 'to_me') {
        queryParts.push('to:me');
        criteria.to = 'me';
      } else if (rule.recipient_filter === 'cc_me') {
        queryParts.push('cc:me');
        // Gmail doesn't have cc in filter criteria, but we can search for it
      } else if (rule.recipient_filter === 'to_or_cc_me') {
        queryParts.push('(to:me OR cc:me)');
      }
    }

    // Advanced conditions - support AND/OR logic
    if (rule.is_advanced) {
      const conditionLogic = rule.condition_logic || 'and';
      const advancedParts: string[] = [];

      if (rule.subject_contains) {
        // Use quotes for exact phrase matching in subject
        const subjectTerm = rule.subject_contains.includes(' ') 
          ? `subject:"${rule.subject_contains}"`
          : `subject:${rule.subject_contains}`;
        advancedParts.push(subjectTerm);
      }
      if (rule.body_contains) {
        // Use quotes for exact phrase matching in body
        const bodyTerm = rule.body_contains.includes(' ')
          ? `"${rule.body_contains}"`
          : rule.body_contains;
        advancedParts.push(bodyTerm);
      }

      // Combine advanced conditions with AND or OR
      if (advancedParts.length > 0) {
        if (conditionLogic === 'or') {
          queryParts.push(`(${advancedParts.join(' OR ')})`);
        } else {
          // AND is the default - just add them
          queryParts.push(...advancedParts);
        }
      }
    }

    // Build final criteria.query from all conditions for the filter
    // Gmail filters need query for complex conditions (subject, body searches)
    if (queryParts.length > 0) {
      criteria.query = queryParts.join(' ');
    }

    const searchQuery = queryParts.join(' ');

    // Create filter for new emails
    const filterRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        criteria,
        action: {
          addLabelIds: [labelId],
          removeLabelIds: []
        }
      })
    });

    if (!filterRes.ok) {
      const errorText = await filterRes.text();
      // Check if filter already exists (409 conflict)
      if (filterRes.status === 409) {
        console.log(`Gmail filter for "${rule.rule_value}" already exists`);
      } else {
        console.error(`Failed to create Gmail filter:`, errorText);
      }
    } else {
      console.log(`Created Gmail filter for: ${rule.rule_value}${rule.is_advanced ? ' (advanced)' : ''}`);
    }

    // Apply label to existing emails matching the criteria
    console.log(`Searching for existing emails with query: ${searchQuery}`);
    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=500`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // Get all emails currently with this label (to find non-matching ones)
    const labeledRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=${labelId}&maxResults=500`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const matchingMessages = searchRes.ok ? (await searchRes.json()).messages || [] : [];
    const labeledMessages = labeledRes.ok ? (await labeledRes.json()).messages || [] : [];

    const matchingIds = new Set(matchingMessages.map((m: { id: string }) => m.id));
    const labeledIds = labeledMessages.map((m: { id: string }) => m.id);

    // Find emails that have the label but don't match the rule anymore
    const nonMatchingIds = labeledIds.filter((id: string) => !matchingIds.has(id));

    // Remove label from non-matching emails (move them back to inbox visibility)
    if (nonMatchingIds.length > 0) {
      console.log(`Found ${nonMatchingIds.length} emails that no longer match the rule - removing label`);
      
      const removeRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ids: nonMatchingIds,
            addLabelIds: [],
            removeLabelIds: [labelId]
          })
        }
      );

      if (removeRes.ok) {
        console.log(`Removed label from ${nonMatchingIds.length} non-matching emails`);
      } else {
        console.error(`Failed to remove label from non-matching emails:`, await removeRes.text());
      }
    }

    // Apply label to matching emails
    if (matchingMessages.length > 0) {
      console.log(`Found ${matchingMessages.length} existing emails to label`);
      
      const messageIds = matchingMessages.map((m: { id: string }) => m.id);
      
      const batchRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ids: messageIds,
            addLabelIds: [labelId],
            removeLabelIds: []
          })
        }
      );

      if (batchRes.ok) {
        console.log(`Applied label to ${messageIds.length} existing emails`);
      } else {
        console.error(`Failed to apply label to existing emails:`, await batchRes.text());
      }
    } else {
      console.log(`No existing emails found matching: ${searchQuery}`);
    }

    return true;
  } catch (error) {
    console.error(`Error creating Gmail filter:`, error);
    return false;
  }
}

// Build Outlook search filter query
// deno-lint-ignore no-explicit-any
function buildOutlookSearchFilter(rule: any): string {
  const filters: string[] = [];
  
  if (rule.rule_type === 'sender') {
    filters.push(`contains(from/emailAddress/address, '${rule.rule_value}')`);
  } else if (rule.rule_type === 'domain') {
    filters.push(`contains(from/emailAddress/address, '@${rule.rule_value}')`);
  } else if (rule.rule_type === 'keyword') {
    filters.push(`(contains(subject, '${rule.rule_value}') or contains(body/content, '${rule.rule_value}'))`);
  }
  
  if (rule.is_advanced) {
    const conditionLogic = rule.condition_logic || 'and';
    const advancedFilters: string[] = [];
    
    if (rule.subject_contains) {
      advancedFilters.push(`contains(subject, '${rule.subject_contains}')`);
    }
    if (rule.body_contains) {
      advancedFilters.push(`contains(body/content, '${rule.body_contains}')`);
    }
    
    if (advancedFilters.length > 0) {
      const connector = conditionLogic === 'or' ? ' or ' : ' and ';
      filters.push(`(${advancedFilters.join(connector)})`);
    }
  }
  
  return filters.join(' and ');
}

// Apply Outlook rule.
//
// We try to create a server-side Outlook inbox rule (so future emails are auto-moved
// by Microsoft itself), BUT this requires the MailboxSettings.ReadWrite scope which
// triggers admin-consent prompts in M365 tenants. When that scope is not granted
// (the normal case for our users), the rules API returns ErrorAccessDenied.
//
// In that case we silently fall back to MOVING matching emails into the folder
// directly via Mail.ReadWrite. Combined with the 5-minute `cron-apply-rules` job,
// new arrivals are continuously moved into the right category folder. From the
// user's perspective the rule is fully enforced — without any admin approval.
// deno-lint-ignore no-explicit-any
async function applyOutlookRule(
  accessToken: string,
  rule: any,
  folderId: string,
  ruleName: string,
  categoryTag?: string,
): Promise<boolean> {
  // Build conditions (used if server-side rule creation succeeds)
  // deno-lint-ignore no-explicit-any
  const conditions: any = {};

  if (rule.rule_type === 'sender') {
    conditions.senderContains = [rule.rule_value];
  } else if (rule.rule_type === 'domain') {
    conditions.senderContains = [`@${rule.rule_value}`];
  } else if (rule.rule_type === 'keyword') {
    conditions.subjectOrBodyContains = [rule.rule_value];
  }

  if (rule.recipient_filter) {
    if (rule.recipient_filter === 'to_me') {
      conditions.sentToMe = true;
    } else if (rule.recipient_filter === 'cc_me') {
      conditions.sentCcMe = true;
    } else if (rule.recipient_filter === 'to_or_cc_me') {
      conditions.sentToMe = true;
    }
  }

  if (rule.is_advanced) {
    const conditionLogic = rule.condition_logic || 'and';
    if (conditionLogic === 'or') {
      const orTerms: string[] = [];
      if (rule.subject_contains) orTerms.push(rule.subject_contains);
      if (rule.body_contains) orTerms.push(rule.body_contains);
      if (orTerms.length > 0) {
        conditions.subjectOrBodyContains = conditions.subjectOrBodyContains
          ? [...conditions.subjectOrBodyContains, ...orTerms]
          : orTerms;
      }
    } else {
      if (rule.subject_contains) conditions.subjectContains = [rule.subject_contains];
      if (rule.body_contains) conditions.bodyContains = [rule.body_contains];
    }
  }

  // ---- Best-effort server-side rule creation (skipped silently if no permission) ----
  let serverRuleCreated = false;
  try {
    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (listRes.ok) {
      const { value: existingRules } = await listRes.json();

      // Cleanup duplicate / legacy rules
      const ruleSuffix = `${rule.rule_type}:${rule.rule_value}`;
      const rulesToDelete = (existingRules || []).filter((r: { id: string; displayName: string }) => {
        const name = r.displayName || '';
        if (name === `Wibookly: ${rule.rule_type} - ${rule.rule_value}`) return true;
        if (name === ruleName) return true;
        if (name.startsWith('InboxIQ: ') && name.endsWith(` - ${ruleSuffix}`)) return true;
        return false;
      });

      for (const dup of rulesToDelete) {
        try {
          await fetch(
            `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules/${dup.id}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch (_) { /* ignore */ }
      }

      const createRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: ruleName,
          sequence: 1,
          isEnabled: true,
          conditions,
          actions: { moveToFolder: folderId, stopProcessingRules: false }
        })
      });

      if (createRes.ok) {
        serverRuleCreated = true;
        console.log(`Created Outlook server-side rule: ${ruleName}`);
      } else {
        const errorText = await createRes.text();
        if (isOutlookRuleAccessDenied(errorText)) {
          console.log(`Outlook server-side rule for "${ruleName}" not created (no MailboxSettings permission) — will enforce by moving emails directly.`);
        } else {
          console.warn(`Could not create Outlook server-side rule "${ruleName}": ${errorText.slice(0, 300)}. Falling back to direct move.`);
        }
      }
    } else {
      const errorText = await listRes.text();
      if (isOutlookRuleAccessDenied(errorText)) {
        console.log(`Outlook server-side rules unavailable (no MailboxSettings permission) — will enforce "${ruleName}" by moving emails directly.`);
      } else {
        console.warn(`Could not list Outlook rules: ${errorText.slice(0, 300)}. Falling back to direct move.`);
      }
    }
  } catch (err) {
    console.warn('Outlook server-side rule step failed, continuing with direct move:', err);
  }

  // ---- Direct move enforcement (always runs, works with Mail.ReadWrite alone) ----
  try {
    // Get inbox folder ID
    const inboxRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!inboxRes.ok) {
      console.error(`Failed to get inbox folder for "${ruleName}":`, await inboxRes.text());
      // We may still have created the server-side rule successfully
      return serverRuleCreated;
    }

    const inboxFolder = await inboxRes.json();
    const inboxId = inboxFolder.id;

    // Get emails currently in the target folder (to detect ones that no longer match)
    const folderEmailsRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=500&$select=id,from,subject,body`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // deno-lint-ignore no-explicit-any
    let folderEmails: any[] = [];
    if (folderEmailsRes.ok) {
      const body = await folderEmailsRes.json();
      folderEmails = body.value || [];
    }

    // Find matching emails across the whole mailbox
    const searchFilter = buildOutlookSearchFilter(rule);
    const matchingRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(searchFilter)}&$top=500&$select=id,parentFolderId,subject`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!matchingRes.ok) {
      console.error(`Failed to search matching Outlook emails for "${ruleName}":`, await matchingRes.text());
      return serverRuleCreated;
    }

    // deno-lint-ignore no-explicit-any
    const matchingEmails: any[] = (await matchingRes.json()).value || [];
    const matchingIds = new Set(matchingEmails.map((m: { id: string }) => m.id));

    // Move matching inbox emails INTO the target folder
    // deno-lint-ignore no-explicit-any
    const inboxMatches = matchingEmails.filter((email: any) => email.parentFolderId === inboxId);
    let movedIntoFolder = 0;
    for (const email of inboxMatches) {
      try {
        const moveRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${email.id}/move`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ destinationId: folderId })
          }
        );
        if (moveRes.ok) {
          movedIntoFolder++;
          // The move returns the new message id; tag it with the colored category
          if (categoryTag) {
            try {
              const moved = await moveRes.json();
              if (moved?.id) {
                await tagOutlookMessageCategory(accessToken, moved.id, categoryTag);
              }
            } catch (_) { /* ignore tag failure */ }
          }
        }
      } catch (_) { /* skip */ }
    }
    // Also tag any emails that already live in the folder (so existing items get color too)
    if (categoryTag) {
      for (const email of folderEmails) {
        if (matchingIds.has(email.id)) {
          try {
            await tagOutlookMessageCategory(accessToken, email.id, categoryTag);
          } catch (_) { /* ignore */ }
        }
      }
    }
    if (movedIntoFolder > 0) {
      console.log(`Moved ${movedIntoFolder} matching inbox emails into folder for "${ruleName}"`);
    }

    // Move non-matching emails currently in the folder back to inbox
    // deno-lint-ignore no-explicit-any
    const nonMatchingEmails = folderEmails.filter((email: any) => !matchingIds.has(email.id));
    let movedOut = 0;
    for (const email of nonMatchingEmails) {
      try {
        const moveRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${email.id}/move`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ destinationId: inboxId })
          }
        );
        if (moveRes.ok) movedOut++;
      } catch (_) { /* skip */ }
    }
    if (movedOut > 0) {
      console.log(`Moved ${movedOut} non-matching emails back to inbox for "${ruleName}"`);
    }

    // Success: even if the server-side rule wasn't created, direct move enforces the rule
    return true;
  } catch (error) {
    console.error(`Direct-move enforcement failed for Outlook rule "${ruleName}":`, error);
    return serverRuleCreated;
  }
}

// Get Gmail label ID by name
async function getGmailLabelId(accessToken: string, labelName: string): Promise<string | null> {
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!res.ok) return null;
    
    const { labels } = await res.json();
    const label = labels?.find((l: { name: string, id: string }) => l.name === labelName);
    return label?.id || null;
  } catch {
    return null;
  }
}

// Get Outlook folder ID by name
// Strip leading invisible (zero-width) chars, emoji/dot, and any numeric
// prefix so we can match an Outlook folder by its clean display name even
// when sync-categories has prepended an invisible sort-order prefix.
function normalizeFolderDisplayName(s: string): string {
  return String(s || '')
    .replace(/^[\u200B-\u200F\u2060-\u206F\uFEFF]+/u, '')
    .replace(/^\s*(?:[⭐★]|\p{Extended_Pictographic})\s*/u, '')
    .replace(/^\s*\d+\s*[:.\-]\s*/u, '')
    .trim()
    .toLowerCase();
}

async function getOutlookFolderId(accessToken: string, folderName: string): Promise<string | null> {
  try {
    const target = normalizeFolderDisplayName(folderName);

    // Page through all top-level folders and match on normalized name so
    // invisible sort-order prefixes don't cause lookup failures.
    let url: string | null = 'https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName';
    while (url) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return null;
      const data: { value?: { displayName: string; id: string }[]; '@odata.nextLink'?: string } = await res.json();
      // Prefer exact match, fall back to normalized match.
      const exact = data.value?.find((f) => f.displayName === folderName);
      if (exact?.id) return exact.id;
      const fuzzy = data.value?.find((f) => normalizeFolderDisplayName(f.displayName) === target);
      if (fuzzy?.id) return fuzzy.id;
      url = data['@odata.nextLink'] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const cronUserId = req.headers.get('x-cron-user-id');
    const cronOrgId = req.headers.get('x-cron-org-id');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isCronCall = authHeader === `Bearer ${serviceRoleKey}` && !!cronUserId && !!cronOrgId;

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let user: { id: string } | null = null;
    let profile: { organization_id: string } | null = null;

    if (isCronCall) {
      // Cron impersonation — service role + headers identifying which user
      user = { id: cronUserId! };
      profile = { organization_id: cronOrgId! };
    } else {
      const supabaseUserClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user: u }, error: authError } = await supabaseUserClient.auth.getUser();
      if (authError || !u) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      user = u;

      const { data: profileData } = await supabaseUserClient.rpc('get_my_profile');
      const p = profileData?.[0];
      if (!p?.organization_id) {
        return new Response(
          JSON.stringify({ error: 'User profile not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      profile = { organization_id: p.organization_id };
    }

    // Parse request body for optional rule_id and connection scoping
    let ruleId: string | null = null;
    let connectionId: string | null = null;
    try {
      const body = await req.json();
      ruleId = body?.rule_id || body?.ruleId || null;
      connectionId = body?.connection_id || body?.connectionId || null;
    } catch {
      // No body or invalid JSON - run all rules
    }

    // Create service role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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
    }

    // Get rules with category info
    let rulesQuery = supabaseAdmin
      .from('rules')
      .select(`
        id,
        rule_type,
        rule_value,
        is_enabled,
        is_advanced,
        subject_contains,
        body_contains,
        condition_logic,
        recipient_filter,
        category_id,
        categories!inner(name, is_enabled, sort_order)
      `)
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true);

    if (connectionId) {
      rulesQuery = rulesQuery.eq('connection_id', connectionId);
    }

    if (ruleId) {
      rulesQuery = rulesQuery.eq('id', ruleId);
    }

    const { data: rules, error: rulesError } = await rulesQuery;

    if (rulesError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch rules' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter rules where category is enabled
    // deno-lint-ignore no-explicit-any
    const enabledRules = rules?.filter(r => (r.categories as any)?.is_enabled) || [];

    if (enabledRules.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No enabled rules found', synced: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Get enabled categories and build the live provider folder/label names.
    let enabledCategoriesQuery = supabaseAdmin
      .from('categories')
      .select('id, name, sort_order, color')
      .eq('organization_id', profile.organization_id)
      .eq('is_enabled', true)
      .order('sort_order');

    if (connectionId) {
      enabledCategoriesQuery = enabledCategoriesQuery.eq('connection_id', connectionId);
    }

    const { data: enabledCategories } = await enabledCategoriesQuery;

    // Map category ID to its display data for provider folder/label naming.
    const categoryMap = new Map(
      enabledCategories?.map((c) => [
        c.id,
        { name: c.name, sortOrder: c.sort_order, color: c.color || '#6366f1' },
      ])
    );

    const results: { provider: string; synced: number; failed: number; error?: string }[] = [];

    // Process each connected provider
    for (const tokenRecord of tokenDataList) {
      try {
        // Get valid access token (will refresh if expired)
        let activeTokenRecord = tokenRecord as TokenData;
        let accessToken = await getValidAccessToken(
          tokenRecord as TokenData,
          encryptionKey,
          user.id
        );
        
        if (!accessToken) {
          console.error(`Could not get valid access token for ${tokenRecord.provider}`);
          results.push({
            provider: tokenRecord.provider,
            synced: 0,
            failed: enabledRules.length,
            error: 'Reconnect your Microsoft mailbox, then run Re-sync All again.'
          });
          continue;
        }

        if (!accessToken) {
          results.push({
            provider: tokenRecord.provider,
            synced: 0,
            failed: enabledRules.length,
            error: 'Microsoft mailbox access token is unavailable. Please reconnect Outlook once, then try Re-sync All again.'
          });
          continue;
        }

        let synced = 0;
        let failed = 0;

        // One-time per-sync setup for Outlook accounts:
        //  - purge any leftover legacy "Wibookly:" rules
        //  - ensure a colored Master Category exists for each enabled category
        const isOutlook =
          tokenRecord.provider === 'microsoft' || tokenRecord.provider === 'outlook';
        if (isOutlook && enabledCategories?.length) {
          await purgeLegacyOutlookRules(accessToken);
          for (const cat of enabledCategories) {
            const tagName = `${IQ_TAG_PREFIX}${cat.name}`;
            await ensureOutlookMasterCategory(accessToken, tagName, cat.color || '#6366f1');
          }
        }

        for (const rule of enabledRules) {
          const catInfo = categoryMap.get(rule.category_id);
          if (!catInfo) continue;
          const currentAccessToken = accessToken;
          if (!currentAccessToken) {
            failed++;
            continue;
          }

          // Label name: colored-dot glyph + category name (no number prefix).
          // Must match sync-categories naming so the folder/label is found.
          const dot = nearestColorDot(catInfo.color);
          const labelName = `${dot} ${catInfo.name}`;
          let success = false;
          
          if (tokenRecord.provider === 'google') {
            const labelId = await getGmailLabelId(currentAccessToken, labelName);
            if (labelId) {
              success = await applyGmailFilter(currentAccessToken, rule, labelId);
            } else {
              console.log(`Gmail label "${labelName}" not found - please sync categories first`);
            }
          } else if (isOutlook) {
            const folderId = await getOutlookFolderId(currentAccessToken, labelName);
            if (folderId) {
              const ruleName = `InboxIQ: ${labelName} - ${rule.rule_type}:${rule.rule_value}`;
              const categoryTag = `${IQ_TAG_PREFIX}${catInfo.name}`;
              success = await applyOutlookRule(
                currentAccessToken,
                rule,
                folderId,
                ruleName,
                categoryTag,
              );
            } else {
              console.log(`Outlook folder "${labelName}" not found - please sync categories first`);
            }
          }
          
          if (success) {
            synced++;
            // Update last_synced_at for this rule
            await supabaseAdmin
              .from('rules')
              .update({ last_synced_at: new Date().toISOString() })
              .eq('id', rule.id);
          } else {
            failed++;
          }
        }

        const providerError = failed > 0 && synced === 0
          ? 'Could not enforce categorization rules — please verify the mailbox is connected and folders exist.'
          : undefined;

        results.push({ provider: tokenRecord.provider, synced, failed, ...(providerError ? { error: providerError } : {}) });
      } catch (error) {
        console.error(`Failed to process ${tokenRecord.provider}:`, error);
        results.push({
          provider: tokenRecord.provider,
          synced: 0,
          failed: enabledRules.length,
          error: error instanceof Error ? error.message : 'Unknown sync error'
        });
      }
    }

    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
    
    // After syncing rules, trigger AI email processing for categories with AI features enabled
    // This runs asynchronously in the background
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    console.log('Triggering AI email processing...');
    
    try {
      const aiProcessResponse = await fetch(`${supabaseUrl}/functions/v1/process-ai-emails`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trigger: 'sync-rules' })
      });
      
      if (aiProcessResponse.ok) {
        const aiResult = await aiProcessResponse.json();
        console.log('AI processing result:', aiResult);
      } else {
        console.error('AI processing failed:', await aiProcessResponse.text());
      }
    } catch (aiError) {
      console.error('Error calling AI processing:', aiError);
      // Don't fail the sync if AI processing fails
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        message: `Synced ${totalSynced} rule(s) across ${results.length} provider(s)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Sync rules error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

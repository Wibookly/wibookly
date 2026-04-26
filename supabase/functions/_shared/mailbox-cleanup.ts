import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface TokenData {
  provider: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

interface ProviderConnection {
  id: string;
  provider: string;
  is_connected: boolean | null;
}

interface CategoryRecord {
  name: string;
  sort_order: number;
  connection_id: string | null;
}

export interface MailboxCleanupResult {
  movedMessages: number;
  deletedFolders: number;
  deletedFilters: number;
  disconnectedProviders: number;
  providers: Array<{
    provider: string;
    status: 'cleaned' | 'skipped' | 'error';
    movedMessages: number;
    deletedFolders: number;
    deletedFilters: number;
    message?: string;
  }>;
}

const DEFAULT_CATEGORY_NAMES = [
  'Urgent',
  'Follow Up',
  'Approvals',
  'Events',
  'Customers',
  'Vendors',
  'Internal',
  'Projects',
  'Finance',
  'FYI',
  'Meetings',
];

function normalizeProvider(provider: string): 'google' | 'outlook' | string {
  const normalized = provider.toLowerCase();
  if (normalized === 'microsoft') return 'outlook';
  return normalized;
}

function stripPrefix(name: string): string {
  return name.replace(/^\s*\d+\s*[:.\-]\s*/, '').trim().toLowerCase();
}

function padCategoryName(sortOrder: number, name: string): string {
  return `${String(sortOrder + 1).padStart(2, '0')}: ${name}`;
}

function shouldCleanupName(
  name: string,
  canonicalNames: Set<string>,
  knownBaseNames: Set<string>,
): boolean {
  const trimmed = name.trim();
  const normalized = trimmed.toLowerCase();
  if (canonicalNames.has(normalized)) return true;
  if (/^\s*\d+\s*[:.\-]/.test(trimmed) && knownBaseNames.has(stripPrefix(trimmed))) return true;
  return normalized === 'meetings' || normalized === '04: meetings' || normalized === '4: meetings';
}

async function decryptToken(encryptedData: string, keyString: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function refreshGoogleToken(refreshToken: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) return null;
  return await response.json();
}

async function refreshMicrosoftToken(refreshToken: string) {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) return null;
  return await response.json();
}

async function getValidAccessToken(
  adminClient: SupabaseClient,
  userId: string,
  tokenData: TokenData,
  encryptionKey: string,
): Promise<string | null> {
  const isExpired = tokenData.expires_at && new Date(tokenData.expires_at) < new Date();
  if (!isExpired) {
    return await decryptToken(tokenData.encrypted_access_token, encryptionKey);
  }

  if (!tokenData.encrypted_refresh_token) return null;

  const refreshToken = await decryptToken(tokenData.encrypted_refresh_token, encryptionKey);
  const newTokens = normalizeProvider(tokenData.provider) === 'google'
    ? await refreshGoogleToken(refreshToken)
    : await refreshMicrosoftToken(refreshToken);

  if (!newTokens?.access_token) return null;

  const updatePayload: Record<string, string> = {
    encrypted_access_token: await encryptToken(newTokens.access_token, encryptionKey),
    expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (newTokens.refresh_token) {
    updatePayload.encrypted_refresh_token = await encryptToken(String(newTokens.refresh_token), encryptionKey);
  }

  await adminClient
    .from('oauth_token_vault')
    .update(updatePayload)
    .eq('user_id', userId)
    .eq('provider', tokenData.provider);

  return newTokens.access_token;
}

async function restoreGmailLabelToInbox(accessToken: string, labelId: string, labelName: string): Promise<number> {
  let movedTotal = 0;
  let pageToken: string | undefined;

  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('labelIds', labelId);
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) break;

    const payload = await response.json();
    const ids = (payload.messages ?? []).map((message: { id: string }) => message.id);

    if (ids.length > 0) {
      const modifyRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids,
          addLabelIds: ['INBOX'],
          removeLabelIds: [labelId],
        }),
      });

      if (modifyRes.ok) movedTotal += ids.length;
      else console.error(`Failed restoring Gmail label "${labelName}" to inbox`, await modifyRes.text());
    }

    pageToken = payload.nextPageToken;
  } while (pageToken);

  return movedTotal;
}

async function cleanupGmailProvider(
  accessToken: string,
  canonicalNames: Set<string>,
  knownBaseNames: Set<string>,
) {
  let movedMessages = 0;
  let deletedFolders = 0;
  let deletedFilters = 0;

  const labelsRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!labelsRes.ok) {
    throw new Error(`Failed to list Gmail labels: ${await labelsRes.text()}`);
  }

  const { labels } = await labelsRes.json();
  const cleanupLabels = (labels ?? []).filter((label: { id: string; name: string; type?: string }) =>
    label.type !== 'system' && shouldCleanupName(label.name, canonicalNames, knownBaseNames),
  );

  const cleanupLabelIds = new Set(cleanupLabels.map((label: { id: string }) => label.id));
  if (cleanupLabelIds.size > 0) {
    const filtersRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (filtersRes.ok) {
      const { filter: filters } = await filtersRes.json();
      for (const filter of filters ?? []) {
        const addLabelIds: string[] = filter.action?.addLabelIds ?? [];
        if (!addLabelIds.some((id) => cleanupLabelIds.has(id))) continue;

        const deleteRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/${filter.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (deleteRes.ok || deleteRes.status === 404) deletedFilters += 1;
      }
    }
  }

  for (const label of cleanupLabels) {
    movedMessages += await restoreGmailLabelToInbox(accessToken, label.id, label.name);
    const deleteRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${label.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (deleteRes.ok || deleteRes.status === 404) deletedFolders += 1;
  }

  return { movedMessages, deletedFolders, deletedFilters };
}

async function getOutlookInboxId(accessToken: string): Promise<string> {
  try {
    const inboxRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!inboxRes.ok) return 'inbox';
    const inbox = await inboxRes.json();
    return inbox.id || 'inbox';
  } catch {
    return 'inbox';
  }
}

async function restoreOutlookFolderToInbox(accessToken: string, folderId: string): Promise<number> {
  const inboxId = await getOutlookInboxId(accessToken);
  let movedTotal = 0;
  let nextLink: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$select=id&$top=50`;

  while (nextLink) {
    const listRes = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) break;

    const payload = await listRes.json();
    for (const message of payload.value ?? []) {
      const moveRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${message.id}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destinationId: inboxId }),
      });
      if (moveRes.ok) movedTotal += 1;
    }

    nextLink = payload['@odata.nextLink'] ?? null;
  }

  return movedTotal;
}

async function cleanupOutlookProvider(
  accessToken: string,
  canonicalNames: Set<string>,
  knownBaseNames: Set<string>,
) {
  let movedMessages = 0;
  let deletedFolders = 0;
  let deletedFilters = 0;

  const rulesRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (rulesRes.ok) {
    const { value: rules } = await rulesRes.json();
    for (const rule of rules ?? []) {
      const displayName = String(rule.displayName || '');
      if (!displayName.startsWith('InboxIQ:') && !displayName.startsWith('Wibookly:')) continue;
      const deleteRes = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules/${rule.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (deleteRes.ok || deleteRes.status === 404) deletedFilters += 1;
    }
  }

  const foldersRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!foldersRes.ok) {
    throw new Error(`Failed to list Outlook folders: ${await foldersRes.text()}`);
  }

  const { value: folders } = await foldersRes.json();
  const cleanupFolders = (folders ?? []).filter((folder: { id: string; displayName: string }) =>
    shouldCleanupName(folder.displayName, canonicalNames, knownBaseNames),
  );

  for (const folder of cleanupFolders) {
    movedMessages += await restoreOutlookFolderToInbox(accessToken, folder.id);
    const deleteRes = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (deleteRes.ok || deleteRes.status === 404) deletedFolders += 1;
  }

  return { movedMessages, deletedFolders, deletedFilters };
}

export async function cleanupUserMailboxAndDisconnect(
  adminClient: SupabaseClient,
  options: { userId: string; organizationId: string; disconnectAfterCleanup?: boolean },
): Promise<MailboxCleanupResult> {
  const { userId, organizationId, disconnectAfterCleanup = true } = options;
  const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY');

  const summary: MailboxCleanupResult = {
    movedMessages: 0,
    deletedFolders: 0,
    deletedFilters: 0,
    disconnectedProviders: 0,
    providers: [],
  };

  const { data: connections } = await adminClient
    .from('provider_connections')
    .select('id, provider, is_connected')
    .eq('user_id', userId)
    .eq('organization_id', organizationId);

  const connectionRows = (connections ?? []) as ProviderConnection[];
  if (connectionRows.length === 0) return summary;

  const connectionIds = connectionRows.map((connection) => connection.id);
  const { data: categories } = await adminClient
    .from('categories')
    .select('name, sort_order, connection_id')
    .eq('organization_id', organizationId)
    .in('connection_id', connectionIds);

  const categoryRows = (categories ?? []) as CategoryRecord[];

  const { data: tokens } = await adminClient
    .from('oauth_token_vault')
    .select('provider, encrypted_access_token, encrypted_refresh_token, expires_at')
    .eq('user_id', userId);

  const tokenMap = new Map(
    ((tokens ?? []) as TokenData[]).map((token) => [normalizeProvider(token.provider), token]),
  );

  for (const connection of connectionRows) {
    const provider = normalizeProvider(connection.provider);
    const providerCategories = categoryRows.filter((category) => category.connection_id === connection.id);
    const canonicalNames = new Set(providerCategories.map((category) => padCategoryName(category.sort_order, category.name).toLowerCase()));
    const knownBaseNames = new Set([
      ...DEFAULT_CATEGORY_NAMES.map((name) => name.toLowerCase()),
      ...providerCategories.map((category) => category.name.trim().toLowerCase()),
    ]);

    const token = tokenMap.get(provider);
    if (!token || !encryptionKey) {
      summary.providers.push({
        provider,
        status: 'skipped',
        movedMessages: 0,
        deletedFolders: 0,
        deletedFilters: 0,
        message: 'No mailbox token available for cleanup.',
      });
      continue;
    }

    try {
      const accessToken = await getValidAccessToken(adminClient, userId, token, encryptionKey);
      if (!accessToken) {
        summary.providers.push({
          provider,
          status: 'skipped',
          movedMessages: 0,
          deletedFolders: 0,
          deletedFilters: 0,
          message: 'Mailbox token expired and could not be refreshed.',
        });
        continue;
      }

      const providerSummary = provider === 'google'
        ? await cleanupGmailProvider(accessToken, canonicalNames, knownBaseNames)
        : await cleanupOutlookProvider(accessToken, canonicalNames, knownBaseNames);

      summary.movedMessages += providerSummary.movedMessages;
      summary.deletedFolders += providerSummary.deletedFolders;
      summary.deletedFilters += providerSummary.deletedFilters;
      summary.providers.push({
        provider,
        status: 'cleaned',
        ...providerSummary,
      });
    } catch (error) {
      console.error(`Mailbox cleanup failed for ${provider}`, error);
      summary.providers.push({
        provider,
        status: 'error',
        movedMessages: 0,
        deletedFolders: 0,
        deletedFilters: 0,
        message: error instanceof Error ? error.message : 'Unknown cleanup error',
      });
    }
  }

  if (disconnectAfterCleanup) {
    await adminClient
      .from('provider_connections')
      .update({
        is_connected: false,
        calendar_connected: false,
        connected_at: null,
        calendar_connected_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('organization_id', organizationId);

    await adminClient.from('oauth_token_vault').delete().eq('user_id', userId);
    summary.disconnectedProviders = connectionRows.length;
  }

  return summary;
}

export async function purgeUserConnectionData(adminClient: SupabaseClient, userId: string): Promise<void> {
  const { data: connections } = await adminClient
    .from('provider_connections')
    .select('id')
    .eq('user_id', userId);

  const connectionIds = (connections ?? []).map((connection: { id: string }) => connection.id);
  if (connectionIds.length > 0) {
    await adminClient.from('availability_hours').delete().in('connection_id', connectionIds);
    await adminClient.from('email_profiles').delete().in('connection_id', connectionIds);
    await adminClient.from('ai_settings').delete().in('connection_id', connectionIds);
    await adminClient.from('ai_activity_logs').delete().in('connection_id', connectionIds);
    await adminClient.from('ai_chat_conversations').delete().in('connection_id', connectionIds);
    await adminClient.from('rules').delete().in('connection_id', connectionIds);
    await adminClient.from('categories').delete().in('connection_id', connectionIds);
  }

  await adminClient.from('oauth_token_vault').delete().eq('user_id', userId);
  await adminClient.from('provider_connections').delete().eq('user_id', userId);
}
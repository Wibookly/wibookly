// Static structural inventory for the Admin → Integrations dashboard.
// Live status comes from the integration_health table, not from here.

export type NodeStatus = 'healthy' | 'warning' | 'failed' | 'idle';

export type SubService = {
  id: string;                 // integration_key in integration_health
  name: string;
  icon: string;               // lucide-react icon name
  description: string;
  /** Settings-tab variant for this sub-service. */
  settingsKind?:
    | 'mailbox_oauth'
    | 'chat_models'
    | 'nova3_streaming'
    | 'storage_buckets'
    | 'pg_cron'
    | 'pgmq_queue'
    | 'generic';
  /** Table to query for the Audit tab. */
  auditSource?:
    | { kind: 'm365_api_health'; endpoint?: string }
    | { kind: 'llm_call_logs'; provider?: string }
    | { kind: 'connect_attempts' }
    | { kind: 'email_send_log' }
    | { kind: 'ai_activity_logs'; feature?: string }
    | { kind: 'none'; note?: string };
  calledBy?: string[];
};

export type Provider = {
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  description: string;
  meta: string;
  credentials: Array<{ label: string; secret: string }>;
  extraCredentials?: { title: string; rows: Array<{ label: string; secret: string }> };
  scopes?: string[];
  subs: SubService[];
  /** LLM gateway is an internal router — show banner instead of credential form. */
  isRouter?: boolean;
  /** Recovery / rotate console link. */
  consoleUrl?: { label: string; url: string };
  /** Optional snapshot stats to render in Overview (label/value). Computed live elsewhere. */
};

export type Feature = {
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  aiDependencies: Array<{ targetId: string; usage: string }>;
  otherDependencies: Array<{ targetId: string; usage: string }>;
  aiModelSteps?: Array<{ key: string; label: string; options: string[] }>;
};

export type Group = {
  id: 'microsoft' | 'google' | 'ai' | 'platform' | 'features';
  label: string;
  /** Clickable group header (only AI for now) opens a hub view. */
  hubId?: string;
  providers?: Provider[];
  features?: Feature[];
};

/* -------------------- Microsoft -------------------- */

const microsoft: Provider = {
  id: 'microsoft',
  name: 'Microsoft (Azure AD app)',
  icon: 'Building2',
  subtitle: 'Azure App Registration powering SSO, OAuth, and Graph access.',
  description:
    'One Azure App Registration provides Microsoft SSO, per-user OAuth, tenant admin consent, and Graph access to Mail, Calendar, OneDrive, SharePoint, and Teams.',
  meta: 'Azure tenant: energyforward.onmicrosoft.com · App: InboxIQ · Multi-tenant',
  credentials: [
    { label: 'Azure client ID', secret: 'MICROSOFT_CLIENT_ID' },
    { label: 'Azure client secret', secret: 'MICROSOFT_CLIENT_SECRET' },
    { label: 'Azure tenant ID', secret: 'MICROSOFT_TENANT_ID' },
    { label: 'Token encryption key', secret: 'TOKEN_ENCRYPTION_KEY' },
  ],
  extraCredentials: {
    title: 'Teams Bot Framework (separate Azure app)',
    rows: [
      { label: 'Bot app ID', secret: 'TEAMS_BOT_APP_ID' },
      { label: 'Bot app password', secret: 'TEAMS_BOT_APP_PASSWORD' },
      { label: 'Bot tenant ID', secret: 'TEAMS_BOT_TENANT_ID' },
    ],
  },
  scopes: [
    'openid', 'profile', 'email', 'offline_access',
    'User.Read', 'Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite',
    'Calendars.ReadWrite', 'Files.ReadWrite.All', 'Sites.Read.All', 'Chat.Read',
  ],
  consoleUrl: { label: 'Open Azure portal', url: 'https://portal.azure.com/' },
  subs: [
    { id: 'ms-sso', name: 'Sign-in (SSO)', icon: 'LogIn', description: 'OIDC sign-in via Microsoft identity platform.',
      settingsKind: 'generic', auditSource: { kind: 'connect_attempts' }, calledBy: ['microsoft-sso-init', 'microsoft-sso-callback'] },
    { id: 'ms-oauth', name: 'Mailbox OAuth', icon: 'KeyRound', description: 'Per-user OAuth tokens for mailbox access.',
      settingsKind: 'mailbox_oauth', auditSource: { kind: 'connect_attempts' }, calledBy: ['oauth-init', 'oauth-callback'] },
    { id: 'ms-admin-consent', name: 'Tenant admin consent', icon: 'ShieldCheck', description: 'Admin-grant flow for tenant-wide scopes.',
      settingsKind: 'generic', auditSource: { kind: 'connect_attempts' }, calledBy: ['microsoft-admin-consent-callback'] },
    { id: 'outlook-mail', name: 'Outlook Mail (Graph)', icon: 'Mail', description: '/me/messages endpoints.',
      settingsKind: 'generic', auditSource: { kind: 'm365_api_health', endpoint: 'messages' }, calledBy: ['ingest-email', 'draft-email', 'agent-orchestrator'] },
    { id: 'calendar', name: 'Calendar (Graph)', icon: 'Calendar', description: '/me/calendarView and events.',
      settingsKind: 'generic', auditSource: { kind: 'm365_api_health', endpoint: 'calendar' }, calledBy: ['meeting-copilot-prep', 'log-calendar-event'] },
    { id: 'onedrive', name: 'OneDrive (Graph)', icon: 'FolderOpen', description: 'File reads for RAG and previews.',
      settingsKind: 'generic', auditSource: { kind: 'm365_api_health', endpoint: 'drive' }, calledBy: ['m365-extract-file', 'ingest-document'] },
    { id: 'sharepoint', name: 'SharePoint (Graph)', icon: 'Building2', description: 'Site & document library search.',
      settingsKind: 'generic', auditSource: { kind: 'm365_api_health', endpoint: 'sites' }, calledBy: ['retrieve-context'] },
    { id: 'teams-graph', name: 'Teams chat (Graph)', icon: 'MessageSquare', description: 'Teams chat reads via Graph.',
      settingsKind: 'generic', auditSource: { kind: 'm365_api_health', endpoint: 'teams' }, calledBy: ['agent-orchestrator'] },
    { id: 'graph-webhooks', name: 'Graph webhooks', icon: 'Webhook', description: 'Push subscriptions for new mail.',
      settingsKind: 'generic', auditSource: { kind: 'm365_api_health', endpoint: 'subscriptions' }, calledBy: ['graph-mail-webhook', 'cron-renew-graph-subscriptions'] },
    { id: 'teams-bot', name: 'Teams Bot Framework', icon: 'Bot', description: 'Bot Framework messaging for AI chat in Teams.',
      settingsKind: 'generic', auditSource: { kind: 'none', note: 'Bot Framework logs live in Azure.' }, calledBy: ['teams-bot'] },
  ],
};

/* -------------------- Google -------------------- */

const google: Provider = {
  id: 'google',
  name: 'Google (OAuth client)',
  icon: 'Chrome',
  subtitle: 'OAuth configured; production API callers not yet implemented.',
  description: 'Google OAuth client for future Gmail / Calendar / Drive integration. No production callers in the codebase yet — sub-services are stubs.',
  meta: 'Stub provider · no Gmail/Calendar/Drive call sites in edge functions',
  credentials: [
    { label: 'Google client ID', secret: 'GOOGLE_CLIENT_ID' },
    { label: 'Google client secret', secret: 'GOOGLE_CLIENT_SECRET' },
  ],
  scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
  consoleUrl: { label: 'Open Google Cloud Console', url: 'https://console.cloud.google.com/' },
  subs: [
    { id: 'g-oauth', name: 'Google OAuth', icon: 'KeyRound', description: 'Configured but not yet invoked.', settingsKind: 'generic', auditSource: { kind: 'none', note: 'Stub.' } },
    { id: 'g-gmail', name: 'Gmail API', icon: 'Mail', description: 'No call sites yet.', settingsKind: 'generic', auditSource: { kind: 'none', note: 'Stub.' } },
    { id: 'g-calendar', name: 'Google Calendar', icon: 'Calendar', description: 'No call sites yet.', settingsKind: 'generic', auditSource: { kind: 'none', note: 'Stub.' } },
    { id: 'g-drive', name: 'Google Drive', icon: 'FolderOpen', description: 'No call sites yet.', settingsKind: 'generic', auditSource: { kind: 'none', note: 'Stub.' } },
  ],
};

/* -------------------- AI -------------------- */

const llmGateway: Provider = {
  id: 'llm-gateway',
  name: 'LLM gateway (router)',
  icon: 'Network',
  subtitle: 'Internal router for chat/agent calls.',
  description: 'Internal Edge Function that routes chat and agent traffic to OpenAI or Anthropic based on feature configuration. Holds no credentials of its own.',
  meta: 'Function: llm-gateway · uses OPENAI_API_KEY and ANTHROPIC_API_KEY',
  credentials: [],
  isRouter: true,
  subs: [],
};

const openai: Provider = {
  id: 'openai',
  name: 'OpenAI',
  icon: 'Brain',
  subtitle: 'Chat, embeddings, and Whisper.',
  description: 'Provides chat models (GPT-4o / GPT-5), embeddings, and Whisper speech-to-text under a single API key.',
  meta: 'Account billed via OpenAI · key OPENAI_API_KEY',
  credentials: [{ label: 'OpenAI API key', secret: 'OPENAI_API_KEY' }],
  consoleUrl: { label: 'Open OpenAI dashboard', url: 'https://platform.openai.com/' },
  subs: [
    { id: 'openai-chat', name: 'Chat models', icon: 'MessageSquare', description: 'GPT-4o, GPT-5 family.', settingsKind: 'chat_models', auditSource: { kind: 'llm_call_logs', provider: 'openai' }, calledBy: ['llm-gateway', 'agent-orchestrator', 'chat-agent'] },
    { id: 'openai-embed', name: 'Embeddings', icon: 'Sparkles', description: 'text-embedding-3 family for RAG.', settingsKind: 'generic', auditSource: { kind: 'llm_call_logs', provider: 'openai' }, calledBy: ['embed-text', 'ingest-document'] },
    { id: 'openai-whisper', name: 'Whisper (voice in)', icon: 'Mic', description: 'Speech-to-text for voice messages.', settingsKind: 'generic', auditSource: { kind: 'llm_call_logs', provider: 'openai' }, calledBy: ['voice-to-text'] },
  ],
};

const anthropic: Provider = {
  id: 'anthropic',
  name: 'Anthropic',
  icon: 'Sparkles',
  subtitle: 'Claude models.',
  description: 'Claude 3.5 and Sonnet 4.5 for high-quality reasoning and tool use.',
  meta: 'Account billed via Anthropic · key ANTHROPIC_API_KEY',
  credentials: [{ label: 'Anthropic API key', secret: 'ANTHROPIC_API_KEY' }],
  consoleUrl: { label: 'Open Anthropic console', url: 'https://console.anthropic.com/' },
  subs: [
    { id: 'anthropic-claude', name: 'Claude models', icon: 'MessageSquare', description: 'claude-sonnet-4-5, claude-3-5.', settingsKind: 'chat_models', auditSource: { kind: 'llm_call_logs', provider: 'anthropic' }, calledBy: ['llm-gateway', 'meeting-copilot-suggestion'] },
  ],
};

const lovableAI: Provider = {
  id: 'lovable-ai',
  name: 'Lovable AI gateway',
  icon: 'Cpu',
  subtitle: 'Gemini Flash and other models without per-key billing.',
  description: 'Lovable AI Gateway provides access to Gemini Flash models for transactional features (categorization, daily brief).',
  meta: 'Key LOVABLE_API_KEY · billed via Lovable',
  credentials: [{ label: 'Lovable API key', secret: 'LOVABLE_API_KEY' }],
  subs: [
    { id: 'lovable-gemini', name: 'Gemini Flash', icon: 'Sparkles', description: 'gemini-3-flash-preview and friends.', settingsKind: 'generic', auditSource: { kind: 'llm_call_logs', provider: 'lovable' }, calledBy: ['ai-daily-brief', 'clean-email', 'sync-categories'] },
  ],
};

const deepgram: Provider = {
  id: 'deepgram',
  name: 'Deepgram',
  icon: 'Mic',
  subtitle: 'Live diarized streaming STT.',
  description: 'Nova-3 streaming transcription for Meeting Copilot live captions and speaker diarization.',
  meta: 'Key DEEPGRAM_API_KEY · pay-per-minute',
  credentials: [{ label: 'Deepgram API key', secret: 'DEEPGRAM_API_KEY' }],
  consoleUrl: { label: 'Open Deepgram console', url: 'https://console.deepgram.com/' },
  subs: [
    { id: 'deepgram-nova3', name: 'Nova-3 streaming', icon: 'Mic', description: 'WebSocket streaming STT with diarization.', settingsKind: 'nova3_streaming', auditSource: { kind: 'none', note: 'Would require new logging — currently relies on call-time errors only.' }, calledBy: ['deepgram-token', 'LiveCopilotSession.tsx'] },
  ],
};

/* -------------------- Platform -------------------- */

const supabasePlat: Provider = {
  id: 'supabase',
  name: 'Supabase',
  icon: 'Database',
  subtitle: 'Auth, Postgres, Storage, Realtime, cron, queue.',
  description: 'Managed Postgres + Auth + Storage + Realtime, accessed via the auto-generated client and Edge Functions.',
  meta: 'Project: jbzctydskdpzrejvpwpn · Lovable Cloud',
  credentials: [],
  isRouter: true,
  subs: [
    { id: 'sb-auth', name: 'Auth', icon: 'KeyRound', description: 'Email + OAuth identity providers.', settingsKind: 'generic', auditSource: { kind: 'none', note: 'Source: Supabase edge function logs.' } },
    { id: 'sb-storage', name: 'Storage (5 buckets)', icon: 'FolderOpen', description: 'Avatars, attachments, exports, transcripts, knowledge.', settingsKind: 'storage_buckets', auditSource: { kind: 'none', note: 'Source: Supabase edge function logs.' } },
    { id: 'sb-realtime', name: 'Realtime', icon: 'Activity', description: 'Postgres changes streamed to clients.', settingsKind: 'generic', auditSource: { kind: 'none' } },
    { id: 'sb-cron', name: 'pg_cron jobs', icon: 'Clock', description: 'Scheduled jobs running edge functions.', settingsKind: 'pg_cron', auditSource: { kind: 'none', note: 'See individual cron logs.' } },
    { id: 'sb-pgmq', name: 'Email queue (pgmq)', icon: 'Inbox', description: 'Transactional email queue with DLQ.', settingsKind: 'pgmq_queue', auditSource: { kind: 'email_send_log' } },
  ],
};

const lovableEmail: Provider = {
  id: 'lovable-email',
  name: 'Lovable email gateway',
  icon: 'Mail',
  subtitle: 'Outbound transactional email.',
  description: 'Sends transactional email (invites, alerts, daily brief) through the Lovable send URL.',
  meta: 'Endpoint LOVABLE_SEND_URL',
  credentials: [{ label: 'Lovable send URL', secret: 'LOVABLE_SEND_URL' }],
  subs: [
    { id: 'lovable-email-tx', name: 'Transactional sends', icon: 'Mail', description: 'send-transactional-email function.', settingsKind: 'generic', auditSource: { kind: 'email_send_log' }, calledBy: ['send-transactional-email', 'send-daily-brief'] },
  ],
};

/* -------------------- Features -------------------- */

const features: Feature[] = [
  {
    id: 'feat-ai-email-agent', name: 'AI email agent', icon: 'Bot',
    subtitle: 'Categorizes inbox, drafts replies, and proposes follow-ups.',
    aiDependencies: [
      { targetId: 'openai-chat', usage: 'OpenAI — Categorization, draft replies' },
      { targetId: 'lovable-gemini', usage: 'Lovable AI — Cleaning & sync passes' },
    ],
    otherDependencies: [
      { targetId: 'outlook-mail', usage: 'Microsoft Graph — Read/write messages' },
      { targetId: 'graph-webhooks', usage: 'Microsoft Graph — New-mail webhooks' },
      { targetId: 'sb-cron', usage: 'Supabase — process-ai-emails cron' },
    ],
    aiModelSteps: [
      { key: 'categorize', label: 'Categorization', options: ['openai/gpt-5-mini', 'openai/gpt-4o-mini', 'google/gemini-3-flash-preview'] },
      { key: 'draft', label: 'Draft replies', options: ['openai/gpt-5', 'anthropic/claude-sonnet-4-5'] },
    ],
  },
  {
    id: 'feat-meeting-copilot', name: 'Meeting Copilot', icon: 'Mic',
    subtitle: 'Live transcription, in-meeting suggestions, post-meeting summary.',
    aiDependencies: [
      { targetId: 'deepgram-nova3', usage: 'Deepgram — Live diarized transcription' },
      { targetId: 'anthropic-claude', usage: 'Anthropic — In-meeting suggestions' },
      { targetId: 'openai-chat', usage: 'OpenAI — Post-meeting summary' },
    ],
    otherDependencies: [
      { targetId: 'calendar', usage: 'Microsoft Graph — Calendar pre-read' },
      { targetId: 'onedrive', usage: 'Microsoft Graph — Attachment pulls' },
    ],
    aiModelSteps: [
      { key: 'live', label: 'Live suggestions', options: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5-mini'] },
      { key: 'summary', label: 'Post-meeting summary', options: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4-5'] },
      { key: 'prep', label: 'Pre-meeting prep', options: ['google/gemini-3-flash-preview', 'openai/gpt-4.1-mini'] },
    ],
  },
  {
    id: 'feat-ai-chat', name: 'AI chat (web + Teams)', icon: 'MessageSquare',
    subtitle: 'Conversational assistant in the web app and Teams.',
    aiDependencies: [
      { targetId: 'openai-chat', usage: 'OpenAI — Default chat model' },
      { targetId: 'anthropic-claude', usage: 'Anthropic — Tool-use fallback' },
    ],
    otherDependencies: [
      { targetId: 'teams-bot', usage: 'Teams Bot Framework — Inbound messages' },
      { targetId: 'outlook-mail', usage: 'Microsoft Graph — Mail tool' },
    ],
    aiModelSteps: [
      { key: 'web', label: 'Web chat', options: ['openai/gpt-5', 'anthropic/claude-sonnet-4-5'] },
      { key: 'teams', label: 'Teams chat', options: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-4-5'] },
    ],
  },
  {
    id: 'feat-daily-brief', name: 'Daily brief', icon: 'FileText',
    subtitle: 'Scheduled summary of the day delivered via email.',
    aiDependencies: [{ targetId: 'lovable-gemini', usage: 'Lovable AI — Brief composition' }],
    otherDependencies: [
      { targetId: 'sb-cron', usage: 'Supabase — Daily cron' },
      { targetId: 'lovable-email-tx', usage: 'Lovable email — Delivery' },
    ],
  },
  {
    id: 'feat-rag', name: 'Document indexing (RAG)', icon: 'FolderOpen',
    subtitle: 'Indexes mail and documents for retrieval at chat time.',
    aiDependencies: [{ targetId: 'openai-embed', usage: 'OpenAI — Embeddings' }],
    otherDependencies: [
      { targetId: 'onedrive', usage: 'Microsoft Graph — Document fetch' },
      { targetId: 'sb-storage', usage: 'Supabase — Embedding storage' },
    ],
  },
];

/* -------------------- Groups -------------------- */

export const GROUPS: Group[] = [
  { id: 'microsoft', label: 'Microsoft', providers: [microsoft] },
  { id: 'google', label: 'Google', providers: [google] },
  { id: 'ai', label: 'AI', hubId: 'ai-hub', providers: [llmGateway, openai, anthropic, lovableAI, deepgram] },
  { id: 'platform', label: 'Platform', providers: [supabasePlat, lovableEmail] },
  { id: 'features', label: 'Features', features },
];

export const ALL_PROVIDERS: Provider[] = GROUPS.flatMap((g) => g.providers ?? []);
export const ALL_FEATURES: Feature[] = GROUPS.flatMap((g) => g.features ?? []);
export const ALL_SUBS: SubService[] = ALL_PROVIDERS.flatMap((p) => p.subs);

export const ALLOWED_SECRET_NAMES = [
  'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID', 'TOKEN_ENCRYPTION_KEY',
  'TEAMS_BOT_APP_ID', 'TEAMS_BOT_APP_PASSWORD', 'TEAMS_BOT_TENANT_ID',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'LOVABLE_API_KEY', 'LOVABLE_SEND_URL', 'DEEPGRAM_API_KEY',
] as const;

/** Lookup helpers */
export function findProvider(id: string): Provider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}
export function findSub(id: string): { sub: SubService; provider: Provider } | undefined {
  for (const p of ALL_PROVIDERS) {
    const s = p.subs.find((x) => x.id === id);
    if (s) return { sub: s, provider: p };
  }
  return undefined;
}
export function findFeature(id: string): Feature | undefined {
  return ALL_FEATURES.find((f) => f.id === id);
}

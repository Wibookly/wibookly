export const FEATURE_KEYS = {
  AI_CHAT: 'ai_chat',
  AI_DRAFT: 'ai_draft',
  AI_AUTO_REPLY: 'ai_auto_reply',
  EMAIL_INTELLIGENCE: 'email_intelligence',
  DAILY_BRIEF: 'daily_brief',
  ACTIVITY_REPORTS: 'activity_reports',
  EMAIL_AGENT: 'email_agent',
  TEAMS_AGENT: 'teams_agent',
  FOLLOW_UP_REMINDER: 'follow_up_reminder',
  MEETING_COPILOT: 'meeting_copilot',
  DOCUMENTS: 'documents',
  POWERPOINTS: 'powerpoints',
  EXCEL: 'excel',
  FILE_READING: 'file_reading',
  EGNYTE_INTEGRATION: 'egnyte_integration',
  UNANET_INTEGRATION: 'unanet_integration',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  description: string;
}

export const FEATURE_LIST: readonly FeatureMeta[] = [
  { key: FEATURE_KEYS.AI_CHAT, label: 'AI Chat', description: 'AI chat assistant in Teams and the app' },
  { key: FEATURE_KEYS.AI_DRAFT, label: 'AI Draft', description: 'AI-powered email draft generation' },
  { key: FEATURE_KEYS.AI_AUTO_REPLY, label: 'AI Auto Reply', description: 'Automatic AI email replies' },
  { key: FEATURE_KEYS.DAILY_BRIEF, label: 'My Daily Brief', description: 'Daily Brief access and scheduling' },
  { key: FEATURE_KEYS.ACTIVITY_REPORTS, label: 'AI Activity Reports', description: 'AI activity reports & analytics' },
  { key: FEATURE_KEYS.EMAIL_AGENT, label: 'Email Agent', description: 'AI replies to emails sent to the shared agent mailbox' },
  { key: FEATURE_KEYS.TEAMS_AGENT, label: 'Teams Agent', description: 'AI responds to @mentions and DMs in Microsoft Teams' },
  { key: FEATURE_KEYS.FOLLOW_UP_REMINDER, label: 'Follow-Up Reminder', description: 'BCC-triggered Auto-Reminder feature' },
  { key: FEATURE_KEYS.DOCUMENTS, label: 'Documents', description: 'Generate Word documents' },
  { key: FEATURE_KEYS.POWERPOINTS, label: 'PowerPoints', description: 'Generate PowerPoint decks' },
  { key: FEATURE_KEYS.EXCEL, label: 'Excel', description: 'Generate Excel spreadsheets' },
  { key: FEATURE_KEYS.FILE_READING, label: 'File Reading', description: 'Read and analyze uploaded files' },
  { key: FEATURE_KEYS.EMAIL_INTELLIGENCE, label: 'Email Intelligence', description: 'Auto-categorize inbound email and configure category limits' },
  { key: FEATURE_KEYS.MEETING_COPILOT, label: 'Meeting Copilot', description: 'Live meeting transcription, summary, and action items' },
] as const;

/**
 * Tooltip copy for the (?) HelpTip component. Edit text here freely; no
 * component changes required. Each entry can optionally point to a full
 * article in `help-content.ts` for "Learn more".
 *
 * Naming convention: `<page>.<field>` — e.g. `profile.displayName`.
 */

export interface HelpTooltipEntry {
  title: string;
  /** MiniMarkdown-supported body. Keep it 1–4 short paragraphs. */
  body: string;
  /** Optional id of a HELP_ARTICLES entry to deep-link to. */
  learnMoreArticleId?: string;
}

export const HELP_TOOLTIPS = {
  // ============ Profile / Settings ============
  'profile.fullName': {
    title: 'Full name',
    body: 'Used in your email signature and as the sender display name on AI-generated drafts. Use the name your recipients will recognize.',
    learnMoreArticleId: 'profile-signature',
  },
  'profile.title': {
    title: 'Job title',
    body: 'Appears under your name in the signature. Required for **Business** workspace mode so recipients know your role.',
    learnMoreArticleId: 'profile-signature',
  },
  'profile.phone': {
    title: 'Phone number',
    body: 'Optional. When provided it is included in your signature and offered to the AI assistant when proposing meeting times.',
  },
  'profile.website': {
    title: 'Website',
    body: 'Optional URL shown as a clickable link in your signature.',
  },
  'profile.photo': {
    title: 'Profile photo',
    body: 'Square image shown in your email signature. Use a clear headshot. If both a photo and a company logo are set, the **photo takes priority** in the signature.',
    learnMoreArticleId: 'profile-signature',
  },
  'profile.companyLogo': {
    title: 'Company logo',
    body: 'Used in the dashboard header and as a fallback in your signature when no profile photo is set. Use a transparent PNG for best results on the colored header.',
    learnMoreArticleId: 'profile-signature',
  },
  'profile.signaturePreview': {
    title: 'Signature preview',
    body: 'Live preview of exactly what recipients will see at the bottom of your AI-generated drafts. Updates as you type.',
    learnMoreArticleId: 'profile-signature',
  },
  'profile.workspaceMode': {
    title: 'Workspace mode',
    body: '**Personal** keeps signatures minimal (name + optional photo). **Business** includes title, company, and logo — better for client-facing work.',
  },

  // ============ AI Settings ============
  'ai.writingStyle': {
    title: 'Writing style',
    body: 'Sets the tone the AI uses when drafting replies. **Professional** for client mail, **Friendly** for teammates, **Concise** when you reply on mobile a lot.',
    learnMoreArticleId: 'ai-drafts',
  },
  'ai.signatureMode': {
    title: 'Signature in drafts',
    body: 'Whether AI drafts should append your full signature, just your name, or nothing. The AI will not duplicate signatures already present.',
  },
  'ai.exampleReplies': {
    title: 'Example replies',
    body: 'Paste 1–3 of your real past replies. The AI mimics their phrasing, length, and sign-off so drafts sound like you — not like a bot.',
  },

  // ============ Daily Brief ============
  'brief.schedule': {
    title: 'Daily Brief schedule',
    body: 'When InboxIQ should email you the executive summary. Most users pick weekday mornings 30 minutes before their first meeting.',
    learnMoreArticleId: 'daily-brief',
  },
  'brief.timezone': {
    title: 'Timezone',
    body: 'Used so the brief arrives at the right local time even when you travel. Defaults to your browser timezone.',
  },

  // ============ Categories & Rules ============
  'category.name': {
    title: 'Category name',
    body: 'Becomes a label (Gmail) or folder (Outlook) in your real mailbox. The two-digit prefix (e.g. `01.`) is added automatically so they sort cleanly at the top.',
    learnMoreArticleId: 'categories-overview',
  },
  'category.color': {
    title: 'Category color',
    body: 'Shown in InboxIQ and synced to Gmail label colors when supported. Choose distinct colors for high-priority categories.',
  },
  'category.aiDrafts': {
    title: 'AI Drafts for this category',
    body: 'When on, InboxIQ pre-writes a reply for every new email landing in this category and saves it under `0. AI Draft`. **Drafts are never sent automatically** — you always review and send.',
    learnMoreArticleId: 'ai-drafts',
  },
  'category.followUp': {
    title: 'Follow-up category',
    body: 'Marks this category as "waiting on a response from someone else". Follow-up items appear in the Daily Brief so nothing slips.',
  },
  'category.enabled': {
    title: 'Enabled',
    body: 'Turn off to stop sorting new mail into this category without deleting the label from your mailbox. Existing emails keep their label.',
    learnMoreArticleId: 'categories-overview',
  },
  'rule.conditions': {
    title: 'Rule conditions',
    body: 'Match on **sender domain**, **subject contains**, or **body contains**. Combine with **AND** (all must match) or **OR** (any match). Case-insensitive.',
    learnMoreArticleId: 'rules',
  },
  'rule.priority': {
    title: 'Rule priority',
    body: 'Higher-priority rules are evaluated first. Useful when an email could match multiple categories — the highest-priority match wins.',
    learnMoreArticleId: 'rules',
  },

  // ============ Integrations ============
  'integration.connect': {
    title: 'Connect your mailbox',
    body: 'Starts an OAuth flow with your provider. InboxIQ requests only the scopes it needs: read mail, modify labels/folders, and (optionally) calendar.',
    learnMoreArticleId: 'connect-mailbox',
  },
  'integration.calendar': {
    title: 'Calendar access',
    body: 'Optional second consent step. Enables meeting-time suggestions and lets the AI assistant log events. You can disconnect calendar without disconnecting mail.',
    learnMoreArticleId: 'connect-calendar',
  },
  'integration.meetingDuration': {
    title: 'Default meeting duration',
    body: 'Used when the AI proposes meeting slots. 30 min is a sensible default for most knowledge workers.',
  },
  'integration.workingHours': {
    title: 'Working hours',
    body: 'The AI will only propose meeting times inside this window. Set to your real availability — including any lunch break — for best results.',
  },
  'integration.disconnect': {
    title: 'Disconnect',
    body: 'Revokes InboxIQ\'s access to this mailbox. Categories, rules, and history are kept so you can reconnect later without reconfiguring everything.',
  },

  // ============ Admin ============
  'admin.allowedDomains': {
    title: 'Allowed sign-in domains',
    body: 'Only users with email addresses on these domains can sign up or log in. Wildcards are not supported — list each domain explicitly (e.g. `acme.com`, `acme.co.uk`).',
  },
  'admin.featureGate': {
    title: 'Feature access',
    body: 'Manually grant features (AI Drafts, Daily Brief, AI Chat) per user or group. There is no Stripe or subscription — admins control access directly.',
  },
} as const satisfies Record<string, HelpTooltipEntry>;

export type HelpTooltipId = keyof typeof HELP_TOOLTIPS;

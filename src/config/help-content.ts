/**
 * Single editable source of truth for all in-app help content.
 *
 * Edit copy here without touching components — the Help panel, contextual
 * "?" dots, and the AI chatbot's knowledge base all read from this file.
 */

import adminGroupsImg from '@/assets/help/admin-groups.png';

export type HelpCategoryId =
  | 'getting-started'
  | 'integrations'
  | 'categories-rules'
  | 'ai-features'
  | 'account-billing'
  | 'admin'
  | 'troubleshooting';

export interface HelpStep {
  /** Short verb-led step label, e.g. "Open Integrations". */
  title: string;
  /** Plain-language description of what to do at this step. */
  description: string;
  /**
   * Optional CSS selector pointing to the element this step describes.
   * When present, the Guided Tour overlay will spotlight this element and
   * scroll it into view. Use `[data-tour="..."]` attributes on the target
   * page so the selector stays stable across refactors.
   */
  target?: string;
  /**
   * Optional path to navigate to before showing this step. Useful when a
   * tour spans multiple pages.
   */
  route?: string;
}

export interface HelpArticle {
  id: string;
  title: string;
  category: HelpCategoryId;
  /** Plain-language summary shown in lists. Keep it short. */
  summary: string;
  /** Optional intro paragraph before the steps. */
  intro?: string;
  /** Numbered, named steps the user should follow. Preferred over `body`. */
  steps?: HelpStep[];
  /** Optional closing notes or tips (markdown). */
  outro?: string;
  /**
   * Optional screenshot illustrating where in the dashboard this happens.
   * Should be an imported asset from src/assets/help/*.
   */
  image?: { src: string; alt: string };
  /** Optional related route(s); first one is used as the "Open this page" CTA. */
  routes?: string[];
  /** Optional keywords to improve search relevance. */
  keywords?: string[];
  /**
   * Legacy free-form markdown body. New articles should prefer `intro` +
   * `steps` + `outro`. Kept for backwards compatibility.
   */
  body?: string;
}

export interface HelpCategory {
  id: HelpCategoryId;
  label: string;
  description: string;
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: 'getting-started', label: 'Getting Started', description: 'Set up InboxIQ from scratch.' },
  { id: 'integrations', label: 'Integrations', description: 'Connect Gmail, Outlook, and your calendar.' },
  { id: 'categories-rules', label: 'Categories & Rules', description: 'Organize your inbox automatically.' },
  { id: 'ai-features', label: 'AI Features', description: 'Drafts, daily brief, and the AI assistant.' },
  { id: 'account-billing', label: 'Account & Workspace', description: 'Profile, signature, and team settings.' },
  { id: 'admin', label: 'Admin Dashboard', description: 'Domains, users, groups, and feature gating.' },
  { id: 'troubleshooting', label: 'Troubleshooting', description: 'Fix common issues quickly.' },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'welcome',
    title: 'Welcome to InboxIQ',
    category: 'getting-started',
    summary: 'A 60-second tour of what InboxIQ does and how to get value fast.',
    intro:
      'InboxIQ is your AI-powered email co-pilot. It connects to your Gmail or Outlook mailbox, sorts incoming mail into categories you control, and prepares draft replies for the messages that need a response — so you can review and send in seconds instead of minutes.',
    steps: [
      { title: '1. Connect your mailbox', description: 'Open the Integrations page and click Connect next to Google Workspace or Microsoft 365.' },
      { title: '2. Confirm your categories', description: 'Open the Categories page. Rename or recolor the defaults so they match how you actually work.' },
      { title: '3. Turn on AI Drafts', description: 'On any category, flip the AI Drafts toggle on. InboxIQ will start writing replies for new mail in that category.' },
      { title: '4. Read your Daily Brief', description: 'Open AI Daily Brief the next morning to see exactly what landed overnight and what needs you.' },
    ],
    outro: 'You can re-launch the Setup Wizard any time from **Settings → Restart Setup Wizard**.',
    routes: ['/integrations'],
    keywords: ['intro', 'overview', 'tour', 'first time'],
  },
  {
    id: 'connect-mailbox',
    title: 'Connect your mailbox (Google or Microsoft)',
    category: 'integrations',
    summary: 'Link Gmail or Outlook so InboxIQ can read, label, and draft on your behalf.',
    intro:
      "InboxIQ needs read + label access to your mailbox so it can sort mail and save drafts. It only ever requests the scopes it needs — never the ability to delete mail.",
    steps: [
      { title: '1. Open Integrations', description: 'Use the sidebar → Integrations.' },
      { title: '2. Pick your provider', description: 'Click Connect next to Google Workspace or Microsoft 365.' },
      { title: '3. Approve the consent screen', description: "You'll be redirected to Google or Microsoft. Review the requested scopes and click Allow." },
      { title: '4. Confirm Connected status', description: "Back in InboxIQ the tile should show a green Connected badge with your email address." },
    ],
    outro:
      "**Popup blocked?** Allow popups for inboxiq.energyforward.com and click Connect again.\n\n**Seeing `unauthorized_client`?** Your IT admin needs to approve InboxIQ in Google Workspace or Microsoft 365 — send them the diagnostics link from this page.",
    routes: ['/integrations', '/integration-setup'],
    keywords: ['gmail', 'outlook', 'oauth', 'sign in', 'connect', 'microsoft', 'google'],
  },
  {
    id: 'connect-calendar',
    title: 'Connect your calendar',
    category: 'integrations',
    summary: 'Let InboxIQ propose meeting times and log calendar events.',
    steps: [
      { title: '1. Open Integrations', description: 'Use the sidebar → Integrations.' },
      { title: '2. Expand your provider tile', description: 'Click on the connected Google or Microsoft tile to expand its options.' },
      { title: '3. Toggle Calendar on', description: "You'll be sent through a second consent flow — calendar access is a separate scope." },
      { title: '4. Set your default meeting length', description: 'Lower on the same page, choose your default working hours and meeting duration.' },
    ],
    routes: ['/integrations'],
    keywords: ['calendar', 'meeting', 'availability', 'schedule'],
  },
  {
    id: 'categories-overview',
    title: 'How categories work',
    category: 'categories-rules',
    summary: 'Categories are folders or labels InboxIQ uses to triage every incoming email.',
    intro:
      'Each category becomes a label (Gmail) or folder (Outlook) inside your real mailbox, prefixed with a number like `01. Urgent` so they sort cleanly at the top.',
    steps: [
      { title: '1. Open Categories', description: 'Use the sidebar → Categories.' },
      { title: '2. Pick a color and name', description: 'Click any category to rename it and choose a color that matches its priority.' },
      { title: '3. Add rules', description: 'Inside a category, click Add Rule to match by sender domain, subject contains, or body contains.' },
      { title: '4. Enable AI Drafts (optional)', description: 'Flip AI Drafts on for categories where you want a pre-written reply waiting for you.' },
      { title: '5. Mark as No Reply Tracker (optional)', description: 'Categories marked as No Reply Tracker appear in the dedicated No Reply Tracker view.' },
    ],
    outro:
      'Disabling a category leaves the label in your mailbox but stops new mail from being sorted into it. Deleting a category from InboxIQ does **not** delete the label from your mailbox.',
    routes: ['/categories'],
    keywords: ['labels', 'folders', 'sort', 'triage'],
  },
  {
    id: 'rules',
    title: 'Writing effective rules',
    category: 'categories-rules',
    summary: 'Combine sender, subject, and body conditions to route mail precisely.',
    steps: [
      { title: '1. Open the category', description: 'On Categories, click the category you want to add rules to.' },
      { title: '2. Click Add Rule', description: 'You can add as many rules as you need per category.' },
      { title: '3. Pick a match type', description: 'Sender domain or email (e.g. `@stripe.com`), subject contains, or body contains. Matches are case-insensitive.' },
      { title: '4. Choose AND or OR logic', description: 'AND requires every condition to match. OR matches if any condition matches.' },
      { title: '5. Apply retroactively (optional)', description: 'New mail starts being categorized immediately. To re-categorize existing mail, open Sync and run a retroactive sync.' },
    ],
    routes: ['/categories', '/sync'],
    keywords: ['filter', 'rule', 'conditions', 'sender', 'subject'],
  },
  {
    id: 'ai-drafts',
    title: 'AI Drafts: how they work',
    category: 'ai-features',
    summary: 'InboxIQ writes a reply for you, but never sends it without your review.',
    intro:
      'When new mail lands in a category that has AI Drafts on, InboxIQ generates a reply in your writing style and saves it as a real draft inside Gmail or Outlook — labeled `0. AI Draft`.',
    steps: [
      { title: '1. Enable AI Drafts on a category', description: 'Open Categories and toggle AI Drafts on for the categories you want help with.' },
      { title: '2. Set your writing style', description: 'Open Settings → AI Settings to choose Professional / Friendly / Concise tone, or per-category for finer control.' },
      { title: '3. Wait for new mail', description: 'When a matching email arrives, a draft appears under the `0. AI Draft` label/folder within 1–2 minutes.' },
      { title: '4. Review and send', description: 'Open the draft in your normal mail client (or the Email Drafts page in InboxIQ), tweak it, and send.' },
      { title: '5. Audit what AI helped with', description: 'After sending, the message is moved to `11. AI Sent` so you always have a clean audit trail.' },
    ],
    outro:
      '**Important:** AI Drafts are never sent automatically. This is by design and cannot be overridden.',
    routes: ['/email-draft', '/categories', '/settings'],
    keywords: ['draft', 'reply', 'compose', 'auto-reply'],
  },
  {
    id: 'daily-brief',
    title: 'AI Daily Brief',
    category: 'ai-features',
    summary: 'A morning summary of what landed in your inbox while you were away.',
    steps: [
      { title: '1. Open AI Daily Brief', description: 'Use the sidebar → AI Daily Brief to read today’s summary on demand.' },
      { title: '2. Schedule email delivery', description: 'Open Settings → Daily Brief Schedule and pick the days, time, and timezone.' },
      { title: '3. Choose recipients', description: 'By default the brief goes to your connected email — you can add a different recipient in the same panel.' },
      { title: '4. Print or share', description: 'On the Daily Brief page, use the print button to get a clean executive-report PDF.' },
    ],
    routes: ['/ai-daily-brief', '/settings'],
    keywords: ['summary', 'morning', 'digest', 'brief'],
  },
  {
    id: 'ai-assistant',
    title: 'AI Chat — your interactive workspace assistant',
    category: 'ai-features',
    summary: 'Talk to your inbox, drive, and the web from one chat.',
    intro:
      'AI Chat is your all-in-one assistant — similar to ChatGPT or Claude, but plugged into YOUR world. It can search your emails, your OneDrive and SharePoint, your documents, and the live web. It can read files you attach, use your current location when you ask about something nearby, and answer in plain English. Click "Guide me through this page" to see each part of the screen highlighted with a quick explanation.',
    steps: [
      { title: 'Start a brand new chat', description: 'Click here to start a fresh conversation. Every chat keeps its own memory so the assistant always knows the context.', target: '[data-tour="chat-new"]', route: '/chat' },
      { title: 'Organize chats into folders', description: 'Create folders to group related chats — for example "Clients", "Travel", or "Q4 Planning". Use this button to add a new folder.', target: '[data-tour="chat-new-folder"]' },
      { title: 'Your recent chats live here', description: 'All your conversations show up in the left sidebar, grouped by date and folder. Click any chat to reopen it exactly where you left off.', target: '[data-tour="chat-conv-row"]' },
      { title: 'Move, export, or delete a chat', description: 'Hover a chat and click the ⋮ menu. From there you can Move to folder, Download to your computer (PDF or Excel), Save to OneDrive, or Delete. Chats are auto-deleted after 30 days of inactivity, so save anything important.', target: '[data-tour="chat-conv-menu"]' },
      { title: 'Attach a document', description: 'Attach PDFs, Word, Excel, PowerPoint, images, or text files. The assistant reads the contents and you can ask questions, extract data, or generate new documents from them.', target: '[data-tour="chat-attach"]' },
      { title: 'Search the web live', description: 'Turn on the globe to let the assistant browse the live internet — news, prices, flights, public companies, weather. It also turns on automatically when your question clearly needs fresh info.', target: '[data-tour="chat-web"]' },
      { title: 'Use your current location', description: 'When you ask about something "near me", enable location so the assistant can find local places, restaurants, or services around you. Location is only shared for that turn.', target: '[data-tour="chat-location"]' },
      { title: 'Deep reasoning mode', description: 'Turn this on for complex, multi-step requests — analysis, planning, research. The assistant will take a bit longer but produce noticeably better answers.', target: '[data-tour="chat-deep"]' },
      { title: 'Talk instead of typing', description: 'Tap the mic and speak. We transcribe in real time — perfect for hands-free use. Stop talking and your message is ready to send.', target: '[data-tour="chat-mic"]' },
      { title: 'Type your question here', description: 'Ask anything in plain English: "summarize my last 10 emails", "find the contract from Acme in OneDrive", "what is the cheapest LAX → Rome flight next month?". Shift+Enter for a new line, Enter to send.', target: '[data-tour="chat-input"]' },
      { title: 'Your daily capacity', description: 'This shows how much of your daily allowance is left. Each message uses a small slice. Resets every 24 hours.', target: '[data-tour="chat-capacity"]' },
      { title: 'Copy the reply', description: 'After the AI answers, use Copy to put the reply on your clipboard — paste it into an email, a doc, or anywhere else.', target: '[data-tour="chat-msg-copy"]' },
      { title: 'Email the reply to yourself', description: 'One click creates a draft in your mailbox containing the AI reply — handy for sending the answer to a colleague or yourself.', target: '[data-tour="chat-msg-email"]' },
      { title: 'Ask again — regenerate', description: 'Not happy with the answer? Click Regenerate to ask the assistant to try again with a fresh take.', target: '[data-tour="chat-msg-regenerate"]' },
      { title: 'Listen to the reply', description: 'Click Play to have the AI read the answer out loud using your selected voice (change voice in the top bar). Great for long replies or when your eyes need a break.', target: '[data-tour="chat-msg-play"]' },
    ],
    outro:
      'AI Chat respects your permissions — it can only see what you can see across Outlook, OneDrive, and SharePoint, and it never sends mail or changes anything without your explicit confirmation.',
    routes: ['/chat', '/ai-chat'],
    keywords: ['chat', 'assistant', 'ask', 'question', 'voice', 'microphone', 'capacity', 'folder', 'attach', 'web search', 'play', 'tts', 'copy', 'regenerate'],
  },
  {
    id: 'profile-signature',
    title: 'Profile & email signature',
    category: 'account-billing',
    summary: 'Your name, title, and signature show up on every AI draft.',
    steps: [
      { title: '1. Open Settings', description: 'Use the sidebar → Settings.' },
      { title: '2. Fill in your profile', description: 'Add your full name, title (required for Business accounts), phone, and website.' },
      { title: '3. Upload a photo or logo', description: 'Toggle which one to display in your signature. Profile photo takes priority over company logo.' },
      { title: '4. Check the live preview', description: 'The preview at the bottom shows exactly what recipients will see. Changes save automatically.' },
    ],
    routes: ['/settings'],
    keywords: ['signature', 'name', 'title', 'photo', 'logo'],
  },
  {
    id: 'profile-signature',
    title: 'Profile & email signature',
    category: 'account-billing',
    summary: 'Your name, title, and signature show up on every AI draft.',
    steps: [
      { title: '1. Open Settings', description: 'Use the sidebar → Settings.' },
      { title: '2. Fill in your profile', description: 'Add your full name, title (required for Business accounts), phone, and website.' },
      { title: '3. Upload a photo or logo', description: 'Toggle which one to display in your signature. Profile photo takes priority over company logo.' },
      { title: '4. Check the live preview', description: 'The preview at the bottom shows exactly what recipients will see. Changes save automatically.' },
    ],
    routes: ['/settings'],
    keywords: ['signature', 'name', 'title', 'photo', 'logo'],
  },

  /* ============== ADMIN ============== */
  {
    id: 'admin-overview',
    title: 'Admin Dashboard overview',
    category: 'admin',
    summary: 'Where admins manage domains, users, groups, and feature access.',
    intro:
      'The Admin Dashboard (`/admin`) is your control center. It is only visible to workspace admins. Use the tabs along the top to jump between sections.',
    steps: [
      { title: '1. Setup Wizard', description: 'Brand-new orgs should start here — it walks you through domains, the first users, and default permission groups.' },
      { title: '2. M365 Users / Users', description: 'See who has signed in, invite people from your tenant directory, or bulk-add users.' },
      { title: '3. Groups', description: 'Bundle features into named groups (Standard, Power User, Executive) and assign users to them.' },
      { title: '4. Domains', description: 'Add the email domains that are allowed to sign up. Anyone outside these domains is blocked.' },
      { title: '5. AI Agent / Follow-ups / AI Usage', description: 'Configure the shared agent mailbox, monitor pending follow-up reminders, and track AI cost.' },
      { title: '6. Support Issues', description: 'See every issue your users submit through the Help panel, and update status / add internal notes.' },
    ],
    image: { src: adminGroupsImg, alt: 'Screenshot of the Admin Dashboard showing the Groups tab with permission toggles per group.' },
    routes: ['/admin'],
    keywords: ['admin', 'dashboard', 'permissions', 'users', 'team'],
  },
  {
    id: 'admin-groups',
    title: 'Permission Groups',
    category: 'admin',
    summary: 'Bundle features (AI Drafts, Daily Brief, Follow-Up Reminder, etc.) and assign them to users.',
    intro:
      'Groups are the simplest way to control who gets which feature. Create a group, flip the toggles, and add users — they immediately get (or lose) access.',
    steps: [
      { title: '1. Open /admin → Groups', description: 'Click the Groups tab in the Admin Dashboard.' },
      { title: '2. Create a group', description: 'Name it (e.g. "Power User"), add a short description, and pick a domain (or leave it Global to apply to all domains).' },
      { title: '3. Toggle features on/off', description: 'Each group has switches for AI Draft, AI Auto Reply, AI Chat, Daily Brief, Follow-Up Reminder, ChatGPT/Claude model, and more.' },
      { title: '4. Override per domain (global groups only)', description: 'Use the "Configure for" dropdown inside a global group to flip features just for one domain — the underlying defaults stay untouched.' },
      { title: '5. Assign users', description: 'On the Users tab, click a user and add them to one or more groups. Their effective access is the union of all their groups.' },
    ],
    outro:
      '**Disabling Follow-Up Reminder** asks for confirmation and shows how many users + pending reminders will be affected. Reminders are paused (not deleted) and resume automatically if you re-enable.',
    image: { src: adminGroupsImg, alt: 'Permission Groups tab showing Executive and Power User groups with feature toggles.' },
    routes: ['/admin'],
    keywords: ['group', 'permission', 'feature', 'role', 'access', 'follow-up'],
  },
  {
    id: 'admin-domains',
    title: 'Allowed Domains',
    category: 'admin',
    summary: 'Restrict sign-up to your company email domains.',
    steps: [
      { title: '1. Open /admin → Domains', description: 'Click the Domains tab.' },
      { title: '2. Add a domain', description: 'Enter the bare domain (e.g. `acme.com`, no `@`). New users with that email domain are auto-assigned to your organization.' },
      { title: '3. (Microsoft) Grant tenant consent', description: 'For Microsoft tenants, click "Grant admin consent" so SSO and directory sync work.' },
      { title: '4. Set max users (optional)', description: 'Cap how many people from that domain can sign up.' },
      { title: '5. Disable when needed', description: 'Toggle a domain off to immediately block new sign-ups from that domain (existing users keep their access).' },
    ],
    routes: ['/admin'],
    keywords: ['domain', 'sso', 'sign-up', 'allowed', 'tenant'],
  },
  {
    id: 'admin-support-issues',
    title: 'Reviewing Support Issues',
    category: 'admin',
    summary: 'See and resolve issues your users submit through the Help panel.',
    steps: [
      { title: '1. Open /admin → Support Issues', description: 'Every issue submitted from the Help & Support button shows up here.' },
      { title: '2. Read the context', description: 'Each ticket includes the user, the page they were on, and their browser metadata.' },
      { title: '3. Update status', description: 'Move tickets through Open → In Progress → Resolved as you work them.' },
      { title: '4. Add internal notes', description: 'Notes are admin-only and help the next admin pick up where you left off.' },
    ],
    routes: ['/admin'],
    keywords: ['support', 'issue', 'ticket', 'bug', 'admin notes'],
  },

  /* ============== TROUBLESHOOTING ============== */
  {
    id: 'troubleshoot-no-drafts',
    title: "I'm not seeing any AI drafts",
    category: 'troubleshooting',
    summary: "Checklist when AI Drafts aren't appearing in your mailbox.",
    steps: [
      { title: '1. Check the mailbox is connected', description: 'Open Integrations — your provider should show a green Connected badge with your email address.' },
      { title: '2. Check at least one category has AI Drafts on', description: 'Open Categories and confirm the AI Drafts toggle is on for at least one category.' },
      { title: '3. Check mail is being categorized', description: 'Open the category — you should see recent emails listed. If not, your rules may not be matching. Try a broader rule like the sender domain.' },
      { title: '4. Look in the right folder', description: 'Drafts appear under the `0. AI Draft` label/folder in Gmail or Outlook, not the main Drafts folder.' },
      { title: '5. Give it a minute', description: 'New mail is processed in batches — drafts typically appear within 1–2 minutes of arrival.' },
    ],
    outro: 'Still stuck? Use the **Submit an issue** tab in this Help panel.',
    routes: ['/email-draft', '/categories'],
    keywords: ['no drafts', 'not working', 'missing', 'help'],
  },
  {
    id: 'troubleshoot-reconnect',
    title: 'My mailbox shows "disconnected"',
    category: 'troubleshooting',
    summary: 'How to safely reconnect when your OAuth token has expired or been revoked.',
    steps: [
      { title: '1. Open Integrations', description: 'Use the sidebar → Integrations.' },
      { title: '2. Click Reconnect', description: 'On the disconnected tile, click Reconnect to re-run the consent flow.' },
      { title: '3. Approve consent again', description: 'You may be asked to re-approve scopes — this is normal after token rotation.' },
      { title: '4. Confirm green badge', description: 'The tile should return to a green Connected badge.' },
    ],
    outro: 'Your categories, rules, and history are preserved — only the access token is refreshed.',
    routes: ['/integrations'],
    keywords: ['reconnect', 'expired', 'token', 'disconnected'],
  },
  {
    id: 'email-agent',
    title: 'Ask the agent by email (uses your own permissions)',
    category: 'ai-features',
    summary: 'Email agent@your-domain.com and the AI answers using your Outlook, OneDrive, and SharePoint access.',
    intro:
      'You can email the InboxIQ agent directly from any device. The agent answers each licensed user using THEIR own Microsoft 365 permissions — so it sees exactly the mail, OneDrive files, and SharePoint sites that you can see, and nothing more. Nothing is shared between users.',
    steps: [
      { title: '1. Make sure you are licensed', description: 'You must have an InboxIQ account in your organization, your Microsoft 365 mailbox connected on the Integrations page, and the Email Agent feature enabled by your admin (/admin → Groups).' },
      { title: '2. Email the shared agent', description: 'Send any question to agent@your-domain.com from your work email. Examples: "What did Maria send last week about Q3?" or "Find the latest signed NDA in our SharePoint."' },
      { title: '3. The agent verifies you', description: 'It looks up your account, confirms you have an active mailbox connection, and checks that Email Agent is on for your group. If any check fails, it replies with the exact step to fix.' },
      { title: '4. It answers as YOU', description: 'The agent runs Microsoft Graph searches with your own delegated token — your Outlook mail, your OneDrive, and the SharePoint sites you can access. It will never read another user\'s data.' },
      { title: '5. Review the reply', description: 'You get a reply in the same thread, with citations and links to the source emails/files. The agent never sends mail or modifies your inbox on its own.' },
    ],
    outro:
      '**Privacy note:** Your data stays in your own Microsoft 365 tenant. The agent uses *your* OAuth token, scoped to *your* M365 permissions — not a shared service account. If you lose access to a file in SharePoint, the agent loses access too.',
    routes: ['/integrations', '/admin'],
    keywords: ['email agent', 'shared mailbox', 'ask by email', 'delegated', 'sharepoint', 'onedrive', 'permissions'],
  },
];

/**
 * Map of routes (or route prefixes) to article IDs that are most relevant
 * when the user is on that page. Used by the Help panel to show contextual
 * articles at the top.
 */
export const ROUTE_HELP_MAP: Record<string, string[]> = {
  '/integrations': ['connect-mailbox', 'connect-calendar', 'troubleshoot-reconnect'],
  '/integration-setup': ['connect-mailbox'],
  '/categories': ['categories-overview', 'rules', 'ai-drafts'],
  '/sync': ['categories-overview', 'rules'],
  '/email-draft': ['ai-drafts', 'troubleshoot-no-drafts'],
  '/chat': ['ai-assistant'],
  '/ai-chat': ['ai-assistant'],
  '/ai-daily-brief': ['daily-brief'],
  '/ai-activity': ['ai-drafts'],
  '/settings': ['profile-signature', 'daily-brief'],
  '/admin': ['admin-overview', 'admin-groups', 'admin-domains', 'admin-support-issues'],
};

export function getContextualArticles(pathname: string): HelpArticle[] {
  const match = Object.keys(ROUTE_HELP_MAP)
    .filter((route) => pathname === route || pathname.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!match) return [];
  const ids = ROUTE_HELP_MAP[match] || [];
  return ids
    .map((id) => HELP_ARTICLES.find((a) => a.id === id))
    .filter((a): a is HelpArticle => Boolean(a));
}

export function searchArticles(query: string): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return HELP_ARTICLES.filter((a) => {
    const haystack = [
      a.title,
      a.summary,
      a.intro || '',
      a.body || '',
      a.outro || '',
      ...(a.steps || []).flatMap((s) => [s.title, s.description]),
      ...(a.keywords || []),
      a.category,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Single editable source of truth for all in-app help content.
 *
 * Edit copy here without touching components — the Help panel, tooltips,
 * and (eventually) the AI chatbot's knowledge base all read from this file.
 */

export type HelpCategoryId =
  | 'getting-started'
  | 'integrations'
  | 'categories-rules'
  | 'ai-features'
  | 'account-billing'
  | 'troubleshooting';

export interface HelpArticle {
  id: string;
  title: string;
  category: HelpCategoryId;
  /** Plain-language summary shown in lists. Keep it short. */
  summary: string;
  /** Full article body — supports basic markdown (headings, lists, bold). */
  body: string;
  /** Optional related route(s); used for "contextual help" on each page. */
  routes?: string[];
  /** Optional keywords to improve search relevance. */
  keywords?: string[];
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
  { id: 'troubleshooting', label: 'Troubleshooting', description: 'Fix common issues quickly.' },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'welcome',
    title: 'Welcome to InboxIQ',
    category: 'getting-started',
    summary: 'A 60-second tour of what InboxIQ does and how to get value fast.',
    body: `InboxIQ is your AI-powered email co-pilot. It connects to your Gmail or Outlook mailbox, sorts incoming mail into categories you control, and prepares draft replies for the messages that need a response — so you can review and send in seconds instead of minutes.

**The fastest path to value (about 5 minutes):**
1. Connect your mailbox in **Integrations**.
2. Confirm the default categories on the **Categories** page (or rename them to match how you work).
3. Turn on **AI Drafts** for one or two categories where you want help replying.
4. Open the **AI Daily Brief** the next morning to see what changed overnight.

You can re-launch the Setup Wizard any time from **Settings → Restart Setup Wizard**.`,
    routes: ['/integrations'],
    keywords: ['intro', 'overview', 'tour', 'first time'],
  },
  {
    id: 'connect-mailbox',
    title: 'Connect your mailbox (Google or Microsoft)',
    category: 'integrations',
    summary: 'Link Gmail or Outlook so InboxIQ can read, label, and draft on your behalf.',
    body: `Open **Integrations** and click **Connect** next to Google Workspace or Microsoft 365.

You'll be redirected to your provider's consent screen. InboxIQ requests only the scopes it needs — read mail, modify labels/categories, and (if you choose) calendar access for scheduling.

**What if the popup is blocked?** Allow popups for inboxiq.energyforward.com and click Connect again.

**What if you see "unauthorized_client"?** Your administrator needs to approve InboxIQ in Google Workspace or Microsoft 365. Send them the diagnostics link from the Integrations page.

You can connect multiple mailboxes (e.g., a personal and a business account). Switch between them from the **Connected Emails** dropdown in the sidebar.`,
    routes: ['/integrations', '/integration-setup'],
    keywords: ['gmail', 'outlook', 'oauth', 'sign in', 'connect', 'microsoft', 'google'],
  },
  {
    id: 'connect-calendar',
    title: 'Connect your calendar',
    category: 'integrations',
    summary: 'Let InboxIQ propose meeting times and log calendar events.',
    body: `On the **Integrations** page, expand your connected provider and toggle **Calendar** on. You'll be sent through a second consent flow because calendar access is a separate scope.

Once connected, the AI assistant and AI drafts can suggest specific times that match your real availability. You can set your default working hours and meeting length lower on the same page.`,
    routes: ['/integrations'],
    keywords: ['calendar', 'meeting', 'availability', 'schedule'],
  },
  {
    id: 'categories-overview',
    title: 'How categories work',
    category: 'categories-rules',
    summary: 'Categories are folders or labels InboxIQ uses to triage every incoming email.',
    body: `Each category becomes a label (Gmail) or folder (Outlook) inside your real mailbox, prefixed with a number like \`01. Urgent\` so they sort cleanly at the top.

For each category you can:
- Choose a color
- Define **rules** (sender domain, subject contains, body contains)
- Enable **AI Drafts** so InboxIQ pre-writes a reply when mail lands here
- Mark it as a **Follow Up** category

Disabling a category leaves the label in your mailbox but stops new mail from being sorted into it. Deleting a category from InboxIQ does **not** delete the label from your mailbox.`,
    routes: ['/categories'],
    keywords: ['labels', 'folders', 'sort', 'triage'],
  },
  {
    id: 'rules',
    title: 'Writing effective rules',
    category: 'categories-rules',
    summary: 'Combine sender, subject, and body conditions to route mail precisely.',
    body: `Open any category on the **Categories** page and click **Add Rule**.

You can match on:
- **Sender domain or email** — e.g. \`@stripe.com\` or \`alerts@github.com\`
- **Subject contains** — case-insensitive substring match
- **Body contains** — case-insensitive substring match

Combine multiple conditions with **AND** (all must match) or **OR** (any may match). Rules apply to new email immediately and can be applied retroactively from the **Sync** page.`,
    routes: ['/categories', '/sync'],
    keywords: ['filter', 'rule', 'conditions', 'sender', 'subject'],
  },
  {
    id: 'ai-drafts',
    title: 'AI Drafts: how they work',
    category: 'ai-features',
    summary: 'InboxIQ writes a reply for you, but never sends it without your review.',
    body: `Turn on **AI Drafts** on any category. When new mail lands there, InboxIQ generates a reply in your writing style and saves it as a real draft inside Gmail or Outlook — labeled \`0. AI Draft\`.

You review, tweak, and send from your normal mail client (or the **Email Drafts** page in InboxIQ). After you send, the message is moved to \`11. AI Sent\` so you can audit what AI helped you with.

**Important:** AI Drafts are never sent automatically. This is by design and cannot be overridden.

Tune the writing style, format, and example replies in **Settings → AI Settings**, or per-category for more specific behavior.`,
    routes: ['/email-draft', '/categories', '/settings'],
    keywords: ['draft', 'reply', 'compose', 'auto-reply'],
  },
  {
    id: 'daily-brief',
    title: 'AI Daily Brief',
    category: 'ai-features',
    summary: 'A morning summary of what landed in your inbox while you were away.',
    body: `The Daily Brief is an AI-generated executive summary of your overnight email — what's urgent, what's waiting on you, and what can wait.

You can read it on the **AI Daily Brief** page or have it emailed to you on a schedule. Configure delivery in **Settings → Daily Brief Schedule**: pick the days, time, and timezone.`,
    routes: ['/ai-daily-brief', '/settings'],
    keywords: ['summary', 'morning', 'digest', 'brief'],
  },
  {
    id: 'ai-assistant',
    title: 'AI Assistant chat',
    category: 'ai-features',
    summary: 'Ask questions about your inbox in plain English.',
    body: `The **AI Chat** page lets you ask things like *"What did Maria send last week about the Q3 budget?"* or *"Summarize this morning's customer emails."*

The assistant has read-only access to your connected mailboxes and respects all your permissions. It will never send mail or modify your inbox without an explicit confirmation step.`,
    routes: ['/ai-chat'],
    keywords: ['chat', 'assistant', 'ask', 'question'],
  },
  {
    id: 'profile-signature',
    title: 'Profile & email signature',
    category: 'account-billing',
    summary: 'Your name, title, and signature show up on every AI draft.',
    body: `Go to **Settings** to update your full name, title, phone, website, and signature.

Upload a profile photo or company logo and toggle which to display in the signature. The preview at the bottom shows exactly what recipients will see. Changes save automatically.`,
    routes: ['/settings'],
    keywords: ['signature', 'name', 'title', 'photo', 'logo'],
  },
  {
    id: 'admin-overview',
    title: 'Admin Dashboard (admins only)',
    category: 'account-billing',
    summary: 'Manage allowed domains, users, permissions, and feature access.',
    body: `Workspace admins can open **/admin** to:
- Add allowed sign-in domains for your organization
- Invite or bulk-create users
- Group users and grant feature access (AI Drafts, Daily Brief, etc.)
- Review AI usage and costs
- Configure the agent mailbox and Teams integration

If you don't see this page, you're not an admin — ask your workspace admin to grant you the role.`,
    routes: ['/admin'],
    keywords: ['admin', 'permissions', 'users', 'invite', 'team'],
  },
  {
    id: 'troubleshoot-no-drafts',
    title: "I'm not seeing any AI drafts",
    category: 'troubleshooting',
    summary: "Checklist when AI Drafts aren't appearing in your mailbox.",
    body: `Run through this list:

1. **Mailbox connected?** Open **Integrations** — your provider should show a green "Connected" badge with your email address.
2. **A category has AI Drafts enabled?** Open **Categories** and confirm at least one category has the **AI Drafts** toggle on.
3. **Mail is actually being categorized?** Open the category — you should see recent emails listed. If not, your rules may not be matching. Try a broader rule like the sender's domain.
4. **Look in the right place.** Drafts appear under the \`0. AI Draft\` label/folder in Gmail or Outlook, not the main Drafts folder.
5. **Give it a minute.** New mail is processed in batches; drafts typically appear within 1–2 minutes of arrival.

Still stuck? Use the **Submit an issue** option in the Help panel.`,
    routes: ['/email-draft', '/categories'],
    keywords: ['no drafts', 'not working', 'missing', 'help'],
  },
  {
    id: 'troubleshoot-reconnect',
    title: 'My mailbox shows "disconnected"',
    category: 'troubleshooting',
    summary: 'How to safely reconnect when your OAuth token has expired or been revoked.',
    body: `If your mailbox tile says **Disconnected** or **Reconnect required**, your OAuth token expired or was revoked (for example because your IT team rotated something).

Click **Reconnect**. You'll go through the consent flow again. Your categories, rules, and history are preserved — only the access token is refreshed.`,
    routes: ['/integrations'],
    keywords: ['reconnect', 'expired', 'token', 'disconnected'],
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
  '/ai-chat': ['ai-assistant'],
  '/ai-daily-brief': ['daily-brief'],
  '/ai-activity': ['ai-drafts'],
  '/settings': ['profile-signature', 'daily-brief'],
  '/admin': ['admin-overview'],
};

export function getContextualArticles(pathname: string): HelpArticle[] {
  // Find the longest matching route key
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
      a.body,
      ...(a.keywords || []),
      a.category,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

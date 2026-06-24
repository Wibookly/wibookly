/**
 * Single editable source of truth for all in-app help content.
 *
 * Edit copy here without touching components — the Help panel, contextual
 * "?" dots, and the AI chatbot's knowledge base all read from this file.
 */

import adminGroupsImg from '@/assets/help/admin-groups.png';
import type { FeatureKey } from '@/hooks/useFeatureAccess';

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
  {
    id: 'getting-started',
    label: 'Getting Started',
    description:
      'New here? Start with a 60-second tour, then connect your mailbox and pick your categories. Everything else builds on these two steps.',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description:
      'Link your Gmail or Outlook mailbox, your calendar, and (optionally) OneDrive / SharePoint. InboxIQ only ever asks for the access it really needs and never deletes mail.',
  },
  {
    id: 'categories-rules',
    label: 'Categories & Rules',
    description:
      'Decide how your mail is organized. Categories become real labels/folders inside your mailbox, and rules tell InboxIQ what belongs where — by sender, subject, or keywords.',
  },
  {
    id: 'ai-features',
    label: 'AI Features',
    description:
      'The smart side of InboxIQ: pre-written draft replies, your morning Daily Brief, the AI Chat assistant, Meeting Copilot, and the Reply Tracker that nudges you when nobody answers.',
  },
  {
    id: 'account-billing',
    label: 'Account & Workspace',
    description:
      'Make every AI reply sound like you. Add your name, title, photo, company logo, and signature so outgoing drafts feel personal and on-brand.',
  },
  {
    id: 'admin',
    label: 'Admin Dashboard',
    description:
      'For workspace admins only. Manage who can sign up (allowed email domains), invite users, group features together, and turn capabilities on or off per team.',
  },
  {
    id: 'troubleshooting',
    label: 'Troubleshooting',
    description:
      'Quick fixes for the most common bumps — drafts not showing up, a mailbox that says "disconnected", or a stuck consent screen.',
  },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'welcome',
    title: 'Welcome to InboxIQ',
    category: 'getting-started',
    summary: 'A plain-English overview of what InboxIQ does and how to get value in the first 10 minutes.',
    intro:
      'InboxIQ is an AI co-pilot that sits on top of your existing Gmail or Outlook mailbox — you keep using the email client you already know. Once connected, InboxIQ quietly does four things for you:\n\n' +
      '1. **Sorts your inbox automatically.** Every new email is read and dropped into the category you chose (Urgent, Clients, Finance, Newsletters, etc.) as a real label/folder inside your mailbox.\n\n' +
      '2. **Writes draft replies for you.** For the categories you turn AI Drafts on for, a polished reply is waiting in your Drafts folder within ~2 minutes — written in your tone, using your signature. Nothing is ever sent without you clicking Send.\n\n' +
      '3. **Sends you a Daily Brief.** Each morning you get a short, prioritized summary of what landed overnight, what needs a reply, and what can wait — plus an action list with time estimates.\n\n' +
      '4. **Gives you an AI assistant for everything else.** AI Chat can search your mail, your OneDrive/SharePoint, attached documents, and the live web. Meeting Copilot can join meetings, transcribe them, and draft the follow-up. Reply Tracker nudges you when someone never responds.\n\n' +
      'You stay in control the entire time: you choose what gets categorized, what gets a draft, and what gets sent.',
    steps: [
      { title: '1. Connect your mailbox', description: 'Open the Integrations page and click Connect next to Google Workspace or Microsoft 365. Takes ~30 seconds.' },
      { title: '2. Confirm your categories', description: 'Open the Categories page. Rename, recolor, and re-order the defaults so they match how you actually triage mail.' },
      { title: '3. Turn on AI Drafts where you want help', description: 'On any category, flip the AI Drafts toggle on. From that point on, replies are pre-written for you in that category.' },
      { title: '4. Read your Daily Brief tomorrow morning', description: 'Open AI Daily Brief to see exactly what landed overnight, what needs you, and what can wait. Schedule it to arrive in your inbox automatically.' },
    ],
    outro:
      '**Want a deeper walkthrough of any feature?** Open this Help panel anywhere in the app and pick the matching article — every page has its own contextual guide.',
    routes: ['/integrations'],
    keywords: ['intro', 'overview', 'tour', 'first time', 'what is inboxiq', 'how it works'],
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
    title: 'Email Intelligence — every column explained',
    category: 'categories-rules',
    summary: 'Categories are folders or labels InboxIQ uses to triage every incoming email.',
    intro:
      'The Email Intelligence page is where you control how your mailbox is organized. Each row is one category — it becomes a real label (Gmail) or folder (Outlook) inside your mailbox, prefixed with a number like `01. Urgent` so it sorts cleanly. The "Active: X of Y" pill in the header shows how many of your plan\'s categories are currently in use, and "Re-sync All" pushes every change you have made (names, colors, order, rules, on/off state) to your mailbox immediately.',
    steps: [
      { title: 'Drag handle (⋮⋮)', description: 'Grab the dotted handle on the far left of any row to drag a category up or down. The order here is the order labels/folders appear in your real mailbox — most important categories at the top.' },
      { title: 'Color dot', description: 'Click the colored circle to recolor the category. The same color is used for the label in Gmail/Outlook, so your mailbox looks identical to InboxIQ.' },
      { title: 'Category Name', description: 'Click the name to rename it (e.g. "Urgent", "Vendors", "Internal"). InboxIQ automatically prefixes the number — you only type the name. Renaming here renames the label/folder in your mailbox on the next sync.' },
      { title: 'AI Draft Style → Tone button', description: 'Shows the writing tone the AI will use for this category (Professional & Polished, Friendly, Concise, etc.). Click the "Tone" button to open a tone sheet where you can switch tone, add custom instructions, or paste a sample reply for the AI to mimic.' },
      { title: 'Active toggle (green)', description: 'The master switch for the category. ON (green) = mail is sorted into this label/folder and rules are enforced. OFF = the category stops sorting new mail, ALL rules attached to it are removed, AND every email that was previously moved into this category is automatically moved BACK to your Inbox folder on the next sync. Turn it back on later and you start fresh — rules and labeling resume.' },
      { title: 'AI Draft toggle', description: 'Only enabled when Active is ON. When green, the AI writes a polished reply for every new email in this category and saves it as a real draft under "0. AI Draft" — usually within 1–2 minutes. The reply is never sent automatically.' },
      { title: 'AI Auto-Reply toggle', description: 'Only enabled when both Active and AI Draft are ON. When green, the AI not only drafts a reply but actually sends it on your behalf and files the message under "11. AI Sent". Use this carefully — best for low-risk categories like FYIs or confirmations.' },
      { title: 'Sync Status', description: 'Tells you how long ago this category was last pushed to your mailbox (e.g. "8d ago" in green). A red/amber timestamp means there are unsaved changes — they will sync automatically a few seconds after you stop editing, or instantly when you click "Re-sync All".' },
      { title: 'AI Email Label Colors (top panel)', description: 'Pick the color used to tag emails the AI itself creates. AI Draft color = applied to drafts the AI puts in your Drafts folder for review. AI Auto-Reply color = applied to replies the AI actually sent from your Sent folder. Same Outlook palette as your categories so everything stays visually consistent.' },
    ],
    outro:
      'IMPORTANT: turning a category OFF (or having it auto-disabled because it was deleted) does NOT leave your mailbox messy. On the next sync, InboxIQ removes the label from every Gmail message and moves every Outlook message in that folder back to your main Inbox. Your emails are never lost — they always return to the Inbox where you can re-triage or re-enable the category later.',
    routes: ['/categories'],
    keywords: ['labels', 'folders', 'sort', 'triage', 'active', 'toggle', 'tone', 'auto-reply', 'sync status', 'color', 'inbox'],
  },
  {
    id: 'rules',
    title: 'Rules — auto-categorize by sender, domain, or keyword',
    category: 'categories-rules',
    summary: 'Combine sender, subject, and body conditions to route mail precisely.',
    intro:
      'Rules live under each category card on the Email Intelligence page. They are the "if this, then file under that category" logic that InboxIQ applies to every new email — and, on demand, to your existing mailbox.',
    steps: [
      { title: 'Colored dot + category name + (X rule)', description: 'The header of each rules block shows the category color, name, and how many rules it currently has — for example "● Urgent (1 rule)". This helps you see at a glance which categories are actively pulling mail in.' },
      { title: '+ Add Rule button (top-right)', description: 'Click "+ Add Rule" to add another row of conditions to this category. There is no hard limit — add as many rules as you need (e.g. one per important client, one per project keyword).' },
      { title: 'Match type dropdown (Sender / Domain / Keyword)', description: 'Choose what to match on: Sender (a specific email like john@example.com), Domain (everyone from @acme.com), or Keyword (a word in the subject or body).' },
      { title: 'Value input', description: 'Type the actual sender, domain, or keyword to match. Matches are case-insensitive. You can chain extra conditions in the Advanced panel below.' },
      { title: 'Rule toggle (green)', description: 'Turn the rule ON (green) or OFF (gray) without deleting it. Disabling a rule stops it matching new mail but leaves it ready to re-enable later.' },
      { title: 'Re-sync rule button (red circular arrow)', description: 'Pushes JUST this rule to your mailbox immediately — useful after editing the value. It re-runs the rule against your inbox so existing matching mail is filed under the category.' },
      { title: 'Last synced timestamp (cloud icon)', description: 'Shows when this exact rule was last pushed to your mailbox provider (e.g. "10m ago"). Green = in sync. Older or red = pending — will auto-sync shortly.' },
      { title: 'Delete (trash icon)', description: 'Permanently removes the rule AND tells your mailbox to unlabel / move back to Inbox every email that was previously filed by this rule. Use the toggle instead if you only want to pause it.' },
      { title: 'Show / Hide Advanced', description: 'Expands the rule to add chained conditions joined by AND/OR: Recipient (Any / Just me / CC\'d / etc.), Subject contains, and Body contains. Use this when a single sender or keyword is not specific enough.' },
      { title: 'AND / OR dropdowns', description: 'Inside Advanced, each extra condition (Recipient, Subject contains, Body contains) is joined to the main rule with AND (all must match) or OR (any can match).' },
    ],
    outro:
      'When you delete a rule — or turn its parent category OFF — InboxIQ automatically unlabels matching Gmail messages and moves matching Outlook messages from the category folder BACK to your main Inbox. Nothing gets stranded.',
    routes: ['/categories', '/sync'],
    keywords: ['filter', 'rule', 'conditions', 'sender', 'domain', 'keyword', 'advanced', 'and', 'or', 'recipient', 'subject', 'body', 'inbox'],
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
    title: 'AI Daily Brief — guided walkthrough',
    category: 'ai-features',
    summary: 'A morning summary of what landed in your inbox while you were away.',
    intro:
      'The Daily Brief is your personal AI assistant for priorities, updates, and next actions. Open it anytime on demand, or schedule one or more deliveries each day so the right information reaches you at the right moment.',
    steps: [
      { title: "Open today's brief", description: 'Use the sidebar → AI Daily Brief. This page always shows the freshest brief on demand.', route: '/ai-daily-brief' },
      { title: 'Schedule email delivery', description: 'In the Daily Brief Schedule card, pick the days, time and timezone. Toggle Enable email delivery to start receiving it in your inbox.', target: '[data-tour="brief-schedule"]' },
      { title: "Review Today's Priorities", description: "This card lists the exact items the AI flagged as high / medium / low priority. Click any item to jump to the source email.", target: '[data-tour="brief-priorities"]' },
      { title: 'Print or share the brief', description: 'Use the Print button to generate a clean, InboxIQ-branded executive report you can save as PDF or email to an assistant.', target: '[data-tour="brief-print"]' },
      { title: 'Check unanswered threads', description: 'The No Reply Tracker card pulls in everything you BCC-tracked. Hover an item to nudge or stop tracking.', target: '[data-tour="brief-noreply"]' },
    ],
    routes: ['/ai-daily-brief'],
    keywords: ['summary', 'morning', 'digest', 'brief', 'schedule'],
  },
  {
    id: 'ai-assistant',
    title: 'AI Chat — your interactive workspace assistant',
    category: 'ai-features',
    summary: 'Talk to your inbox, drive, and the web from one chat.',
    intro:
      'AI Chat is your all-in-one assistant — similar to ChatGPT or Claude, but plugged into YOUR world. It can search your emails, your OneDrive and SharePoint, your documents, and the live web. It can read files you attach, use your current location for "near me" questions, speak its answers out loud, and let you save any conversation as a PDF, Excel sheet, or OneDrive file. Every chat keeps its own memory, so you can keep refining the same topic across many turns. Click "Guide me through this page" to see each part of the screen highlighted with a quick explanation.',
    steps: [
      { title: 'Start a brand new chat', description: 'Click "+ New chat" to start a fresh conversation with a clean memory. Use this whenever you switch topics so the assistant does not blend unrelated context (for example, starting a travel plan after discussing emails).', target: '[data-tour="chat-new"]', route: '/chat' },
      { title: 'Organize chats into folders', description: 'Click "+ New folder" to group related chats — for example "Clients", "Travel", "Q4 Planning", or "Personal". You can then drag chats in, or use the ⋮ menu on any chat → Move to folder. Folders are private to you.', target: '[data-tour="chat-new-folder"]' },
      { title: 'Your recent chats — grouped by date', description: 'Every conversation lives in the left sidebar, automatically grouped into Today / This Week / Last Week / Older and by folder. Click any chat to reopen it exactly where you left off — full history, attachments and citations are preserved.', target: '[data-tour="chat-conv-row"]' },
      { title: 'Move, export, or delete a chat (⋮ menu)', description: 'Hover any chat in the sidebar and click the ⋮ button to open four actions: Move to folder (file it under one of your folders), Download to computer (save the full transcript as a PDF or Excel spreadsheet), Save to OneDrive (push the transcript into your OneDrive as a document), and Delete (permanently remove). Chats are auto-deleted after 30 days of inactivity, so use Download or Save to OneDrive for anything you want to keep long-term.', target: '[data-tour="chat-conv-menu"]' },
      { title: 'The + button — power options menu', description: 'The blue + button next to the message box opens a menu with everything you can layer onto your next question: Auto mode (assistant picks the right tools automatically — default), Attach files (PDFs, Word, Excel, PowerPoint, images, text), Web search (force live internet lookup), Share location (use your GPS for "near me" answers — single turn only), Deep mode (slower but smarter multi-step reasoning), and Voice (pick the speaking voice used by Play).', target: '[data-tour="chat-attach"]' },
      { title: 'Auto mode — the smart default', description: 'In the + menu, Auto mode lets the assistant decide on its own whether to call web search, read your emails, open OneDrive, or use attachments. Leave this on unless you want to force a specific tool.', target: '[data-tour="chat-attach"]' },
      { title: 'Attach a document', description: '"Attach files" in the + menu lets you upload PDFs, Word, Excel, PowerPoint, images, or text files. The assistant reads the full contents and you can then ask questions, extract tables, summarize, translate, or generate a new document from them.', target: '[data-tour="chat-attach"]' },
      { title: 'Search the live web', description: 'Turn on "Web search" from the + menu to let the assistant browse the live internet — news, prices, flight fares, public-company data, weather, sports scores. It also turns on automatically when your question clearly needs fresh info.', target: '[data-tour="chat-attach"]' },
      { title: 'Share your location for "near me"', description: 'Toggle "Share location" in the + menu when you ask things like "best sushi near me" or "traffic to LAX right now". Your coordinates are used for that single turn only and are never stored.', target: '[data-tour="chat-attach"]' },
      { title: 'Deep reasoning mode', description: 'Switch on "Deep mode" in the + menu for complex, multi-step requests — strategy, analysis, research, comparisons. The assistant takes a little longer but produces noticeably more thorough answers with clearer structure.', target: '[data-tour="chat-attach"]' },
      { title: 'Pick the AI voice', description: 'In the + menu, "Voice" opens a submenu of speaking voices used when you press ▶ Play on any reply. Pick the one that suits you — male, female, calm, energetic — and your choice persists across all chats.', target: '[data-tour="chat-attach"]' },
      { title: 'Talk instead of typing', description: 'Tap the microphone to speak your question. We transcribe in real time — perfect for hands-free use, driving, or long prompts. Stop talking and the text is ready to review and send.', target: '[data-tour="chat-mic"]' },
      { title: 'Type your question here', description: 'Ask anything in plain English: "summarize my last 10 emails", "find the contract from Acme in OneDrive", "what is the cheapest LAX → Rome flight next month?", "draft a polite follow-up to John". Shift+Enter for a new line, Enter to send.', target: '[data-tour="chat-input"]' },
      { title: '"New chat with summary" pill', description: 'Above the message box, the "New chat with summary" button opens a fresh conversation but carries over a short summary of the current thread — handy when a chat gets long and you want a clean slate without losing the context.', target: '[data-tour="chat-capacity"]' },
      { title: 'Your daily message capacity', description: 'The "Unlimited credits left today" / capacity pill shows how many AI messages you have remaining in the current 24-hour window. Each message uses one slot. The counter resets automatically every 24 hours.', target: '[data-tour="chat-capacity"]' },
      { title: 'Messages used in this chat', description: 'The "X msg in this chat" label on the right tells you how many turns this conversation has had. Longer chats keep more memory but use slightly more capacity per turn.', target: '[data-tour="chat-capacity"]' },
      { title: 'Copy the reply', description: 'After the AI answers, click Copy to put the full reply (with formatting) on your clipboard — paste it into an email, a Word doc, Teams, or anywhere else.', target: '[data-tour="chat-msg-copy"]' },
      { title: 'Regenerate the reply', description: 'Not happy with the answer? Click Regenerate to have the assistant try again with a fresh take. Your original question is reused, but the AI rewrites the response from scratch.', target: '[data-tour="chat-msg-regenerate"]' },
      { title: 'Email the reply to yourself (Outlook)', description: 'One click on "Email to me (Outlook)" creates a ready-to-send draft in your Outlook mailbox containing the full AI reply, nicely formatted. Perfect for forwarding the answer to a colleague or keeping it in your inbox for later.', target: '[data-tour="chat-msg-email"]' },
      { title: 'Play the reply out loud', description: 'Click ▶ Play to have the AI read the answer aloud using the voice you picked in the + menu → Voice. Great for long replies, when your eyes need a break, or while driving. Click again to stop.', target: '[data-tour="chat-msg-play"]' },
    ],
    outro:
      'AI Chat respects your permissions — it can only see what you can see across Outlook, OneDrive, and SharePoint, and it never sends mail or changes anything without your explicit confirmation. Export anything important with the ⋮ menu before the 30-day auto-cleanup.',
    routes: ['/chat', '/ai-chat'],
    keywords: ['chat', 'assistant', 'ask', 'question', 'voice', 'microphone', 'capacity', 'folder', 'attach', 'web search', 'play', 'tts', 'copy', 'regenerate'],
  },
  {
    id: 'profile-signature',
    title: 'Profile & email signature — guided walkthrough',
    category: 'account-billing',
    summary: 'Your name, title, photo and signature show up on every AI draft.',
    intro:
      'Take a minute on this page and every AI draft, brief and reply automatically gets noticeably more "you". The live preview at the bottom shows exactly what recipients will see.',
    steps: [
      { title: 'Open Settings', description: 'Use the sidebar → Settings to land on this page.', route: '/settings' },
      { title: 'Upload your profile photo', description: 'Drop a square headshot here. Toggle "Show in signature" on to make it appear in every signature. Profile photo wins over company logo when both are on.', target: '[data-tour="settings-photo"]' },
      { title: 'Upload your company logo', description: 'For Business accounts, drop your logo here. Toggle "Show in signature" on to display it. The logo appears when no profile photo is shown.', target: '[data-tour="settings-logo"]' },
      { title: 'Turn the signature on or off', description: 'Use this switch to enable or disable the AI signature globally. When off, AI drafts go out without any signature appended.', target: '[data-tour="settings-signature-toggle"]' },
      { title: 'Builder vs custom HTML', description: 'Use Signature Builder for guided editing, or paste your own HTML in Custom Signature mode for full control.', target: '[data-tour="settings-signature-mode"]' },
    ],
    routes: ['/settings'],
    keywords: ['signature', 'name', 'title', 'photo', 'logo', 'profile'],
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
  {
    id: 'reply-tracker',
    title: 'My Reply Tracker — guided walkthrough',
    category: 'ai-features',
    summary: 'Track outgoing emails and get nudged when nobody replies.',
    intro:
      'My Reply Tracker helps you monitor important outbound emails, surface unanswered threads, and stay ahead of follow-ups. You opt in per email with a special BCC address, so you stay fully in control of what gets tracked.',
    steps: [
      { title: 'Open Reply Tracker', description: 'Use the sidebar → My Reply Tracker.', route: '/follow-up-reminder' },
      { title: 'Turn the tracker ON', description: 'Flip this master switch to enable tracking on your active mailbox. When OFF, BCC triggers are ignored. The badge next to the title shows Active or Off.', target: '[data-tour="followup-toggle"]' },
      { title: 'BCC a number to start tracking', description: 'Send your email normally and BCC 2@yourdomain.com, 3@yourdomain.com, etc. The NUMBER is the days to wait before nudging you. The exact address for your mailbox is shown right above this diagram.', target: '[data-tour="followup-flow"]' },
      { title: 'Stop or restart a tracker', description: 'To cancel an active tracker, reply on the thread and BCC stop@yourdomain.com (or 0@yourdomain.com). To re-arm, send a fresh email with a numeric BCC.', target: '[data-tour="followup-stop"]' },
    ],
    outro:
      'Use 2 days for urgent decisions, 3–5 for normal asks, 7 for low-priority. Up to 3 reminders per thread, then InboxIQ stops automatically so you never spam a recipient.',
    routes: ['/follow-up-reminder'],
    keywords: ['follow up', 'reply', 'nudge', 'tracker', 'bcc'],
  },
  {
    id: 'meeting-copilot',
    title: 'Meeting Copilot — guided walkthrough',
    category: 'ai-features',
    summary: 'Prep, transcribe and summarize every meeting — with full control over what auto-runs.',
    intro:
      'Meeting Copilot is your end-to-end meeting assistant. It prepares you before the meeting, captures and transcribes the conversation live, then turns it into notes, tasks, action items, and follow-up drafts — all with controls you can tailor to your workflow.',
    steps: [
      { title: 'Open Meeting Copilot', description: 'Use the sidebar → Meeting Copilot.', route: '/meeting-copilot' },
      { title: 'Expand Copilot Behavior', description: 'Click this card to open the global behavior toggles. The one-line summary at the top tells you exactly what is ON / OFF right now.', target: '[data-tour="mc-behavior"]' },
      { title: 'Auto-join all your meetings', description: 'Turn this ON to have Copilot listen to every calendar meeting automatically. You can still toggle individual meetings off in the list below.', target: '[data-tour="mc-autojoin"]' },
      { title: 'Auto-draft the follow-up email', description: 'When ON, Copilot generates a summary + action items and saves it as a draft under "0. AI Draft" after each call. Always review before sending — nothing is sent automatically.', target: '[data-tour="mc-autodraft"]' },
      { title: 'Pick a suggestion style', description: 'Choose Concise, Conversational or Strategic. This is the default tone for the live "what to say" suggestions during calls — you can override it per meeting.', target: '[data-tour="mc-style"]' },
    ],
    routes: ['/meeting-copilot'],
    keywords: ['meeting', 'copilot', 'transcribe', 'summary', 'auto-join'],
  },
  {
    id: 'ai-activity',
    title: 'AI Activity — guided walkthrough',
    category: 'ai-features',
    summary: 'A transparent log of everything the AI did for you.',
    intro:
      'AI Activity is your visibility center for everything AI has done for you. Review drafts, processing, chat usage, meetings, and automation history in one place so you always understand what happened and when.',
    steps: [
      { title: 'Open AI Activity', description: 'Use the sidebar → AI Activity.', route: '/ai-activity' },
      { title: 'Email AI stats', description: 'Top row: AI drafts created, auto-replies sent, calendar events booked, and total emails processed. Each tile is a 30-day rolling number.', target: '[data-tour="aa-email-stats"]' },
      { title: 'Chat & Meetings stats', description: 'Second row: how many AI Chat messages and conversations you have run, and how many meetings Copilot has handled.', target: '[data-tour="aa-chat-stats"]' },
      { title: 'Activity by Category', description: 'Per-category breakdown of drafts vs auto-replies. Use this to spot which categories are pulling the most AI work.', target: '[data-tour="aa-category"]' },
      { title: 'Export the report', description: 'Use this button to download a CSV of every AI action with timestamps — handy for compliance or sharing with your team.', target: '[data-tour="aa-export"]' },
    ],
    routes: ['/ai-activity'],
    keywords: ['activity', 'audit', 'report', 'log', 'transparency'],
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
  '/ai-activity': ['ai-activity'],
  '/follow-up-reminder': ['reply-tracker'],
  '/meeting-copilot': ['meeting-copilot'],
  '/settings': ['profile-signature'],
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

export type HelpArticleAccess = FeatureKey | FeatureKey[] | 'admin' | 'always';

export const HELP_ARTICLE_ACCESS: Partial<Record<string, HelpArticleAccess>> = {
  welcome: 'always',
  'connect-mailbox': 'always',
  'connect-calendar': ['meeting_copilot'],
  'categories-overview': 'email_intelligence',
  rules: 'email_intelligence',
  'ai-drafts': ['ai_draft', 'ai_auto_reply'],
  'daily-brief': ['daily_brief', 'ai_assistant'],
  'ai-assistant': 'ai_chat',
  'profile-signature': 'always',
  'admin-overview': 'admin',
  'admin-groups': 'admin',
  'admin-domains': 'admin',
  'admin-support-issues': 'admin',
  'troubleshoot-no-drafts': ['ai_draft', 'ai_auto_reply', 'email_intelligence'],
  'troubleshoot-reconnect': 'always',
  'email-agent': 'email_agent',
  'reply-tracker': 'feature.follow_up_reminder',
  'meeting-copilot': 'meeting_copilot',
  'ai-activity': 'reports',
};

export function filterHelpArticlesByAccess(
  articles: HelpArticle[],
  hasFeature: (key: FeatureKey) => boolean,
  isSuperAdmin: boolean,
): HelpArticle[] {
  if (isSuperAdmin) return articles;

  return articles.filter((article) => {
    const access = HELP_ARTICLE_ACCESS[article.id] ?? 'always';
    if (access === 'always') return true;
    if (access === 'admin') return false;
    if (Array.isArray(access)) return access.some((key) => hasFeature(key));
    return hasFeature(access);
  });
}

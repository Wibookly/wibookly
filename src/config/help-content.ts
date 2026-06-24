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
    summary: 'Your AI intelligence assistant for daily priorities, emails, meetings, and follow-ups.',
    intro:
      "The AI Daily Brief is your personal intelligence assistant. It continuously reads across your connected inbox and calendar, weighs every item against your priorities, deadlines, and meeting schedule, and tells you exactly what deserves your focus right now. It keeps tracking each item until you mark it done, the email leaves your inbox, or the meeting is resolved — so nothing important slips. You can open the page anytime for a live, on-demand view, and you can also schedule one or more deliveries to your email so the brief lands in your inbox at the exact time you want each day.",
    steps: [
      { title: 'Open the Daily Brief', description: 'Sidebar → My Daily Brief. The page recomputes on every visit so you always see the freshest read of your inbox and calendar — no manual refresh required.', route: '/ai-daily-brief' },
      { title: 'Greeting & context banner', description: 'The gradient header greets you by name and gives a one-line read of your day (e.g. "A clear schedule provides an opportunity for deep work"). It is generated from today\'s calendar density and inbox load.' },
      { title: 'Top stat tiles', description: '"Priorities" = items the AI says need your attention today. "Meetings Today" = events on your calendar. "Carry-over" = open items from previous briefs that you have not closed yet. "Quick Wins" = short, low-effort items you can knock out in a few minutes.' },
      { title: 'Email me', description: 'Sends the current brief to your account email right now — useful if you want a copy on your phone or to forward it to an assistant.', target: '[data-tour="brief-email"]' },
      { title: 'Print / Save as PDF', description: 'Opens a clean, InboxIQ-branded executive report formatted for letter-size paper. Use your browser\'s "Save as PDF" to archive it.', target: '[data-tour="brief-print"]' },
      { title: 'Refresh', description: 'Forces the AI to rebuild the brief from scratch using the latest emails and calendar events. Use it after a big batch of new mail arrives.', target: '[data-tour="brief-refresh"]' },
      { title: 'Your Action Items — Emails group', description: 'Every email that needs a reply, decision, or follow-up. Each card shows who it is from, the context, the recommended Do action, why it matters, and an estimated time to handle.' },
      { title: 'Your Action Items — Calendar group', description: 'Meetings that need prep, an RSVP, or a follow-up note. Same Mark done / Snooze / Remind me / Schedule controls as email items.' },
      { title: 'Priority colors', description: 'The left bar and the HIGH / MEDIUM / LOW badge are driven by the colors you set in Priority Color Settings below. Red = act today, Yellow = this week, Green = whenever.' },
      { title: 'Carried-over badge', description: 'A "Carried over ×N" pill means this item has appeared in N previous briefs without being closed. The AI keeps surfacing it until you Mark done or the underlying email/meeting is resolved.' },
      { title: 'Mark done', description: 'Closes the item permanently. It will not appear in tomorrow\'s brief.' },
      { title: 'Snooze', description: 'Hides the item until tomorrow\'s brief, where it returns with a fresh carry-over count.' },
      { title: 'Remind me', description: 'Creates a follow-up reminder in your No Reply Tracker so you get pinged if the thread stays silent.' },
      { title: 'Schedule', description: 'Proposes time slots from your availability and books a calendar event to handle the item.' },
      { title: 'Daily Brief Schedule card', description: 'Below the action items. This is where you set up automatic email delivery of the brief.', target: '[data-tour="brief-schedule"]' },
      { title: 'Send to & Timezone', description: 'The email address that will receive the brief and the timezone the schedule runs in. Briefs are always sent from agent@energyforward.com.' },
      { title: 'Schedule presets', description: 'Click Weekdays (Mon–Fri), Every day, Weekends, or Custom to add a recurring delivery. You can add multiple schedules (e.g. a morning brief and an evening recap).' },
      { title: 'Schedule row controls', description: 'The toggle on each row enables/disables that schedule without deleting it. The pencil edits time and days; the trash deletes it. The ACTIVE badge confirms the next run will fire.' },
      { title: 'Priority Color Settings', description: 'Change the color used for High / Medium / Low priority items everywhere in the brief (web page, email, and PDF). Click a swatch to pick a custom color, or use Reset to Defaults to go back to red/yellow/green.' },
    ],
    outro:
      "**Tip:** Treat the brief like a daily standup with yourself. Open it once in the morning, knock down anything in the Quick Wins tile, Mark done what is finished, Snooze what is not ready, and let the carry-over count tell you what is sliding.",
    routes: ['/ai-daily-brief'],
    keywords: ['summary', 'morning', 'digest', 'brief', 'schedule', 'priorities', 'carry-over', 'action items'],
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
      { title: 'The + button — power options menu', description: 'The blue + button next to the message box opens a menu with everything you can layer onto your next question: Auto mode, Attach files, Web search, Share location, Deep mode, and Voice. Each option is broken down in the next steps and the spotlight will point at the exact row in the menu.', target: '[data-tour="chat-tools"]' },
      { title: '+ menu → Auto mode (the smart default)', description: 'First row in the + menu, with a checkmark by default. In Auto mode the assistant decides on its own whether to call web search, read your emails, open OneDrive, or use attachments. Leave this on unless you want to force a specific tool — turning any other option below ON overrides Auto for that one turn.', target: '[data-tour="chat-tools"]' },
      { title: '+ menu → Attach files', description: 'Second row in the + menu (paperclip icon). Upload PDFs, Word, Excel, PowerPoint, images, or text files. The assistant reads the full contents and you can then ask questions, extract tables, summarize, translate, or generate a new document from them.', target: '[data-tour="chat-attach"]' },
      { title: '+ menu → Web search', description: 'Third row in the + menu (globe icon). Forces the assistant to browse the live internet for that turn — news, prices, flight fares, public-company data, weather, sports scores. It also turns on automatically when your question clearly needs fresh info.', target: '[data-tour="chat-web"]' },
      { title: '+ menu → Share location', description: 'Fourth row in the + menu (pin icon). Toggle this ON when you ask things like "best sushi near me" or "traffic to LAX right now". Your coordinates are used for that single turn only and are never stored.', target: '[data-tour="chat-location"]' },
      { title: '+ menu → Deep mode', description: 'Fifth row in the + menu (sparkles icon). Switch ON for complex, multi-step requests — strategy, analysis, research, comparisons. The assistant takes a little longer but produces noticeably more thorough answers with clearer structure.', target: '[data-tour="chat-deep"]' },
      { title: '+ menu → Voice', description: 'Last row in the + menu (speaker icon). Opens a submenu of speaking voices used when you press ▶ Play on any reply. Pick the one that suits you — male, female, calm, energetic — and your choice persists across all chats.', target: '[data-tour="chat-tools"]' },
      { title: 'Talk instead of typing', description: 'Tap the microphone to speak your question. We transcribe in real time — perfect for hands-free use, driving, or long prompts. Stop talking and the text is ready to review and send.', target: '[data-tour="chat-mic"]' },
      { title: 'Type your question here', description: 'Ask anything in plain English: "summarize my last 10 emails", "find the contract from Acme in OneDrive", "what is the cheapest LAX → Rome flight next month?", "draft a polite follow-up to John". Shift+Enter for a new line, Enter to send.', target: '[data-tour="chat-input"]' },
      { title: '"New chat with summary" pill', description: 'Above the message box, the "New chat with summary" button opens a fresh conversation but carries over a short summary of the current thread — handy when a chat gets long and you want a clean slate without losing the context.', target: '[data-tour="chat-capacity"]' },
      { title: 'Your daily message capacity', description: 'The "Unlimited credits left today" / capacity pill shows how many AI messages you have remaining in the current 24-hour window. Each message uses one slot. The counter resets automatically every 24 hours.', target: '[data-tour="chat-capacity"]' },
      { title: 'Messages used in this chat', description: 'The "X msg in this chat" label on the right tells you how many turns this conversation has had. Longer chats keep more memory but use slightly more capacity per turn.', target: '[data-tour="chat-capacity"]' },
      { title: 'Copy the reply', description: 'After the AI answers, click Copy to put the full reply (with formatting) on your clipboard — paste it into an email, a Word doc, Teams, or anywhere else.', target: '[data-tour="chat-msg-copy"]' },
      { title: 'Regenerate the reply', description: 'Not happy with the answer? Click Regenerate to have the assistant try again with a fresh take. Your original question is reused, but the AI rewrites the response from scratch.', target: '[data-tour="chat-msg-regenerate"]' },
      { title: 'Email the reply to yourself (Outlook)', description: 'One click on "Email to me (Outlook)" creates a ready-to-send draft in your Outlook mailbox containing the full AI reply, nicely formatted. Perfect for forwarding the answer to a colleague or keeping it in your inbox for later.', target: '[data-tour="chat-msg-email"]' },
      { title: 'Play the reply out loud', description: 'Click ▶ Play to have the AI read the answer aloud using the voice you picked in the + menu → Voice. Great for long replies, when your eyes need a break, or while driving. Click again to stop.', target: '[data-tour="chat-msg-play"]' },
      { title: 'Re-open any past chat', description: 'In the sidebar, click any conversation row to reopen it. The currently open chat is highlighted in green under TODAY / THIS WEEK / LAST WEEK so you always know where you are. Full history, attachments, and citations are restored exactly as you left them.', target: '[data-tour="chat-conv-row"]' },
      { title: 'Conversation header (gradient banner)', description: 'The colored banner at the top of an open chat shows the chat title and the tagline "Ask follow-ups, draft replies, or summarize — all in one thread." It is your reminder that this thread keeps its own memory — every message you send below builds on what was said earlier.' },
      { title: '⋮ menu — Move to folder', description: 'First option in the three-dot menu on any chat row. Pick one of your folders (Clients, Travel, Personal, etc.) to file the chat under it. The chat moves out of the date group and into the chosen folder in the sidebar.', target: '[data-tour="chat-conv-menu"]' },
      { title: '⋮ menu — Download to computer', description: 'Second option. Saves the entire transcript (every question and every AI reply, with formatting and links preserved) to your computer as a PDF or Excel spreadsheet. Use this to archive important chats before the 30-day auto-cleanup.', target: '[data-tour="chat-conv-menu"]' },
      { title: '⋮ menu — Save to OneDrive', description: 'Third option. Pushes the full transcript straight into your OneDrive as a document so the whole company (or shared collaborators) can read it. Great for research, decisions, or any chat worth keeping in your knowledge base.', target: '[data-tour="chat-conv-menu"]' },
      { title: '⋮ menu — Delete', description: 'Last option, shown in red. Permanently removes the chat and all its history. There is no undo — export first with Download or Save to OneDrive if you might need it later.', target: '[data-tour="chat-conv-menu"]' },
    ],
    outro:
      'AI Chat respects your permissions — it can only see what you can see across Outlook, OneDrive, and SharePoint, and it never sends mail or changes anything without your explicit confirmation. Export anything important with the ⋮ menu before the 30-day auto-cleanup.',
    routes: ['/chat', '/ai-chat'],
    keywords: ['chat', 'assistant', 'ask', 'question', 'voice', 'microphone', 'capacity', 'folder', 'attach', 'web search', 'play', 'tts', 'copy', 'regenerate', 'move to folder', 'download', 'onedrive', 'delete'],
  },
  {
    id: 'profile-signature',
    title: 'My Profile & Signature — full walkthrough',
    category: 'account-billing',
    summary: 'Every section on this page, what it does, and how it feeds your AI drafts and email signature.',
    intro:
      'This page is the single source of truth for "who you are" inside InboxIQ. Anything you set here flows into every AI-drafted reply, every daily brief, and the signature appended to outgoing email. The page is split into three blocks: Directory Information (auto-synced from Microsoft 365, read-only), Your Inputs (what you type — title + AI personalization), and Email Signature (builder + live preview).',
    steps: [
      { title: 'Page header — My Profile & Signature', description: 'The orange hero at the top names the page. Everything you change below saves automatically and starts being used by the AI on your very next draft — no Save button needed.' },
      { title: 'Legend — read-only vs editable', description: 'The two small chips under the header explain the color coding: grey rows are auto-synced from Microsoft 365 and cannot be edited here (fix them in M365), blue-tinted rows are yours to fill in and personalize the AI.' },
      { title: 'Directory Information block', description: 'The grey card titled "Directory Information — Auto-synced from Microsoft 365" holds your Full Name, Email, Company, Department, Business Phone and Mobile Phone. All six fields are pulled live from your M365 profile and are read-only here — edit them in Microsoft 365 and they re-sync.', target: '[data-tour="settings-directory"]' },
      { title: 'Directory Information — Full Name', description: 'Pulled live from your Microsoft 365 profile. Used as the name in your signature ("Best regards, <Full Name>") and as how the AI refers to you. To change it, update it in Microsoft 365 and it will re-sync.', target: '[data-tour="settings-directory"]' },
      { title: 'Directory Information — Email', description: 'Your primary mailbox address from M365. Used in the signature footer and as the reply-to. Read-only.', target: '[data-tour="settings-directory"]' },
      { title: 'Directory Information — Company', description: 'Your organization name from M365 / Entra ID. The AI uses it for context ("I work at <Company>") and the signature builder can show it under your name.', target: '[data-tour="settings-directory"]' },
      { title: 'Directory Information — Department', description: 'Your M365 department (e.g. "Information Technology"). The AI uses it to tune tone — an IT department reply sounds different from a Sales department reply.', target: '[data-tour="settings-directory"]' },
      { title: 'Directory Information — Business Phone', description: 'Office number from M365. Auto-populates the "Phone (Optional)" field in the signature builder below. Read-only here — edit it in M365 to change.', target: '[data-tour="settings-directory"]' },
      { title: 'Directory Information — Mobile Phone', description: 'Mobile number from M365. Auto-populates the "Mobile (Optional)" field in the signature builder below.', target: '[data-tour="settings-directory"]' },
      { title: 'Your Inputs block', description: 'The blue-tinted card titled "Your Inputs — These feed your signature and AI personalization" is where you type the three fields that personalize the AI: Title, Responsibilities, and Communication style. Everything here saves as you type.', target: '[data-tour="settings-inputs"]' },
      { title: 'Your Inputs — Title (used in signature)', description: 'The single most important field on the page. Whatever you type here appears directly under your name in every signature AND tells the AI what role to write from (e.g. "IT Manager" produces a different tone than "VP of Sales"). Required for Business accounts.', target: '[data-tour="settings-title"]' },
      { title: 'Your Inputs — Responsibilities (AI-generated, editable)', description: 'A short description of what you actually do day-to-day (approvals, follow-ups, contracts, scheduling, etc.). The AI uses this to decide what kind of replies make sense for you. Click Edit to type your own, or click Regenerate to have the AI rewrite it from your title and company.', target: '[data-tour="settings-resp"]' },
      { title: 'Your Inputs — Communication style (AI-generated, editable)', description: 'Tone, length, sign-offs, things to avoid. This is the AI\'s style guide for your voice — e.g. "warm but concise, always end with Best, never use exclamation points". Edit it directly or click Regenerate for a fresh AI suggestion based on your role.', target: '[data-tour="settings-style"]' },
      { title: 'Email Signature — master on/off switch', description: 'The green "Signature On" toggle in the top-right of the Email Signature card. When ON, every AI-drafted email and reply gets your signature appended automatically. When OFF, drafts go out with no signature at all.', target: '[data-tour="settings-signature-toggle"]' },
      { title: 'Email Signature — Use Signature Builder vs Paste Custom Signature', description: 'Two modes. "Use Signature Builder" (recommended) generates a clean, mobile-friendly HTML signature from the fields below — font, color, phone, logo, photo. "Paste Custom Signature" lets you paste your own raw HTML if you already have a signature you want to keep pixel-perfect.', target: '[data-tour="settings-signature-mode"]' },
      { title: 'Builder — Font and Text Color', description: 'Pick the typeface and color used for your signature text. Text Color defaults to #333333 (near-black) for maximum readability on white backgrounds. Click the swatch to change it.', target: '[data-tour="settings-font-color"]' },
      { title: 'Builder — Phone / Mobile / Website / Email (Optional)', description: 'Pre-filled from Microsoft 365 where possible. Leave a field blank to hide that line in the signature. Website is the only one you usually need to type yourself.', target: '[data-tour="settings-contact"]' },
      { title: 'Builder — Profile Photo (Optional) + Show in signature toggle', description: 'Upload a square headshot (max 2 MB). The "Show in signature" toggle on the right controls whether it actually appears in outgoing email. Profile photo WINS over company logo when both are turned on — that\'s by design so headshots take priority on personal replies.', target: '[data-tour="settings-photo"]' },
      { title: 'Builder — Company Logo (Optional) + Show in signature toggle', description: 'Upload your company logo (PNG/JPG, max 2 MB, ~200×50 px works best). Toggle "Show in signature" ON to display it. The logo only shows when no profile photo is shown, so use logo-only signatures by leaving Profile Photo off.', target: '[data-tour="settings-logo"]' },
      { title: 'Signature Preview', description: 'The bottom card renders your signature exactly as recipients will see it — same fonts, same colors, same logo/photo. Every change above updates this preview live. If it looks right here, it will look right in their inbox.', target: '[data-tour="settings-preview"]' },
    ],
    outro:
      'Rule of thumb: fill out Title, Responsibilities and Communication style and your AI drafts immediately stop sounding generic. Toggle Signature On, upload either a photo OR a logo, and the preview at the bottom is exactly what will go out on your next AI-drafted email. Everything saves automatically.',
    routes: ['/settings'],
    keywords: ['signature', 'name', 'title', 'photo', 'logo', 'profile', 'directory', 'company', 'department', 'phone', 'mobile', 'font', 'color', 'preview', 'responsibilities', 'communication style', 'tone'],
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
    title: 'No Reply Tracker — every section explained',
    category: 'ai-features',
    summary: 'Never lose a thread. BCC a numeric address and InboxIQ nudges when nobody replies.',
    intro:
      'The No Reply Tracker page is a single dashboard for "I sent it — did they answer?" follow-ups. You opt in per email with a special numeric BCC address (the number = how many days to wait). InboxIQ then watches the thread, files it under your No Reply Tracker category if nobody replies, and can even draft or send a polite nudge for you — all inside your business hours.',
    steps: [
      { title: '1. Master toggle — No Reply Tracker (Active)', description: 'The big green switch at the top of the first card turns the whole tracker ON or OFF for your active mailbox. When OFF, any numeric BCC you send is ignored — nothing is watched, nothing is drafted. When ON, the badge next to the title shows "Active" in green. This also LOCKS Business Hours on while the tracker is running so nudges never go out in the middle of the night.', target: '[data-tour="followup-toggle"]' },
      { title: '2. How it works — the 4 step flow', description: 'The 4 numbered tiles ("BCC a number" → "We watch the reply" → "No reply → nudge" → "Up to 3 attempts") explain the lifecycle of every tracked thread. The number you BCC (e.g. 3@yourdomain.com) is the days to wait. Minimum is 2. After 3 unanswered nudges the tracker stops itself so you never spam a recipient.', target: '[data-tour="followup-flow"]' },
      { title: '3. Active mailbox + trigger domain', description: 'Above the flow tiles InboxIQ shows the exact mailbox the tracker is monitoring and your trigger domain (e.g. @energyforward.com). Numeric BCCs only work when sent FROM this mailbox TO an address on the trigger domain — that is how InboxIQ knows the BCC is for tracking and not a real recipient.' },
      { title: '4. Stop or restart anytime', description: 'Cancel a live tracker by replying on the thread and adding BCC stop@yourdomain.com (or 0@yourdomain.com). To re-arm later, send a fresh email on the thread with a new numeric BCC like 3@yourdomain.com. You can stop and restart as many times as you need.', target: '[data-tour="followup-stop"]' },
      { title: '5. Examples for your mailbox', description: 'The grid of chips (2@…, 3@…, 5@…, 7@…, 10@…, 14@…, 21@…, 30@…) shows ready-to-copy BCC addresses for your domain. Any number ≥ 2 works — pick the one that matches how long you are willing to wait.', target: '[data-tour="followup-master"]' },
      { title: '6. When the due date arrives — Always: move to category', description: 'On the due date, the original email is ALWAYS labeled and moved into your No Reply Tracker category so it surfaces in your inbox audit. This row is locked ON ("Always On") because it is the core of the feature — it cannot be turned off.', target: '[data-tour="followup-action-tag"]' },
      { title: '7. Auto Draft a follow-up (toggle)', description: 'When green, InboxIQ writes a polite, on-brand nudge and saves it as a real draft in your Outlook Drafts folder — you review and click Send. Turn this off if you want to write the nudge yourself.', target: '[data-tour="followup-action-draft"]' },
      { title: '8. Auto Reply — sends automatically (toggle)', description: 'When green, InboxIQ writes AND SENDS the follow-up for you without review. The yellow warning ("Replies will be sent without your review") is there for a reason — use this for low-risk threads only. Auto Reply requires Auto Draft to be on first.', target: '[data-tour="followup-action-reply"]' },
      { title: '9. Lifecycle & how to stop a tracker', description: 'Four ways a tracker ends:\n• Reply received — the recipient answered, tracker clears itself and the email leaves the No Reply Tracker category.\n• Auto-stop after 3 nudges — InboxIQ stops on its own after the 3rd reminder; the email stays in the category so you can decide manually.\n• Manual stop via BCC — reply on the thread with BCC stop@yourdomain.com or 0@yourdomain.com to cancel immediately and move the original message back to the inbox.\n• Re-arm anytime — sending a fresh email on the thread with a numeric BCC starts a brand-new tracker with a fresh due date and fresh reminder count.', target: '[data-tour="followup-lifecycle"]' },
      { title: '10. Business hours — master toggle', description: 'The green switch on the Business hours card limits Auto Draft, Auto Reply, and the daily auto-audit to your working hours. Outside those hours, emails are still moved to your No Reply Tracker category — only the drafts and sends wait. This toggle is locked ON while No Reply Tracker is active so nudges never fire at 2am.', target: '[data-tour="followup-bh"]' },
      { title: '11. Start / End / Timezone', description: 'Pick the local Start and End time of your workday and the timezone they apply to. Timezone is auto-detected from Outlook on first run and falls back to your computer. The "Use mine" button instantly sets the timezone to your browser/computer setting.', target: '[data-tour="followup-bh"]' },
      { title: '12. Business days', description: 'Click any day pill (Sun – Sat) to include or exclude it. Selected days are blue. The "Current window" line at the bottom shows the exact rule InboxIQ will follow (e.g. "8:00 AM – 5:00 PM (America/Los_Angeles)").', target: '[data-tour="followup-bh"]' },
      { title: '13. Inbox auto-audit', description: 'Every 24 hours InboxIQ scans your Sent Items, flags anything that has not been replied to, copies it into the Outlook "No-Reply-Tracker" folder, and surfaces it in the InboxIQ No Reply Tracker category. No drafts are written, nothing is sent — it is a pure audit so you can review and act manually. The "Auto-sync every 24 hours" pill shows the audit is live whenever the tracker is ON.', target: '[data-tour="followup-audit"]' },
    ],
    outro:
      'Use 2 days for urgent decisions, 3–5 for normal asks, 7+ for low-priority. Up to 3 nudges per thread, then InboxIQ stops automatically. Business hours, auto-audit, and the manual stop BCC keep you in full control — nothing is sent without your permission unless YOU turn Auto Reply on.',
    routes: ['/follow-up-reminder'],
    keywords: ['follow up', 'reply', 'nudge', 'tracker', 'bcc', 'no reply', 'business hours', 'auto draft', 'auto reply', 'audit', 'timezone'],
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
    summary: 'A full transparency dashboard for every action the AI has taken on your behalf.',
    intro:
      "AI Activity is your transparency and audit center. Every time the AI drafts an email, sends an auto-reply, books a meeting, answers a chat question, or processes an inbox item, it is recorded here with a timestamp. Use this page to verify what the AI has been doing, spot which categories drive the most automation, and export a clean report for compliance or team review.",
    steps: [
      { title: 'Open AI Activity', description: 'Sidebar → AI Activity. The dashboard loads with a rolling 30-day view by default.', route: '/ai-activity' },
      { title: 'Email AI stats row', description: 'Top tiles: AI drafts created, auto-replies sent, calendar events booked, and total emails processed. Each tile reflects the last 30 days across all your connected mailboxes.', target: '[data-tour="aa-email-stats"]' },
      { title: 'Chat & Meetings stats row', description: 'Second row: AI Chat messages sent, distinct AI Chat conversations, and meetings handled by Meeting Copilot. Use these to see how heavily you lean on the conversational and meeting features.', target: '[data-tour="aa-chat-stats"]' },
      { title: 'Activity by Category', description: 'A per-category breakdown showing drafts vs auto-replies for every category you have configured. Tall bars highlight which categories are pulling the most AI work — useful when tuning rules.', target: '[data-tour="aa-category"]' },
      { title: 'Recent activity feed', description: 'A scrollable, timestamped log of each AI action: what was done, on which email or meeting, and the outcome. Click any row to jump to the source item.' },
      { title: 'Filters & time range', description: 'Narrow the view by action type (draft, auto-reply, schedule, chat) or by date range. Filters apply to both the stat tiles and the feed.' },
      { title: 'Export the report', description: 'Download a CSV of every AI action with full timestamps, categories, and outcomes. Useful for compliance reviews or sharing weekly metrics with your team.', target: '[data-tour="aa-export"]' },
    ],
    outro:
      "**Good to know:** AI Activity is read-only — it never changes your data. If a number looks wrong, use the Refresh control; if an action looks unexpected, click into it to see the exact email or meeting that triggered it.",
    routes: ['/ai-activity'],
    keywords: ['activity', 'audit', 'report', 'log', 'transparency', 'dashboard', 'analytics'],
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

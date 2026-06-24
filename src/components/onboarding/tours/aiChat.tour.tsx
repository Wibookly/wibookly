import type { Step } from 'react-joyride';

export const aiChatTour: Step[] = [
  {
    target: 'body',
    title: 'Welcome to InboxIQ Chat',
    content:
      "This is your AI workspace. Ask questions, search the web, draft documents (Word / PDF / Excel / PowerPoint), analyze your inbox, schedule meetings — all from one conversation. I'll walk you through every part of this screen, one arrow at a time.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: '[data-tour="chat-sidebar-header"]',
    title: 'InboxIQ Chat — sidebar header',
    content:
      "This is the header of your chat sidebar. Everything below it belongs to the chat workspace: the New chat button, your folders, and your past conversations grouped by date (Today, This Week, Last Week, Older).",
    placement: 'right',
  },
  {
    target: '[data-tour="chat-new"]',
    title: '+ New chat',
    content:
      "Click here to start a brand-new conversation with a clean memory. Use a new chat whenever you switch topics — for example: a new chat per client, per trip, or per project. Chats save automatically as you type.",
    placement: 'right',
  },
  {
    target: '[data-tour="chat-new-folder"]',
    title: 'New folder — organize your chats',
    content:
      "Create folders to group related chats. Examples: 'Clients', 'Travel', 'Q4 Planning', 'Personal'. After you create a folder, drag a chat into it from the ⋮ menu on any conversation row.",
    placement: 'right',
  },
  {
    target: '[data-tour="sidebar-pin"]',
    title: 'Sidebar pinned / Unpin',
    content:
      "Controls whether the main app sidebar (Email Connections, Email Intelligence, No Reply Tracker, Settings, Admin, etc.) stays pinned open or auto-hides on the Chat page to give you more room. Click UNPIN to auto-hide it, click PIN to keep it always visible.",
    placement: 'right',
  },
  {
    target: '[data-tour="chat-hero"]',
    title: 'AI Intelligence header',
    content:
      "The purple/pink banner shows you're in the AI Intelligence area and which conversation is active. The title updates to match the current chat. On mobile, the menu icon opens the sidebar.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="chat-theme"]',
    title: 'Light / Dark mode toggle',
    content:
      "Click the sun/moon icon to switch the entire app between light and dark themes. Your choice is remembered across sessions and applies to every page, not just chat.",
    placement: 'bottom-end',
  },
  {
    target: '[data-tour="chat-hero-avatar"]',
    title: 'Your InboxIQ AI agent',
    content:
      "This is the InboxIQ AI agent. While idle it shows the branded portrait; while it's thinking or replying, the avatar animates so you know work is happening behind the scenes.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="chat-hero-greeting"]',
    title: 'How can I help you today?',
    content:
      "The empty-state greeting. It only shows on a fresh chat. Below it is the message box (to type your question) and the starter prompts (one-click suggestions).",
    placement: 'bottom',
  },
  {
    target: '[data-tour="chat-attach"]',
    title: 'Attach files (the + button)',
    content:
      "Upload PDFs, Word, Excel, PowerPoint, images, or text files. InboxIQ reads the contents — you can then ask 'summarize this contract', 'pull the line items into a table', or 'rewrite this in plain English'.",
    placement: 'top-start',
  },
  {
    target: '[data-tour="chat-input"]',
    title: 'Message InboxIQ — type your question',
    content:
      "Type any request in plain English: 'summarize my last 10 emails', 'draft a reply to John about the proposal', 'find the cheapest LAX → Rome flight next month', 'what's on my calendar tomorrow?'. Press Enter to send, Shift+Enter for a new line.",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-mic"]',
    title: 'Voice input — talk instead of typing',
    content:
      "Tap the mic and speak naturally. InboxIQ transcribes in real time and your message is ready to send when you stop talking. Use the small chevron next to it to choose which microphone to use (useful for headsets).",
    placement: 'top-end',
  },
  {
    target: '[data-tour="chat-capacity"]',
    title: 'Daily message capacity',
    content:
      "Shows how many AI messages you've used today out of your daily allowance. The counter resets every 24 hours. If you hit the cap, an admin can raise it from Admin Dashboard → AI Usage.",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-starter-prompts"]',
    title: 'Starter prompts',
    content:
      "Pre-built example prompts to get you going — click any one and it drops into the message box, ready to send or edit. The number in parentheses is how many prompts are available (built-in + your custom ones).",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-add-prompt"]',
    title: '+ Add prompt — save your own',
    content:
      "Save your own go-to prompts so you don't have to retype them. Examples: 'Draft a polite follow-up if no reply in 3 days', 'Summarize this thread in 3 bullets'. Your saved prompts appear in the Starter prompts list above.",
    placement: 'top-end',
  },
];

import type { Step } from 'react-joyride';

export const aiChatTour: Step[] = [
  {
    target: 'body',
    title: 'Welcome to InboxIQ Chat',
    content:
      "Your AI workspace. Ask questions, search the web, draft documents (Word/PDF/Excel/PowerPoint), analyze your inbox, schedule meetings — all from one conversation. Chats live in the left sidebar and can be organized into folders.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: '[data-tour="chat-new"]',
    title: 'Start a new chat',
    content:
      "Click 'New chat' to open a fresh conversation. Chats are saved automatically. Use 'New folder' just below to group related chats (e.g. 'Client A', 'Q4 Planning').",
    placement: 'right',
  },
  {
    target: '[data-tour="chat-input"]',
    title: 'Ask anything',
    content:
      "Type a question or instruction. InboxIQ understands natural language — try 'summarize my last 10 emails', 'draft a follow-up to John about the proposal', or 'what is the cheapest LAX → Rome flight next month?'",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-mic"]',
    title: 'Voice input',
    content:
      "Tap the mic and dictate. We transcribe in real time and send when you stop talking. Perfect for hands-free use in the car or on a walk.",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-web"]',
    title: 'Web search (auto-enabled)',
    content:
      "InboxIQ automatically turns on web search whenever your question needs fresh info from the internet — flights, prices, news, public companies, weather. The 🌐 badge lights up when it kicks in and turns off after the answer. You don't need to toggle anything.",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-location"]',
    title: 'Location (auto-enabled)',
    content:
      "When you ask 'near me' or about local places, InboxIQ enables location automatically for that turn only. It turns back off right after — your location is never persistently shared.",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-deep"]',
    title: 'Deep reasoning (auto-enabled)',
    content:
      "For complex multi-step requests, deep reasoning auto-enables so the model thinks longer before answering. It costs a bit more time but produces dramatically better results for analysis, planning, and math.",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-attach"]',
    title: 'Attach files',
    content:
      "Upload PDFs, Word, Excel, PowerPoint, images. InboxIQ reads them and you can ask questions ('summarize this contract'), extract data ('pull the line items into a table'), or generate new documents from the content.",
    placement: 'top',
  },
  {
    target: '[data-tour="chat-capacity"]',
    title: 'Daily capacity',
    content:
      "Your daily chat allowance. Each message uses a small slice. Resets every 24 hours. If you hit the cap, an admin can raise it in /admin → AI Usage.",
    placement: 'bottom',
  },
  {
    target: 'body',
    title: 'Sidebar: folders, export, retention',
    content:
      "Hover any chat in the left sidebar and click ⋮ for: Move to folder, Download to computer (PDF or Excel), or Save to OneDrive (saved into your OneDrive under InboxIQ/Exports). Chats are auto-deleted after 30 days of inactivity — if you keep using a chat it stays alive forever.",
    placement: 'center',
  },
  {
    target: 'body',
    title: "You're ready 🎉",
    content:
      "Click 'Guide me through this page' anytime in the top bar to replay this tour.",
    placement: 'center',
  },
];

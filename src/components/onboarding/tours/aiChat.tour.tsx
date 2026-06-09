import type { Step } from 'react-joyride';

export const aiChatTour: Step[] = [
  {
    target: 'body',
    title: 'Welcome to InboxIQ Chat',
    content:
      "Your AI workspace. Ask questions, search the web, draft documents, analyze your inbox, schedule meetings — all from one conversation.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: '[data-tour="chat-new"]',
    title: 'Start a new chat',
    content:
      'Click here anytime to start a fresh conversation. Chats are saved automatically and organized into folders on the left.',
    placement: 'right',
  },
  {
    target: '[data-tour="chat-input"]',
    title: 'Ask anything',
    content:
      'Type a question or instruction. InboxIQ understands natural language — try "summarize my last 10 emails" or "draft a follow-up to John".',
    placement: 'top',
  },
  {
    target: '[data-tour="chat-mic"]',
    title: 'Voice input',
    content:
      'Tap the mic to dictate. We transcribe in real time and send when you stop talking. Great for hands-free use.',
    placement: 'top',
  },
  {
    target: '[data-tour="chat-web"]',
    title: 'Web search (auto)',
    content:
      'InboxIQ automatically searches the web when your question needs fresh info (flights, prices, news). The 🌐 badge lights up when it kicks in.',
    placement: 'top',
  },
  {
    target: '[data-tour="chat-location"]',
    title: 'Location (auto)',
    content:
      'When you ask "near me" or about local places, InboxIQ enables location automatically and turns it back off after the answer.',
    placement: 'top',
  },
  {
    target: '[data-tour="chat-deep"]',
    title: 'Deep reasoning (auto)',
    content:
      'For complex multi-step requests, deep reasoning auto-enables so the model thinks longer before responding. Turns off when done.',
    placement: 'top',
  },
  {
    target: '[data-tour="chat-attach"]',
    title: 'Attach files',
    content:
      'Upload PDFs, Word, Excel, PowerPoint, images. InboxIQ reads them and you can ask questions or generate documents from the content.',
    placement: 'top',
  },
  {
    target: '[data-tour="chat-capacity"]',
    title: 'Daily capacity',
    content:
      'Shows how much of your daily chat allowance you have used. It resets every 24 hours.',
    placement: 'bottom',
  },
  {
    target: 'body',
    title: 'Folders, export & retention',
    content:
      'Organize chats into folders on the left. Use the ⋮ menu on any chat to Download to computer (PDF/Excel) or Save to OneDrive. Chats are auto-deleted after 30 days unless you export them.',
    placement: 'center',
  },
  {
    target: 'body',
    title: "You're ready 🎉",
    content:
      'Open "Guide me through this page" anytime to replay this tour.',
    placement: 'center',
  },
];

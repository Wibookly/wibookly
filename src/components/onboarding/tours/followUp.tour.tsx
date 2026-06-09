import type { Step } from 'react-joyride';

export const followUpTour: Step[] = [
  {
    target: 'body',
    title: 'No-Reply Tracker',
    content:
      "InboxIQ watches the emails you send and flags the ones that haven't received a reply — so important conversations don't slip through.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: 'body',
    title: 'How it works',
    content:
      'Every outgoing email is monitored. If no reply arrives within your chosen window, it appears in the Pending list with a suggested AI follow-up draft.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Reminder window',
    content:
      'Set how long to wait before flagging — typically 2, 3, or 7 days. You can also exclude newsletters, no-reply senders, and internal domains.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'AI-suggested follow-ups',
    content:
      'For each flagged email, InboxIQ writes a polite nudge using your tone and signature. You review and send — nothing is sent automatically.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Snooze, dismiss, or send',
    content:
      'Snooze a thread to check back later, dismiss if no follow-up is needed, or send the AI draft with one click.',
    placement: 'center',
  },
  {
    target: 'body',
    title: "You're set 🎉",
    content:
      'Open "Guide me through this page" anytime to replay this tour.',
    placement: 'center',
  },
];

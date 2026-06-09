import type { Step } from 'react-joyride';

export const dailyBriefTour: Step[] = [
  {
    target: 'body',
    title: 'AI Daily Brief — your morning executive summary',
    content:
      "Overnight, InboxIQ reads your inbox, calendar, and follow-ups and writes a single concise briefing so you start the day knowing what matters. No more scrolling 200 unread emails before coffee.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: 'body',
    title: "What's inside each brief",
    content:
      "Four sections: (1) Priority emails — high-importance threads needing action, (2) Today's meetings — pulled from your connected calendar with prep notes, (3) Pending replies — anything from the No-Reply Tracker waiting on you, (4) Action items — explicit asks the AI extracted from your emails.",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Delivery schedule',
    content:
      "Open the Schedule card at the top of this page to pick days (weekdays only, every day, custom) and a delivery time (e.g. 7:00 AM in your local timezone). The brief arrives as an email AND is available here on the page. Turn delivery off anytime — the on-screen brief still updates.",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'AI activity log',
    content:
      "Scroll down to see exactly what AI did for you in the last 24 hours: categories applied to which emails, drafts prepared, follow-ups flagged, meetings prepped. Full transparency — every action is logged and reviewable.",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Print & share',
    content:
      "Open any brief and click Print to get an InboxIQ-branded executive report (PDF-ready). Great for forwarding to an assistant, saving to OneDrive, or printing for an offline read.",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Snooze if you need quiet days',
    content:
      "Going on vacation? Open Schedule and pause delivery. The brief will resume the next time you re-enable it — no setup loss.",
    placement: 'center',
  },
  {
    target: 'body',
    title: "You're set 🎉",
    content:
      "Click 'Guide me through this page' anytime in the top bar to replay this tour.",
    placement: 'center',
  },
];

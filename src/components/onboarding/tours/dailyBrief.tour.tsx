import type { Step } from 'react-joyride';

export const dailyBriefTour: Step[] = [
  {
    target: 'body',
    title: 'AI Daily Brief',
    content:
      'Your morning executive summary. InboxIQ reads your inbox, calendar, and follow-ups overnight and delivers a single concise briefing.',
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: 'body',
    title: 'What\'s inside',
    content:
      'Priority emails, action items, meetings of the day, pending replies, and key decisions waiting on you — all summarized in plain language.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Delivery schedule',
    content:
      'Choose when you want it: every weekday at 7am, weekends off, or on-demand. The schedule lives at the top of this page.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'AI activity log',
    content:
      'See exactly what AI did for you overnight: categories applied, drafts prepared, follow-ups flagged, meetings prepped. Full transparency, nothing hidden.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Print & share',
    content:
      'Open any brief and hit Print for an InboxIQ-branded executive report — perfect for forwarding to your assistant or saving to OneDrive.',
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

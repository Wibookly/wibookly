import type { Step } from 'react-joyride';

/**
 * Detailed end-user training for the No-Reply Tracker.
 * Steps spotlight the real UI controls so the user can see exactly
 * what to turn on, where to BCC, and how to stop a tracker.
 */
export const followUpTour: Step[] = [
  {
    target: 'body',
    title: 'No-Reply Tracker — what it does',
    content:
      "InboxIQ watches outgoing emails you choose to track and reminds you when nobody replies. You opt-in per email by adding a special BCC address — there is no shared mailbox, no extra inbox, and nothing is sent without your review.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: '[data-tour="followup-toggle"]',
    title: 'Step 1 — Turn the tracker ON',
    content:
      "Flip this switch to enable tracking on your active mailbox. When it is OFF, BCC triggers are ignored. The status badge next to the title shows Active or Off so you always know.",
    placement: 'left',
  },
  {
    target: '[data-tour="followup-flow"]',
    title: 'Step 2 — BCC a number to start tracking',
    content:
      "Send your email normally and add a BCC like 2@yourdomain.com, 3@yourdomain.com, or 7@yourdomain.com — the NUMBER is how many days to wait before reminding you. The exact address for your mailbox is shown above the diagram (e.g. 3@energyforward.com). The BCC trigger never needs to receive mail; it is just a private signal to InboxIQ.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-flow"]',
    title: 'Step 3 — What happens on the due date',
    content:
      "On day N, InboxIQ checks the thread. If the recipient replied, the tracker clears itself silently. If they did NOT reply, the email is tagged 'No Reply Tracker' in your mailbox and (if Auto Draft is on) a polite follow-up draft is written into your Drafts folder for you to review and send.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-stop"]',
    title: 'Step 4 — Stop or restart anytime',
    content:
      "To cancel an active tracker, reply on the thread and BCC stop@yourdomain.com (or 0@yourdomain.com). To re-arm a thread you already closed, send a new email with another numeric BCC like 3@yourdomain.com — that starts a fresh tracker with a new due date and a fresh reminder count.",
    placement: 'top',
  },
  {
    target: 'body',
    title: 'Best practices',
    content:
      "Use 2 days for urgent decisions, 3–5 days for normal asks, and 7 days for low-priority pings. You get up to 3 reminders per thread, then InboxIQ stops automatically so you never spam a recipient. AI drafts always wait for you — nothing is sent on its own.",
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

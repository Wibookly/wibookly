import type { Step } from 'react-joyride';

/**
 * Detailed end-user training for the No-Reply Tracker.
 * Every visible section and button gets its own spotlighted step so the user
 * sees exactly what each control does before they touch it.
 */
export const followUpTour: Step[] = [
  {
    target: 'body',
    title: 'No Reply Tracker — what it does',
    content:
      "InboxIQ watches outgoing emails you choose to track and reminds you when nobody replies. You opt-in per email by adding a special BCC address — there is no shared mailbox, no extra inbox, and nothing is sent without your review.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: '[data-tour="followup-toggle"]',
    title: 'Step 1 — Master switch',
    content:
      "Flip this ON to enable tracking on your active mailbox. When you turn it on, business hours, the daily 24-hour auto-audit, and Auto Draft all switch on automatically and a red 'No Reply Tracker' category is added to your inbox. When OFF, BCC triggers are ignored.",
    placement: 'left',
  },
  {
    target: '[data-tour="followup-flow"]',
    title: 'Step 2 — BCC a number to start tracking',
    content:
      "Send your email normally and add a BCC like 2@yourdomain.com, 3@yourdomain.com, or 7@yourdomain.com — the NUMBER is how many days to wait before reminding you (minimum 2). The exact address for your mailbox is shown above the diagram. The BCC trigger never needs to receive mail; it is just a private signal to InboxIQ.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-stop"]',
    title: 'Stop or restart anytime',
    content:
      "To cancel an active tracker, reply on the thread and BCC stop@yourdomain.com (or 0@yourdomain.com). To re-arm a closed thread, send a new email with another numeric BCC like 3@yourdomain.com — that starts a fresh tracker with a new due date and reminder count.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-actions"]',
    title: 'Step 3 — What happens on the due date',
    content:
      "These three switches decide what InboxIQ does the moment a tracked email goes unanswered. The label move is always on; Auto Draft and Auto Reply are opt-in.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-action-tag"]',
    title: 'Always: move to "No Reply Tracker" category',
    content:
      "The original email is automatically tagged and surfaced in your inbox under the red 'No Reply Tracker' category so you can act on it. This action is always on while the tracker is enabled and cannot be turned off.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-action-draft"]',
    title: 'Auto Draft a follow-up',
    content:
      "When ON, AI writes a polite nudge into your Outlook Drafts folder. Nothing is sent — you review, edit, and hit Send yourself. Recommended for most workflows.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-action-reply"]',
    title: 'Auto Reply (sends automatically)',
    content:
      "⚠ Use with care. When ON, AI writes AND sends the follow-up without your review. Best reserved for repetitive, low-risk threads where you trust the tone completely.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-lifecycle"]',
    title: 'Lifecycle — how a tracker ends',
    content:
      "Every tracker ends one of four ways: (1) the recipient replies and it auto-clears, (2) the max reminder count is reached and InboxIQ stops on its own, (3) you cancel manually by BCC'ing stop@ or 0@yourdomain.com, or (4) you re-arm a thread with a fresh numeric BCC. You can also click the stop@ / 0@ chips to copy them.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-bh"]',
    title: 'Step 4 — Business hours',
    content:
      "Auto Draft, Auto Reply, and the daily auto-audit only fire during your local working hours. Outside hours, emails still get moved to the No Reply Tracker category, but drafts and sends wait. Set your start, end, timezone, and active days here. Locked ON while the tracker is enabled.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-audit"]',
    title: 'Inbox auto-audit (every 24 hours)',
    content:
      "No manual audit needed. While the tracker is ON, InboxIQ automatically scans the previous 24 hours of your Sent Items every day and flags any email that hasn't been replied to. Flagged messages are copied into your Outlook 'No-Reply-Tracker' folder and surfaced in the No Reply Tracker category. Nothing is drafted or sent here — pure audit.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-autosync"]',
    title: 'Background refresh every 15 minutes',
    content:
      "On top of the daily 24-hour sweep, a lightweight background scan runs every 15 minutes and also refreshes whenever you open this page — so the Active / Paused badge and audit stats stay current.",
    placement: 'top',
  },
];


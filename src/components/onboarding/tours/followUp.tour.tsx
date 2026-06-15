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
    title: 'Inbox audit',
    content:
      "Run a manual sweep of your Sent Items over any date range. Every email without a reply is flagged into the 'No-Reply-Tracker' Outlook folder and surfaced in InboxIQ. No drafts are written and nothing is sent — pure audit for your review.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-audit-from"]',
    title: 'From date',
    content:
      "Pick the earliest sent date to include in the audit. Defaults to 30 days ago.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="followup-audit-to"]',
    title: 'To date',
    content:
      "Pick the most recent sent date to include. Defaults to today.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="followup-audit-run"]',
    title: '"Audit now" button',
    content:
      "Click to scan Sent Items in the selected range right now. You'll get a toast summary: how many were scanned, how many were flagged for follow-up, and how many already had replies.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-audit-presets"]',
    title: 'Quick presets',
    content:
      "One-click date ranges: Last 7, 30, or 90 days. Tap one to fill the From/To fields instantly, then click Audit now.",
    placement: 'top',
  },
  {
    target: '[data-tour="followup-autosync"]',
    title: 'Auto-sync every 24 hours',
    content:
      "While No Reply Tracker is ON, InboxIQ automatically scans the previous 24 hours of Sent Items every day and flags anything that hasn't been replied to. The Active / Paused badge tells you whether the daily sweep is currently running.",
    placement: 'top',
  },
  {
    target: 'body',
    title: 'Best practices',
    content:
      "Use 2 days for urgent decisions, 3–5 days for normal asks, and 7+ days for low-priority pings. You get up to 3 reminders per thread, then InboxIQ stops automatically so you never spam a recipient. AI drafts always wait for you unless you explicitly turn on Auto Reply.",
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

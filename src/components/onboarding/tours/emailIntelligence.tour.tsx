import type { Step } from 'react-joyride';

export const emailIntelligenceTour: Step[] = [
  {
    target: '[data-tour="ei-header"]',
    title: 'Welcome to Email Intelligence',
    content:
      "This page is where you teach InboxIQ how to handle your inbox. Categories sort emails, rules route them, and AI drafts or sends replies. Let's walk through it.",
    placement: 'bottom',
    skipBeacon: true,
  },
  {
    target: '[data-tour="ei-reorder"]',
    title: 'Reorder Categories',
    content:
      'Drag categories up or down. Higher categories are evaluated first — put your most important rules (like Urgent) at the top.',
    placement: 'right',
  },
  {
    target: '[data-tour="ei-color"]',
    title: 'Category Colors',
    content:
      'Click a color circle to change it. Colors sync to labels in Gmail and to category folders in Outlook so your inbox stays visually organized.',
    placement: 'right',
  },
  {
    target: '[data-tour="ei-name"]',
    title: 'Category Name',
    content:
      'Rename categories to match your workflow. These become folders/labels in your connected email account. Examples: Clients, Finance, Urgent, Internal.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="ei-tone"]',
    title: 'AI Tone — Writing Style',
    content: (
      <div>
        <p>Configure how AI writes emails for this category.</p>
        <p style={{ marginTop: 8 }}>
          <strong>Style:</strong> Professional · Friendly · Direct · Concise · Executive · Casual
        </p>
        <p style={{ marginTop: 4 }}>
          <strong>Format:</strong> Short · Detailed · Bullet points · Highlights · Concierge
        </p>
        <p style={{ marginTop: 8, color: '#d97706' }}>
          ⚠ Requires Active + AI Draft (or Auto-Reply) enabled.
        </p>
      </div>
    ),
    placement: 'top',
  },
  {
    target: '[data-tour="ei-active"]',
    title: 'Active Toggle',
    content:
      'Turns the category on. If you disable a category, all emails inside it automatically move back into your Inbox — nothing is ever lost.',
    placement: 'top',
  },
  {
    target: '[data-tour="ei-draft"]',
    title: 'AI Draft',
    content:
      'AI prepares a suggested reply for emails in this category. Drafts wait in your Drafts folder — you review and send.',
    placement: 'top',
  },
  {
    target: '[data-tour="ei-autoreply"]',
    title: 'AI Auto-Reply',
    content: (
      <div>
        <p>AI sends replies automatically — no review.</p>
        <p style={{ marginTop: 8, color: '#d97706' }}>
          ⚠ Use only for repetitive workflows:
        </p>
        <ul style={{ marginTop: 4, paddingLeft: 18, listStyle: 'disc' }}>
          <li>Appointment confirmations</li>
          <li>Ticket acknowledgements</li>
          <li>FAQ replies</li>
        </ul>
      </div>
    ),
    placement: 'top',

  },
  {
    target: '[data-tour="ei-rules"]',
    title: 'Rules',
    content:
      'Rules decide which emails belong to which category. Match by sender, recipient, subject, or body keywords — combined with AND/OR. Works like Gmail filters and Outlook rules.',
    placement: 'top',
  },
  {
    target: '[data-tour="ei-rule-card"]',
    title: 'One Rule Group Per Category',
    content:
      'Each active category gets its own rule group. Disable the category and its rules are removed automatically. Re-enable to start adding rules again.',
    placement: 'top',
  },
  {
    target: '[data-tour="ei-add-rule"]',
    title: 'Add a Rule',
    content:
      'Click to append a new rule to this category. Stack as many as you need — each new rule appears below the previous one.',
    placement: 'left',
  },
  {
    target: '[data-tour="ei-rule-type"]',
    title: 'Rule Type',
    content:
      'Pick what to match on: Sender (a specific address), Domain (everyone from a company), or Keyword (text in the subject or body).',
    placement: 'bottom',
  },
  {
    target: '[data-tour="ei-rule-value"]',
    title: 'Rule Value',
    content:
      'Enter the value to match — e.g. john@example.com, example.com, or "invoice". Open Advanced Options below to combine with Recipient, Subject, and Body filters using AND/OR.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="ei-rule-toggle"]',
    title: 'Enable / Disable Rule',
    content:
      'Turn an individual rule off without deleting it. Useful for testing or pausing a rule temporarily.',
    placement: 'left',
  },
  {
    target: '[data-tour="ei-rule-sync"]',
    title: 'Sync Rule',
    content:
      'Red pulse = unsaved changes. Amber = never run. Green = synced. Click to push this rule to your mailbox and reprocess matching emails.',
    placement: 'left',
  },
  {
    target: '[data-tour="ei-rule-advanced"]',
    title: 'Advanced Options',
    content:
      'Expand to add Recipient, Subject contains, and Body contains conditions joined with AND/OR — for precise multi-condition matching.',
    placement: 'right',
  },
  {
    target: '[data-tour="ei-rule-delete"]',
    title: 'Delete Rule',
    content:
      'Permanently removes this rule. The category stays — only this specific rule is removed and unsynced from your mailbox.',
    placement: 'left',
  },
  {
    target: '[data-tour="ei-sync"]',
    title: 'Real-Time Sync',
    content:
      'InboxIQ continuously watches incoming mail and applies your categories, drafts, and replies in near real-time. Hit "Re-sync All" if you ever want to reprocess past emails.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="ei-header"]',
    title: "You're Ready 🎉",
    content: (
      <div>
        <p>✅ Categories organize emails</p>
        <p>✅ Rules route them automatically</p>
        <p>✅ AI Draft prepares responses</p>
        <p>✅ Auto-Reply sends them automatically</p>
        <p>✅ Tone customizes the writing style</p>
        <p style={{ marginTop: 8, fontStyle: 'italic' }}>
          Hit "Guide me through this page" anytime to replay.
        </p>
      </div>
    ),
    placement: 'center',
  },
];

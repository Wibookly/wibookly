import type { Step } from 'react-joyride';

export const settingsTour: Step[] = [
  {
    target: 'body',
    title: 'Profile & Signature — your identity in InboxIQ',
    content:
      "Everything on this page powers how InboxIQ sounds and looks as you: AI email drafts, the Daily Brief, meeting notes, and follow-up reminders all pull from these fields. Take a minute here and every AI output gets noticeably more 'you'.",
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: 'body',
    title: 'Profile photo',
    content:
      "Upload a square headshot (PNG/JPG, ideally 256×256+). It is shown in your AI-generated email signatures and across InboxIQ. If both a photo and a company logo exist, the photo wins for Personal accounts and the logo wins for Business accounts.",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Name, title, company',
    content:
      "Full name and email are required. For Business mode, Job Title is also required so signatures stay professional (e.g. 'Ali Rahimi — Director of Engineering, Energy Forward'). InboxIQ uses these in AI drafts: closing lines, introductions, and meeting notes.",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Email signature',
    content:
      "Your stylized HTML signature is appended to every AI-generated draft and reply. Edit text, colors, and links once here. The live preview shows how it will look in Outlook/Gmail. Personal mode = casual signature; Business mode = full corporate block with title, company, logo.",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Personal vs Business mode',
    content:
      "Switch the toggle to flip between the two layouts. Personal is friendlier and shorter — good for personal Gmail. Business is fuller — good for client-facing work. Each connected mailbox can have its own mode (e.g. Personal for Gmail, Business for Microsoft 365).",
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Save & sync',
    content:
      "Changes save instantly to your profile and apply to all future AI drafts, daily briefs, and reply suggestions. There is no separate publish step.",
    placement: 'center',
  },
];


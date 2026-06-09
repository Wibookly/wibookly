import type { Step } from 'react-joyride';

export const settingsTour: Step[] = [
  {
    target: 'body',
    title: 'Profile & Signature',
    content:
      'This is where your identity lives. Your name, title, photo, and signature are used by AI drafts, daily briefs, and meeting notes — so everything sounds like you.',
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: 'body',
    title: 'Profile photo',
    content:
      'Upload a headshot. It appears in your AI-generated email signatures and across InboxIQ. Photo takes priority over company logo in signatures.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Name, title, company',
    content:
      'Fill in your full name, job title, and company. AI drafts will sign with these. For Business mode the title field is required so signatures stay professional.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Email signature',
    content:
      'Your stylized HTML signature is added to every AI-generated draft. Edit the text, colors, and links once — InboxIQ reuses it everywhere.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Personal vs Business',
    content:
      'Personal accounts get a casual signature. Business accounts get a full corporate signature with title, company, and logo. Switch the mode to see the preview.',
    placement: 'center',
  },
  {
    target: 'body',
    title: 'Save & sync',
    content:
      'Changes save instantly and apply to all future drafts, briefs, and replies. Hit "Guide me through this page" anytime to replay this tour.',
    placement: 'center',
  },
];

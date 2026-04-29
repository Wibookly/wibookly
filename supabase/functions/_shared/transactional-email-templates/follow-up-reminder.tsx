/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'InboxIQ'

interface FollowUpReminderProps {
  tracker_subject?: string
  bcc_alias?: string
  reminder_number?: number
  max_reminders?: number
}

const FollowUpReminderEmail = ({
  tracker_subject,
  bcc_alias,
  reminder_number,
  max_reminders,
}: FollowUpReminderProps) => {
  const subj = tracker_subject || '(no subject)'
  const n = reminder_number ?? 1
  const max = max_reminders ?? 3

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Reminder {n} of {max} — follow up on "{subj}"</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Follow-up still pending</Heading>
          <Text style={text}>
            This is reminder <strong>{n} of {max}</strong> from {SITE_NAME} —
            you have a follow-up that's still waiting for your attention.
          </Text>

          <Section style={card}>
            <Text style={cardLabel}>Original email</Text>
            <Text style={cardSubject}>{subj}</Text>
            {bcc_alias ? (
              <Text style={cardMeta}>BCC trigger: {bcc_alias}</Text>
            ) : null}
          </Section>

          <Text style={text}>
            Open your <strong>No-Reply-Tracker</strong> folder in Outlook (or the
            No Reply Tracker category in {SITE_NAME}) to review the AI-prepared draft
            and send it.
          </Text>

          {n >= max ? (
            <Text style={footerWarn}>
              This is your final reminder for this thread.
            </Text>
          ) : (
            <Text style={footer}>
              You'll receive {max - n} more reminder{max - n === 1 ? '' : 's'} if
              no action is taken.
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: FollowUpReminderEmail,
  subject: (data: Record<string, any>) =>
    `Reminder: follow up on "${data?.tracker_subject ?? 'your email'}"`,
  displayName: 'Follow-up reminder',
  previewData: {
    tracker_subject: 'Q2 budget review',
    bcc_alias: '3@energyforward.com',
    reminder_number: 1,
    max_reminders: 3,
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = {
  fontSize: '22px',
  fontWeight: '600',
  color: '#14365C',
  letterSpacing: '-0.01em',
  margin: '0 0 20px',
}
const text = {
  fontSize: '15px',
  color: '#5C7185',
  lineHeight: '1.6',
  margin: '0 0 16px',
}
const card = {
  backgroundColor: '#F1F5F9',
  borderRadius: '10px',
  padding: '16px 18px',
  margin: '20px 0',
  borderLeft: '4px solid #0FA8DC',
}
const cardLabel = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: '#94A3B8',
  margin: '0 0 6px',
  fontWeight: '600',
}
const cardSubject = {
  fontSize: '15px',
  color: '#14365C',
  fontWeight: '600',
  margin: '0 0 4px',
}
const cardMeta = {
  fontSize: '12px',
  color: '#64748B',
  margin: '4px 0 0',
}
const footer = {
  fontSize: '12px',
  color: '#94A3B8',
  margin: '28px 0 0',
  borderTop: '1px solid #E2E8F0',
  paddingTop: '14px',
}
const footerWarn = {
  fontSize: '12px',
  color: '#B45309',
  margin: '28px 0 0',
  borderTop: '1px solid #FCD34D',
  paddingTop: '14px',
  fontWeight: '600',
}

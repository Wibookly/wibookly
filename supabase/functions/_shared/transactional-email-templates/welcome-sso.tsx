/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
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

interface WelcomeSsoProps {
  fullName?: string
  invitationUrl?: string
  organizationName?: string
}

const WelcomeSsoEmail = ({
  fullName,
  invitationUrl,
  organizationName,
}: WelcomeSsoProps) => {
  const orgLine = organizationName
    ? `Your administrator at ${organizationName} has set you up with an InboxIQ account.`
    : 'Your administrator has set you up with an InboxIQ account.'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Welcome to {SITE_NAME} — connect your Outlook in one click</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome to {SITE_NAME}!</Heading>
          <Text style={text}>{orgLine}</Text>
          <Text style={text}>
            InboxIQ uses AI to triage your inbox, draft replies, and surface what
            matters most. To get started, just sign in with your Microsoft 365
            account — no new password needed.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={invitationUrl || '#'}>
              Sign in with Microsoft
            </Button>
          </Section>
          <Text style={textSmall}>
            When you click the button above, you'll sign in with your existing
            Microsoft 365 password. We'll automatically connect your Outlook
            inbox and calendar so you're ready to go.
          </Text>
          <Text style={footer}>
            If you weren't expecting this invitation, you can safely ignore this
            email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeSsoEmail,
  subject: (data: Record<string, any>) =>
    `Welcome to ${SITE_NAME}${data.fullName ? `, ${String(data.fullName).split(' ')[0]}` : ''} — sign in with Microsoft`,
  displayName: 'Welcome (SSO magic link)',
  previewData: {
    fullName: 'Jane Doe',
    invitationUrl: 'https://inboxiq.energyforward.com/invite?token=preview',
    organizationName: 'Acme Corp',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = {
  fontSize: '24px',
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
const textSmall = {
  fontSize: '13px',
  color: '#5C7185',
  lineHeight: '1.6',
  margin: '24px 0 0',
}
const buttonSection = { margin: '28px 0', textAlign: 'center' as const }
const button = {
  backgroundColor: '#0FA8DC',
  color: '#ffffff',
  borderRadius: '12px',
  padding: '14px 28px',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = {
  fontSize: '12px',
  color: '#94A3B8',
  margin: '32px 0 0',
  borderTop: '1px solid #E2E8F0',
  paddingTop: '16px',
}

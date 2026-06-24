/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'InboxIQ'
const SITE_URL = 'https://inboxiq.energyforward.com'

interface WelcomeSsoProps {
  fullName?: string
  invitationUrl?: string
  organizationName?: string
  organizationLogoUrl?: string
}

const features: Array<{ title: string; body: string }> = [
  {
    title: 'AI inbox triage',
    body: 'Auto-categorizes incoming mail into clear labels so the important stuff surfaces first.',
  },
  {
    title: 'AI draft replies',
    body: 'Generates ready-to-send replies in your voice. You review every draft — nothing sends automatically.',
  },
  {
    title: 'Daily Brief',
    body: 'A short morning summary of what needs your attention: action items, follow-ups, and calendar.',
  },
  {
    title: 'Follow-up tracker',
    body: 'Watches threads you sent and reminds you when someone has not replied.',
  },
  {
    title: 'Meeting Copilot',
    body: 'Live notes, action items, and a clean recap from your Teams or in-person meetings.',
  },
  {
    title: 'AI Chat & Knowledge',
    body: 'Ask questions about your email, calendar, and company knowledge in plain language.',
  },
]

const quickSteps: string[] = [
  'Click the activation button below and sign in with your Microsoft 365 account.',
  'Approve the Microsoft permissions so InboxIQ can read your mailbox securely.',
  'Open the in-app Quick Guide that appears on first login for a 60-second tour.',
  'Check your Daily Brief — it is ready as soon as your inbox finishes syncing.',
]

const WelcomeSsoEmail = ({
  fullName,
  invitationUrl,
  organizationName,
  organizationLogoUrl,
}: WelcomeSsoProps) => {
  const firstName = fullName ? fullName.split(' ')[0] : null
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,'
  const orgName = (organizationName || '').trim()
  const orgLine = orgName
    ? `Your team at ${orgName} has set up an ${SITE_NAME} account for you.`
    : `Your administrator has set up an ${SITE_NAME} account for you.`
  const activationHref = invitationUrl || SITE_URL
  // Quick-guide deep link — opens the in-app guided tour on first login.
  const guideHref = `${SITE_URL}/?tour=welcome`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Welcome to {SITE_NAME} — your AI inbox assistant for {orgName || 'your team'}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Brand header */}
          <Section style={brandHeader}>
            <Text style={brandWordmark}>
              <span style={{ color: '#0B2A6B' }}>Inbox</span>
              <span style={{ color: '#2B6EE3' }}>IQ</span>
            </Text>
            {organizationLogoUrl ? (
              <Img
                src={organizationLogoUrl}
                alt={orgName || 'Company logo'}
                style={orgLogoImg}
              />
            ) : null}
          </Section>

          <Hr style={hr} />

          {/* Hero */}
          <Heading style={h1}>Welcome to {SITE_NAME}</Heading>
          <Text style={lead}>
            The AI assistant for your Microsoft 365 mailbox — built for {orgName || 'your organization'}.
          </Text>

          <Text style={text}>{greeting}</Text>
          <Text style={text}>{orgLine}</Text>
          <Text style={text}>
            This is a legitimate account provisioned by your IT administrator —
            not a marketing email. {SITE_NAME} is the internal AI assistant your
            organization uses to help manage email, drafts, follow-ups, and meetings.
          </Text>

          {/* Primary CTA */}
          <Section style={buttonSection}>
            <Button style={button} href={activationHref}>
              Activate my account
            </Button>
            <Text style={buttonHint}>
              Sign in with your existing Microsoft 365 credentials — no new password needed.
            </Text>
          </Section>

          <Hr style={hr} />

          {/* What InboxIQ does */}
          <Heading as="h2" style={h2}>
            What you can do with {SITE_NAME}
          </Heading>
          <Text style={text}>
            Your administrator decides which features are enabled for you. Here is
            what {SITE_NAME} can do once you sign in:
          </Text>

          {features.map((f) => (
            <Section key={f.title} style={featureRow}>
              <Text style={featureTitle}>• {f.title}</Text>
              <Text style={featureBody}>{f.body}</Text>
            </Section>
          ))}

          <Hr style={hr} />

          {/* Quick guide */}
          <Heading as="h2" style={h2}>
            Quick start guide
          </Heading>
          {quickSteps.map((step, i) => (
            <Text key={i} style={stepText}>
              <span style={stepNumber}>{i + 1}.</span> {step}
            </Text>
          ))}

          <Section style={buttonSection}>
            <Button style={button} href={activationHref}>
              Activate &amp; start the tour
            </Button>
            <Text style={buttonHint}>
              Prefer to bookmark it first?{' '}
              <Link href={guideHref} style={link}>
                Open the quick guide
              </Link>
              .
            </Text>
          </Section>

          <Hr style={hr} />

          {/* Trust footer */}
          <Text style={footer}>
            {SITE_NAME} reads your mailbox securely through Microsoft 365 with the
            permissions your IT team approved. AI drafts always wait for your
            review — nothing is sent on your behalf without your click.
          </Text>
          <Text style={footerSmall}>
            If you weren't expecting this email or you do not work at{' '}
            {orgName || 'this organization'}, you can safely ignore it — the
            invitation will simply expire.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeSsoEmail,
  subject: () => `Welcome to ${SITE_NAME} — activate your account`,
  displayName: 'Welcome (SSO magic link)',
  previewData: {
    fullName: 'Jane Doe',
    invitationUrl: 'https://inboxiq.energyforward.com/auth/accept-invitation?token=preview',
    organizationName: 'EnergyForward',
    organizationLogoUrl: '',
  },
} satisfies TemplateEntry

// ---------- styles ----------
const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}
const container = { padding: '32px 28px', maxWidth: '600px' }
const brandHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  margin: '0 0 8px',
}
const brandWordmark = {
  fontSize: '24px',
  fontWeight: '700',
  letterSpacing: '-0.02em',
  margin: 0,
  lineHeight: '1',
}
const orgLogoImg = {
  maxHeight: '32px',
  width: 'auto',
  display: 'block',
}
const hr = {
  borderColor: '#E2E8F0',
  margin: '20px 0',
}
const h1 = {
  fontSize: '26px',
  fontWeight: '700',
  color: '#14365C',
  letterSpacing: '-0.01em',
  margin: '8px 0 8px',
}
const h2 = {
  fontSize: '18px',
  fontWeight: '700',
  color: '#14365C',
  letterSpacing: '-0.01em',
  margin: '4px 0 12px',
}
const lead = {
  fontSize: '16px',
  color: '#334155',
  lineHeight: '1.5',
  margin: '0 0 20px',
}
const text = {
  fontSize: '15px',
  color: '#475569',
  lineHeight: '1.6',
  margin: '0 0 14px',
}
const buttonSection = { margin: '24px 0', textAlign: 'center' as const }
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
const buttonHint = {
  fontSize: '13px',
  color: '#64748B',
  margin: '12px 0 0',
}
const link = {
  color: '#0FA8DC',
  textDecoration: 'underline',
}
const featureRow = { margin: '0 0 12px' }
const featureTitle = {
  fontSize: '15px',
  fontWeight: '600',
  color: '#14365C',
  margin: '0 0 2px',
}
const featureBody = {
  fontSize: '14px',
  color: '#5C7185',
  lineHeight: '1.55',
  margin: '0 0 0 14px',
}
const stepText = {
  fontSize: '14px',
  color: '#475569',
  lineHeight: '1.6',
  margin: '0 0 8px',
}
const stepNumber = {
  fontWeight: '700',
  color: '#0FA8DC',
  marginRight: '6px',
}
const footer = {
  fontSize: '13px',
  color: '#5C7185',
  lineHeight: '1.55',
  margin: '0 0 10px',
}
const footerSmall = {
  fontSize: '12px',
  color: '#94A3B8',
  lineHeight: '1.5',
  margin: '8px 0 0',
}

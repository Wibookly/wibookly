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
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'InboxIQ'
const APP_URL = 'https://inboxiq.energyforward.com'

interface WelcomeAccessGrantedProps {
  fullName?: string
  organizationName?: string
  loginUrl?: string
  guideUrl?: string
}

const Feature = ({
  emoji,
  title,
  body,
}: {
  emoji: string
  title: string
  body: string
}) => (
  <Section style={featureRow}>
    <Text style={featureEmoji}>{emoji}</Text>
    <Text style={featureTitle}>{title}</Text>
    <Text style={featureBody}>{body}</Text>
  </Section>
)

const WelcomeAccessGrantedEmail = ({
  fullName,
  organizationName,
  loginUrl,
  guideUrl,
}: WelcomeAccessGrantedProps) => {
  const firstName = fullName ? fullName.split(' ')[0] : null
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,'
  const orgLine = organizationName
    ? `Your team at ${organizationName} just turned on your ${SITE_NAME} access.`
    : `Your administrator just turned on your ${SITE_NAME} access.`

  const signInHref = loginUrl || `${APP_URL}/?welcome=1`
  const guideHref = guideUrl || `${APP_URL}/?welcome=1`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your {SITE_NAME} account is ready — here is everything you can do.
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Brand header */}
          <Section style={hero}>
            <Text style={brandMark}>InboxIQ</Text>
            <Heading style={h1}>You're in. Welcome to {SITE_NAME}.</Heading>
            <Text style={heroSub}>
              The AI inbox copilot for Microsoft 365 — built for busy teams.
            </Text>
          </Section>

          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            {orgLine} Sign in once with your Microsoft 365 account and {SITE_NAME}
            will start sorting, drafting, and following up on email for you — all
            inside the inbox you already use.
          </Text>

          {/* Primary CTA */}
          <Section style={buttonSection}>
            <Button style={primaryButton} href={signInHref}>
              Sign in & start the guided tour
            </Button>
            <Text style={ctaHint}>
              We'll open the welcome guide automatically the first time you land
              in {SITE_NAME}.
            </Text>
          </Section>

          <Hr style={hr} />

          {/* What you can do */}
          <Heading as="h2" style={h2}>
            What you can do on day one
          </Heading>

          <Feature
            emoji="📥"
            title="AI inbox triage"
            body="Every new email is read, categorized into your own color-coded labels, and routed to the right folder — automatically, the moment it arrives."
          />
          <Feature
            emoji="✍️"
            title="AI Drafts in your voice"
            body="For categories you choose, a polished reply is waiting in your Outlook Drafts within ~2 minutes — written in your tone, with your signature. Nothing is ever sent until you click Send."
          />
          <Feature
            emoji="🔔"
            title="No Reply Tracker"
            body="BCC a numeric address (e.g. 3@yourdomain.com) and InboxIQ watches the thread. If nobody replies, it nudges them for you during your business hours."
          />
          <Feature
            emoji="📅"
            title="Daily Brief"
            body="An executive-style morning summary of your inbox, meetings, and what needs your attention today — delivered to your mailbox on the schedule you choose."
          />
          <Feature
            emoji="🎙️"
            title="Meeting Copilot"
            body="Prep, transcribe and summarize every meeting — capture decisions, action items, and follow-up drafts without taking notes."
          />
          <Feature
            emoji="💬"
            title="AI Chat for your inbox"
            body="Ask questions about your email in plain English — search threads, draft replies, pull data from attachments, and search the web, all in one chat."
          />

          <Hr style={hr} />

          {/* Quick start */}
          <Heading as="h2" style={h2}>
            Your 3-minute quick start
          </Heading>
          <Section style={steps}>
            <Text style={stepRow}>
              <span style={stepNum}>1</span>
              <strong>Sign in</strong> with the same Microsoft 365 account your
              admin invited.
            </Text>
            <Text style={stepRow}>
              <span style={stepNum}>2</span>
              <strong>Open the Welcome Guide</strong> — it appears on your first
              visit and walks through every feature.
            </Text>
            <Text style={stepRow}>
              <span style={stepNum}>3</span>
              <strong>Turn on AI Drafts</strong> for the email categories you
              want help with — drafts start landing in Outlook within minutes.
            </Text>
          </Section>

          {/* Secondary CTA */}
          <Section style={buttonSection}>
            <Button style={secondaryButton} href={guideHref}>
              Open the user guide
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={reassure}>
            <strong>You stay in control.</strong> {SITE_NAME} never sends email
            without your permission unless you explicitly turn on Auto Reply for
            a specific category. Disconnecting takes one click in Integrations.
          </Text>

          <Text style={footer}>
            Need help? Just reply to this email or use the help icon inside{' '}
            {SITE_NAME}. We're glad you're here. 👋
            <br />
            <span style={footerMuted}>
              — The {SITE_NAME} team
            </span>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeAccessGrantedEmail,
  subject: (data: Record<string, any>) =>
    data?.fullName
      ? `${data.fullName.split(' ')[0]}, your InboxIQ account is ready 🎉`
      : `Your InboxIQ account is ready 🎉`,
  displayName: 'Welcome — access granted (full feature tour)',
  previewData: {
    fullName: 'Jane Doe',
    organizationName: 'Acme Corp',
    loginUrl: 'https://inboxiq.energyforward.com/?welcome=1',
    guideUrl: 'https://inboxiq.energyforward.com/?welcome=1',
  },
} satisfies TemplateEntry

/* ---------- styles ---------- */

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: 0,
}
const container = {
  padding: '40px 28px 32px',
  maxWidth: '600px',
  margin: '0 auto',
}
const hero = {
  background: 'linear-gradient(135deg, #0FA8DC 0%, #14365C 100%)',
  borderRadius: '18px',
  padding: '36px 28px',
  margin: '0 0 28px',
  textAlign: 'left' as const,
}
const brandMark = {
  color: 'rgba(255,255,255,0.85)',
  fontSize: '12px',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  margin: '0 0 12px',
  fontWeight: '600',
}
const h1 = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: '700',
  lineHeight: '1.2',
  letterSpacing: '-0.01em',
  margin: '0 0 10px',
}
const heroSub = {
  color: 'rgba(255,255,255,0.92)',
  fontSize: '15px',
  lineHeight: '1.5',
  margin: 0,
}
const h2 = {
  fontSize: '18px',
  fontWeight: '700',
  color: '#14365C',
  margin: '8px 0 16px',
  letterSpacing: '-0.01em',
}
const text = {
  fontSize: '15px',
  color: '#475569',
  lineHeight: '1.65',
  margin: '0 0 14px',
}
const buttonSection = { margin: '24px 0 8px', textAlign: 'center' as const }
const primaryButton = {
  backgroundColor: '#0FA8DC',
  color: '#ffffff',
  borderRadius: '12px',
  padding: '14px 28px',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  display: 'inline-block',
  boxShadow: '0 6px 16px -6px rgba(15, 168, 220, 0.55)',
}
const secondaryButton = {
  backgroundColor: '#ffffff',
  color: '#14365C',
  border: '1.5px solid #14365C',
  borderRadius: '12px',
  padding: '12px 24px',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
  display: 'inline-block',
}
const ctaHint = {
  fontSize: '12px',
  color: '#94A3B8',
  margin: '10px 0 0',
}
const hr = {
  border: 'none',
  borderTop: '1px solid #E2E8F0',
  margin: '28px 0',
}
const featureRow = {
  margin: '0 0 18px',
  paddingLeft: '40px',
  position: 'relative' as const,
}
const featureEmoji = {
  position: 'absolute' as const,
  left: 0,
  top: 0,
  fontSize: '22px',
  lineHeight: 1,
  margin: 0,
}
const featureTitle = {
  fontSize: '15px',
  fontWeight: '600',
  color: '#14365C',
  margin: '0 0 4px',
}
const featureBody = {
  fontSize: '14px',
  color: '#5C7185',
  lineHeight: '1.55',
  margin: 0,
}
const steps = { margin: '4px 0 12px' }
const stepRow = {
  fontSize: '14px',
  color: '#475569',
  lineHeight: '1.6',
  margin: '0 0 12px',
  paddingLeft: '36px',
  position: 'relative' as const,
}
const stepNum = {
  position: 'absolute' as const,
  left: 0,
  top: '1px',
  width: '24px',
  height: '24px',
  borderRadius: '999px',
  backgroundColor: '#0FA8DC',
  color: '#ffffff',
  fontSize: '12px',
  fontWeight: '700',
  textAlign: 'center' as const,
  lineHeight: '24px',
  display: 'inline-block',
}
const reassure = {
  fontSize: '13px',
  color: '#475569',
  lineHeight: '1.6',
  backgroundColor: '#F1F5F9',
  borderRadius: '10px',
  padding: '14px 16px',
  margin: '0 0 24px',
}
const footer = {
  fontSize: '13px',
  color: '#64748B',
  margin: '24px 0 0',
  lineHeight: '1.6',
}
const footerMuted = {
  fontSize: '12px',
  color: '#94A3B8',
}

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
  /** Feature keys this user is actually allowed to use. */
  enabledFeatures?: string[]
}

type FeatureDef = {
  key: string
  emoji: string
  accent: string
  title: string
  body: string
}

// Master catalog. We only render the ones the user actually has access to.
const ALL_FEATURES: FeatureDef[] = [
  {
    key: 'ai_draft',
    emoji: '✍️',
    accent: '#0FA8DC',
    title: 'AI Drafts in your voice',
    body:
      'For the email categories you choose, a polished reply is waiting in your Outlook Drafts within a couple of minutes — written in your tone, with your signature. Nothing is ever sent until you click Send.',
  },
  {
    key: 'ai_auto_reply',
    emoji: '⚡',
    accent: '#7C3AED',
    title: 'Auto Reply (opt-in)',
    body:
      'For low-risk categories you explicitly turn on, InboxIQ can send the reply for you automatically — perfect for confirmations, FYIs, and routine acknowledgements.',
  },
  {
    key: 'ai_assistant',
    emoji: '💬',
    accent: '#0EA5E9',
    title: 'AI Chat for your inbox',
    body:
      'Ask questions about your email in plain English — search threads, pull data from attachments, draft replies, and search the web, all in one chat.',
  },
  {
    key: 'daily_brief',
    emoji: '📅',
    accent: '#F59E0B',
    title: 'Daily Brief',
    body:
      'An executive-style morning summary of your inbox, meetings, and what needs your attention today — delivered on the schedule you choose.',
  },
  {
    key: 'reports',
    emoji: '📊',
    accent: '#14365C',
    title: 'Reports & Analytics',
    body:
      'See how much time AI is saving you, which categories are busiest, and where threads are going cold — with the No-Reply Tracker watching for silent conversations.',
  },
  {
    key: 'feature.follow_up_reminder',
    emoji: '🔔',
    accent: '#10B981',
    title: 'No-Reply Tracker',
    body:
      'BCC a numeric address (e.g. 3@yourdomain.com) and InboxIQ watches the thread. If nobody replies in the window you set, it nudges them for you during your business hours.',
  },
  {
    key: 'email_agent',
    emoji: '🤖',
    accent: '#DB2777',
    title: 'Email Agent',
    body:
      'A background agent that reads incoming mail, applies your rules, gathers context from past threads, and prepares the right next action — drafts, calendar holds, or escalations.',
  },
  {
    key: 'teams_agent',
    emoji: '👥',
    accent: '#6366F1',
    title: 'Teams Agent',
    body:
      'Chat with InboxIQ directly inside Microsoft Teams — ask about your inbox, kick off drafts, and get briefed without leaving the conversation.',
  },
]

// Always-on capabilities that every licensed user gets, regardless of feature gates.
const CORE_CAPABILITIES: FeatureDef[] = [
  {
    key: '_core_triage',
    emoji: '📥',
    accent: '#0FA8DC',
    title: 'AI inbox triage',
    body:
      'Every new email is read, categorized into your own color-coded labels, and routed to the right folder — automatically, the moment it arrives in Outlook.',
  },
  {
    key: '_core_control',
    emoji: '🛡️',
    accent: '#14365C',
    title: 'You stay in control',
    body:
      'InboxIQ never sends mail on your behalf unless you turn on Auto Reply for a specific category. You can pause, edit categories, or disconnect in one click.',
  },
]

const FeatureCard = ({ def }: { def: FeatureDef }) => (
  <Section
    style={{
      ...featureCard,
      borderLeft: `4px solid ${def.accent}`,
    }}
  >
    <Text style={{ ...featureEmoji, color: def.accent }}>{def.emoji}</Text>
    <Text style={{ ...featureTitle, color: def.accent }}>{def.title}</Text>
    <Text style={featureBody}>{def.body}</Text>
  </Section>
)

const WelcomeAccessGrantedEmail = ({
  fullName,
  organizationName,
  loginUrl,
  enabledFeatures,
}: WelcomeAccessGrantedProps) => {
  const firstName = fullName ? fullName.split(' ')[0] : null
  const greeting = firstName ? `Hi ${firstName} 👋` : 'Hello 👋'
  const orgLine = organizationName
    ? `Your team at ${organizationName} has just activated your ${SITE_NAME} workspace.`
    : `Your administrator has just activated your ${SITE_NAME} workspace.`

  const signInHref = loginUrl || `${APP_URL}/?welcome=1`

  // Only show features this user actually has access to. If none are passed in,
  // fall back to showing all — better than an empty section.
  const allowed = Array.isArray(enabledFeatures) ? enabledFeatures : null
  const userFeatures = allowed
    ? ALL_FEATURES.filter((f) => allowed.includes(f.key))
    : ALL_FEATURES

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Welcome to {SITE_NAME} — your AI inbox copilot is ready to activate.
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Brand hero */}
          <Section style={hero}>
            <Text style={brandMark}>InboxIQ</Text>
            <Heading style={h1}>Welcome aboard, {firstName || 'friend'}.</Heading>
            <Text style={heroSub}>
              Your AI copilot for Microsoft 365 — designed to give you back
              hours every week, right inside the inbox you already use.
            </Text>
          </Section>

          <Text style={lead}>{greeting}</Text>
          <Text style={text}>
            {orgLine} {SITE_NAME} is the intelligent layer that sits on top of
            your Microsoft 365 mailbox and calendar. We've been authorized by
            your organization to securely connect to the workspace apps below
            so we can read, organize, draft, and follow up on your behalf —
            always under your control.
          </Text>

          {/* Authorization callout */}
          <Section style={authCallout}>
            <Text style={authTitle}>🔐 What we've been authorized to do</Text>
            <Text style={authBody}>
              Your administrator has granted {SITE_NAME} secure access to your
              Microsoft 365 <strong>Outlook mail</strong>,{' '}
              <strong>calendar</strong>, and <strong>contacts</strong> so our
              AI can triage email, prepare drafts in your voice, schedule
              meetings, and surface a daily executive brief. All access is
              token-based, fully revocable, and scoped to the features your
              organization has turned on for your role.
            </Text>
          </Section>

          {/* Primary CTA — single action: activate */}
          <Section style={buttonSection}>
            <Button style={primaryButton} href={signInHref}>
              Activate my account
            </Button>
            <Text style={ctaHint}>
              The Quick Start Guide opens automatically the first time you
              land in {SITE_NAME} — no extra clicks needed.
            </Text>
          </Section>

          <Hr style={hr} />

          {/* Core capabilities — always on */}
          <Heading as="h2" style={h2}>
            What {SITE_NAME} does for you
          </Heading>
          <Text style={sectionLead}>
            Every licensed user gets these foundational capabilities:
          </Text>
          {CORE_CAPABILITIES.map((f) => (
            <FeatureCard key={f.key} def={f} />
          ))}

          {/* Role-specific features */}
          {userFeatures.length > 0 && (
            <>
              <Hr style={hr} />
              <Heading as="h2" style={h2}>
                Tools unlocked for your role
              </Heading>
              <Text style={sectionLead}>
                Based on the role and permissions your administrator assigned
                to you, the following {SITE_NAME} tools are ready to use:
              </Text>
              {userFeatures.map((f) => (
                <FeatureCard key={f.key} def={f} />
              ))}
            </>
          )}

          <Hr style={hr} />

          {/* Quick start */}
          <Heading as="h2" style={h2}>
            Your 3-minute quick start
          </Heading>
          <Section style={steps}>
            <Text style={stepRow}>
              <span style={stepNum}>1</span>
              <strong>Click "Activate my account"</strong> above and sign in
              with your Microsoft 365 account.
            </Text>
            <Text style={stepRow}>
              <span style={stepNum}>2</span>
              <strong>Follow the Quick Start Guide</strong> — it opens
              automatically and walks you through every tool available to you.
            </Text>
            <Text style={stepRow}>
              <span style={stepNum}>3</span>
              <strong>Pick the email categories</strong> you want AI help with
              — drafts start landing in your Outlook within minutes.
            </Text>
          </Section>

          <Hr style={hr} />

          <Text style={reassure}>
            <strong>Privacy & control.</strong> {SITE_NAME} never sends email
            without your permission unless you explicitly turn on Auto Reply
            for a specific category. You can revoke access or disconnect at
            any time from the Integrations page.
          </Text>

          <Text style={footer}>
            Need help? Just reply to this email or use the in-app{' '}
            <strong>Guide me through this page</strong> pill — we're glad
            you're here.
            <br />
            <span style={footerMuted}>— The {SITE_NAME} team</span>
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
  displayName: 'Welcome — access granted (role-aware feature tour)',
  previewData: {
    fullName: 'Jane Doe',
    organizationName: 'Acme Corp',
    loginUrl: 'https://inboxiq.energyforward.com/?welcome=1',
    enabledFeatures: ['ai_draft', 'ai_assistant', 'daily_brief', 'reports'],
  },
} satisfies TemplateEntry

/* ---------- styles ---------- */

const main = {
  backgroundColor: '#F4F7FB',
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: '24px 0',
}
const container = {
  padding: '0 0 32px',
  maxWidth: '620px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '18px',
  overflow: 'hidden' as const,
  boxShadow: '0 18px 48px -24px rgba(20, 54, 92, 0.25)',
}
const hero = {
  background:
    'linear-gradient(135deg, #0FA8DC 0%, #1E5AA8 55%, #14365C 100%)',
  padding: '44px 32px 36px',
  margin: 0,
  textAlign: 'left' as const,
}
const brandMark = {
  color: 'rgba(255,255,255,0.85)',
  fontSize: '12px',
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  margin: '0 0 14px',
  fontWeight: '700',
}
const h1 = {
  color: '#ffffff',
  fontSize: '30px',
  fontWeight: '700',
  lineHeight: '1.2',
  letterSpacing: '-0.01em',
  margin: '0 0 12px',
}
const heroSub = {
  color: 'rgba(255,255,255,0.92)',
  fontSize: '15px',
  lineHeight: '1.55',
  margin: 0,
}
const h2 = {
  fontSize: '19px',
  fontWeight: '700',
  color: '#14365C',
  margin: '0 32px 8px',
  letterSpacing: '-0.01em',
}
const lead = {
  fontSize: '17px',
  color: '#14365C',
  fontWeight: '600',
  lineHeight: '1.5',
  margin: '28px 32px 10px',
}
const text = {
  fontSize: '15px',
  color: '#475569',
  lineHeight: '1.65',
  margin: '0 32px 14px',
}
const sectionLead = {
  fontSize: '14px',
  color: '#64748B',
  lineHeight: '1.55',
  margin: '0 32px 16px',
}
const authCallout = {
  margin: '8px 32px 8px',
  padding: '18px 20px',
  background: 'linear-gradient(135deg, #EFF8FD 0%, #F1F5F9 100%)',
  borderRadius: '14px',
  border: '1px solid #DCEBF4',
}
const authTitle = {
  fontSize: '14px',
  fontWeight: '700',
  color: '#0FA8DC',
  margin: '0 0 8px',
  letterSpacing: '0.01em',
}
const authBody = {
  fontSize: '14px',
  color: '#3F5469',
  lineHeight: '1.6',
  margin: 0,
}
const buttonSection = { margin: '24px 32px 8px', textAlign: 'center' as const }
const primaryButton = {
  background: 'linear-gradient(135deg, #0FA8DC 0%, #1E5AA8 100%)',
  color: '#ffffff',
  borderRadius: '14px',
  padding: '15px 32px',
  fontSize: '15px',
  fontWeight: '700',
  textDecoration: 'none',
  display: 'inline-block',
  boxShadow: '0 10px 24px -10px rgba(15, 168, 220, 0.65)',
}
const ctaHint = {
  fontSize: '12px',
  color: '#94A3B8',
  margin: '12px 0 0',
}
const hr = {
  border: 'none',
  borderTop: '1px solid #E2E8F0',
  margin: '28px 32px',
}
const featureCard = {
  margin: '0 32px 14px',
  padding: '14px 16px 14px 18px',
  backgroundColor: '#FBFCFE',
  borderRadius: '10px',
  border: '1px solid #EEF2F7',
}
const featureEmoji = {
  fontSize: '20px',
  lineHeight: 1,
  margin: '0 0 6px',
}
const featureTitle = {
  fontSize: '15px',
  fontWeight: '700',
  margin: '0 0 4px',
}
const featureBody = {
  fontSize: '14px',
  color: '#5C7185',
  lineHeight: '1.6',
  margin: 0,
}
const steps = { margin: '0 32px' }
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
  background: 'linear-gradient(135deg, #0FA8DC, #1E5AA8)',
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
  margin: '0 32px 24px',
}
const footer = {
  fontSize: '13px',
  color: '#64748B',
  margin: '12px 32px 0',
  lineHeight: '1.6',
}
const footerMuted = {
  fontSize: '12px',
  color: '#94A3B8',
}

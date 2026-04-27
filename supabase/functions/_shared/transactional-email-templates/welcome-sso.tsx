/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
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
  organizationLogoUrl?: string
}

const WelcomeSsoEmail = ({
  fullName,
  invitationUrl,
  organizationName,
  organizationLogoUrl,
}: WelcomeSsoProps) => {
  const greeting = fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi,'
  const orgLine = organizationName
    ? `Your team at ${organizationName} has set up an ${SITE_NAME} account for you.`
    : `Your administrator has set up an ${SITE_NAME} account for you.`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Activate your {SITE_NAME} account — sign in with Microsoft</Preview>
      <Body style={main}>
        <Container style={container}>
          {organizationLogoUrl ? (
            <Section style={logoSection}>
              <Img
                src={organizationLogoUrl}
                alt={organizationName || 'Company logo'}
                style={logoImg}
              />
            </Section>
          ) : null}

          <Heading style={h1}>Welcome to {SITE_NAME}</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>{orgLine}</Text>
          <Text style={text}>
            Click below to activate your account. You'll sign in with your existing
            Microsoft 365 credentials — no new password needed.
          </Text>

          <Section style={buttonSection}>
            <Button style={button} href={invitationUrl || '#'}>
              Activate my account
            </Button>
          </Section>

          <Text style={footer}>
            If you weren't expecting this invitation, you can safely ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeSsoEmail,
  subject: () => `Activate your ${SITE_NAME} account`,
  displayName: 'Welcome (SSO magic link)',
  previewData: {
    fullName: 'Jane Doe',
    invitationUrl: 'https://inboxiq.energyforward.com/invite?token=preview',
    organizationName: 'Acme Corp',
    organizationLogoUrl: '',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}
const container = { padding: '32px 28px', maxWidth: '560px' }
const logoSection = { margin: '0 0 24px', textAlign: 'left' as const }
const logoImg = {
  maxHeight: '40px',
  width: 'auto',
  display: 'block',
}
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

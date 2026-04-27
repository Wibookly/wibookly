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

interface WelcomeTempPasswordProps {
  fullName?: string
  email?: string
  tempPassword?: string
  loginUrl?: string
  organizationName?: string
  organizationLogoUrl?: string
}

const WelcomeTempPasswordEmail = ({
  fullName,
  email,
  tempPassword,
  loginUrl,
  organizationName,
  organizationLogoUrl,
}: WelcomeTempPasswordProps) => {
  const greeting = fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi,'
  const orgLine = organizationName
    ? `Your team at ${organizationName} has created an ${SITE_NAME} account for you.`
    : `Your administrator has created an ${SITE_NAME} account for you.`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your {SITE_NAME} account is ready</Preview>
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

          <Heading style={h1}>Your {SITE_NAME} account is ready</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>{orgLine}</Text>
          <Text style={text}>Use the credentials below to sign in:</Text>

          <Section style={credBox}>
            <Text style={credLabel}>Email</Text>
            <Text style={credValue}>{email || 'your email'}</Text>
            <Text style={credLabel}>Temporary password</Text>
            <Text style={credValueMono}>{tempPassword || '••••••••'}</Text>
          </Section>

          <Section style={buttonSection}>
            <Button style={button} href={loginUrl || '#'}>
              Sign in
            </Button>
          </Section>

          <Text style={text}>
            You'll be asked to set a new password on first sign-in.
          </Text>

          <Text style={footer}>
            If you weren't expecting this email, please contact your administrator.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeTempPasswordEmail,
  subject: `Your ${SITE_NAME} account is ready`,
  displayName: 'Welcome (temp password)',
  previewData: {
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    tempPassword: 'Temp-9X4k!q2P',
    loginUrl: 'https://inboxiq.energyforward.com/auth',
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
const credBox = {
  backgroundColor: '#F8FAFC',
  border: '1px solid #E2E8F0',
  borderRadius: '12px',
  padding: '20px 24px',
  margin: '20px 0',
}
const credLabel = {
  fontSize: '12px',
  color: '#94A3B8',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  margin: '0 0 4px',
  fontWeight: '600',
}
const credValue = {
  fontSize: '15px',
  color: '#14365C',
  margin: '0 0 16px',
  fontWeight: '500',
}
const credValueMono = {
  fontSize: '15px',
  color: '#14365C',
  margin: '0',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontWeight: '600',
  backgroundColor: '#ffffff',
  padding: '8px 12px',
  border: '1px dashed #CBD5E1',
  borderRadius: '6px',
  display: 'inline-block',
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

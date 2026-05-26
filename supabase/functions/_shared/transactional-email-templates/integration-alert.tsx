import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'InboxIQ'

interface IntegrationAlertProps {
  integrationKey?: string
  integrationName?: string
  status?: 'failed' | 'warning' | 'healthy'
  message?: string
  detectedAt?: string
}

const IntegrationAlertEmail = ({
  integrationKey = 'unknown',
  integrationName,
  status = 'failed',
  message = 'A service health probe reported a failure.',
  detectedAt,
}: IntegrationAlertProps) => {
  const label = integrationName || integrationKey
  const tone =
    status === 'failed' ? '#dc2626' : status === 'warning' ? '#d97706' : '#16a34a'
  const when = detectedAt ? new Date(detectedAt).toLocaleString() : new Date().toLocaleString()
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`[${SITE_NAME}] ${label} is ${status.toUpperCase()}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{SITE_NAME} integration alert</Heading>
          <Section style={{ ...badgeWrap, borderColor: tone }}>
            <Text style={{ ...badge, color: tone }}>{status.toUpperCase()}</Text>
          </Section>
          <Text style={text}>
            <strong>{label}</strong> ({integrationKey}) reported a problem.
          </Text>
          <Section style={box}>
            <Text style={kv}><strong>Status:</strong> {status}</Text>
            <Text style={kv}><strong>Message:</strong> {message}</Text>
            <Text style={kv}><strong>Detected:</strong> {when}</Text>
          </Section>
          <Text style={text}>
            Open the Admin → Integrations dashboard to investigate or rerun the probe.
          </Text>
          <Text style={footer}>— {SITE_NAME} monitoring</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: IntegrationAlertEmail,
  subject: (d: Record<string, any>) =>
    `[${SITE_NAME}] ${d?.integrationName || d?.integrationKey || 'Integration'} is ${(d?.status || 'failed').toString().toUpperCase()}`,
  displayName: 'Integration health alert',
  previewData: {
    integrationKey: 'openai',
    integrationName: 'OpenAI',
    status: 'failed',
    message: 'HTTP 401 — invalid API key',
    detectedAt: new Date().toISOString(),
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '20px', fontWeight: 'bold', color: '#111827', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#374151', lineHeight: '1.5', margin: '0 0 16px' }
const badgeWrap = { borderLeftWidth: '3px', borderLeftStyle: 'solid' as const, padding: '4px 12px', margin: '0 0 16px' }
const badge = { fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', margin: 0 }
const box = { backgroundColor: '#f9fafb', borderRadius: '6px', padding: '12px 16px', margin: '0 0 16px' }
const kv = { fontSize: '13px', color: '#374151', margin: '4px 0' }
const footer = { fontSize: '12px', color: '#9ca3af', margin: '24px 0 0' }

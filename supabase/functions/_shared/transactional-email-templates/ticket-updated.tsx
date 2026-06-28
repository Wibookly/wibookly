/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr, Link,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE = 'InboxIQ'

interface Props {
  subject?: string
  reply_excerpt?: string
  ticket_url?: string
  status?: string
}

const TicketUpdated = ({ subject = 'your ticket', reply_excerpt = '', ticket_url, status }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{SITE} support replied to your ticket: {subject}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Support replied to your ticket</Heading>
        <Text style={meta}>Ticket: <strong>{subject}</strong>{status ? ` · status: ${status}` : ''}</Text>
        <Hr style={hr} />
        <Section style={box}>
          <Text style={muted}>Latest reply from the support team:</Text>
          <Text style={excerpt}>{reply_excerpt || '(see the ticket in the app for the full message)'}</Text>
        </Section>
        {ticket_url && (
          <Section style={{ textAlign: 'center', marginTop: 18 }}>
            <Button href={ticket_url} style={btn}>Open ticket in {SITE}</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          You're getting this because someone on your team replied to your support ticket.
          Reply in the app to keep the conversation threaded.{' '}
          {ticket_url && <Link href={ticket_url} style={{ color: '#4f46e5' }}>View ticket</Link>}
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TicketUpdated,
  subject: ({ subject }: any) => `Support replied · ${subject || 'your ticket'}`,
  displayName: 'Ticket updated',
  previewData: { subject: 'Calendar sync issue', reply_excerpt: "We've identified the cause — pushing a fix today.", status: 'in_progress' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif', color: '#0f172a' }
const container = { padding: '24px 28px', maxWidth: '600px' }
const h1 = { fontSize: '20px', margin: '0 0 4px' }
const meta = { fontSize: '12px', color: '#64748b', margin: '0' }
const hr = { borderColor: '#e2e8f0', margin: '16px 0' }
const muted = { fontSize: '12px', color: '#64748b', margin: '0 0 6px' }
const box = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px' }
const excerpt = { fontSize: '14px', whiteSpace: 'pre-wrap' as const, color: '#0f172a', margin: 0 }
const btn = { background: '#4f46e5', color: '#ffffff', padding: '10px 18px', borderRadius: '8px', fontSize: '13px', textDecoration: 'none', display: 'inline-block' }
const footer = { fontSize: '11px', color: '#94a3b8', textAlign: 'center' as const }

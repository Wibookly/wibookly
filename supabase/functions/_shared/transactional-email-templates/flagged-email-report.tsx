/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE = 'InboxIQ'

interface Row {
  subject: string
  recipient_name: string
  recipient_address: string
  sent_at: string
  flag_due: string
  follow_up_due: string
  attempts: number
  status: string
  last_sent_at?: string | null
}
interface Props {
  range_label?: string
  generated_at?: string
  stats?: { total: number; pending: number; replied: number; followUpsSent: number; missed: number }
  rows?: Row[]
}

const fmt = (d?: string | null) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleString() } catch { return '—' }
}

const FlaggedEmailReport = ({ range_label, generated_at, stats, rows = [] }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{SITE} — Flagged Email Report ({range_label || 'all time'})</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Flagged Email Report</Heading>
        <Text style={meta}>
          Range: <strong>{range_label || 'all time'}</strong> · Generated {fmt(generated_at)}
        </Text>

        <Section style={statsWrap}>
          <Stat label="Flagged" value={stats?.total ?? 0} />
          <Stat label="Pending" value={stats?.pending ?? 0} />
          <Stat label="Replied" value={stats?.replied ?? 0} />
          <Stat label="Follow-ups sent" value={stats?.followUpsSent ?? 0} />
          <Stat label="Missed" value={stats?.missed ?? 0} />
        </Section>

        <Hr style={hr} />

        {rows.length === 0 ? (
          <Text style={text}>No flagged emails in this range.</Text>
        ) : (
          rows.map((r, i) => (
            <Section key={i} style={card}>
              <Text style={cardSubject}>{r.subject || '(no subject)'}</Text>
              <Text style={cardMeta}>
                To: <strong>{r.recipient_name || r.recipient_address}</strong>
                {r.recipient_name ? ` <${r.recipient_address}>` : ''}
              </Text>
              <Text style={cardMeta}>Sent: {fmt(r.sent_at)} · Flag due: {fmt(r.flag_due)}</Text>
              <Text style={cardMeta}>Follow-up due: {fmt(r.follow_up_due)} · Follow-ups: {r.attempts}/3</Text>
              <Text style={cardStatus}>Status: {r.status}{r.last_sent_at ? ` · last AI send ${fmt(r.last_sent_at)}` : ''}</Text>
            </Section>
          ))
        )}

        <Text style={footer}>Report sent by {SITE}. Manage in Flagged Email Reports.</Text>
      </Container>
    </Body>
  </Html>
)

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div style={statBox as React.CSSProperties}>
    <Text style={statValue}>{value}</Text>
    <Text style={statLabel}>{label}</Text>
  </div>
)

export const template = {
  component: FlaggedEmailReport,
  subject: (d: Record<string, any>) => `Flagged Email Report — ${d?.range_label || 'all time'}`,
  displayName: 'Flagged Email Report',
  previewData: {
    range_label: 'Last 7 days',
    generated_at: new Date().toISOString(),
    stats: { total: 4, pending: 2, replied: 1, followUpsSent: 3, missed: 1 },
    rows: [
      { subject: 'Q2 budget', recipient_name: 'Ali Rahimi', recipient_address: 'ali@example.com', sent_at: new Date().toISOString(), flag_due: new Date().toISOString(), follow_up_due: new Date().toISOString(), attempts: 1, status: 'pending' },
    ],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '640px' }
const h1 = { fontSize: '22px', fontWeight: '600', color: '#14365C', margin: '0 0 8px' }
const meta = { fontSize: '13px', color: '#64748B', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#5C7185', lineHeight: '1.6' }
const hr = { borderColor: '#E2E8F0', margin: '20px 0' }
const statsWrap = { display: 'flex', gap: '10px', flexWrap: 'wrap' as const, margin: '16px 0' }
const statBox = { background: '#F1F5F9', borderRadius: '8px', padding: '10px 14px', minWidth: '90px' }
const statValue = { fontSize: '20px', fontWeight: '600', color: '#14365C', margin: '0' }
const statLabel = { fontSize: '11px', color: '#64748B', margin: '4px 0 0', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }
const card = { background: '#F8FAFC', borderRadius: '10px', padding: '14px 16px', margin: '10px 0', borderLeft: '4px solid #0FA8DC' }
const cardSubject = { fontSize: '15px', fontWeight: '600', color: '#14365C', margin: '0 0 4px' }
const cardMeta = { fontSize: '12px', color: '#64748B', margin: '2px 0' }
const cardStatus = { fontSize: '12px', color: '#0F766E', margin: '6px 0 0', fontWeight: '600' }
const footer = { fontSize: '12px', color: '#94A3B8', margin: '28px 0 0', borderTop: '1px solid #E2E8F0', paddingTop: '14px' }

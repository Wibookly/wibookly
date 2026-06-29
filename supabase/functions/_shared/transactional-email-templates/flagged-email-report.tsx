/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE = 'InboxIQ'

interface ScheduleStep { label: string; status: string; date?: string | null }
interface Row {
  subject: string
  recipient_name: string
  recipient_address: string
  sent_at: string
  flag_due: string
  follow_up_schedule: ScheduleStep[]
  status: string
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
    <Preview>{SITE} — Flagged Email Tracker ({range_label || 'all time'})</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Flagged Email Tracker</Heading>
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

        <Heading as="h2" style={h2}>Tracked emails</Heading>

        {rows.length === 0 ? (
          <Text style={text}>No flagged emails in this range.</Text>
        ) : (
          <table cellPadding={0} cellSpacing={0} style={tableStyle as React.CSSProperties}>
            <thead>
              <tr>
                <th style={th}>Subject</th>
                <th style={th}>To (recipient)</th>
                <th style={th}>User sent</th>
                <th style={th}>Flag due</th>
                <th style={th}>Follow-up schedule</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={i % 2 === 0 ? trEven : trOdd}>
                  <td style={tdSubject}>{r.subject || '(no subject)'}</td>
                  <td style={td}>
                    {r.recipient_name && <div style={{ fontWeight: 600 }}>{r.recipient_name}</div>}
                    <div style={{ color: '#64748B', fontSize: '11px' }}>{r.recipient_address || '—'}</div>
                  </td>
                  <td style={tdNowrap}>{fmt(r.sent_at)}</td>
                  <td style={tdNowrap}>{fmt(r.flag_due)}</td>
                  <td style={td}>
                    {(r.follow_up_schedule || []).map((s, j) => (
                      <div key={j} style={scheduleLine}>
                        <span style={{ fontWeight: 600 }}>{s.label}</span> — <span>{s.status}</span>
                        {s.date ? <span style={{ color: '#64748B' }}> · {fmt(s.date)}</span> : null}
                      </div>
                    ))}
                  </td>
                  <td style={td}><span style={statusPill}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Text style={footer}>Report sent by {SITE}. Manage in Flagged Email Tracker.</Text>
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
  subject: (d: Record<string, any>) => `Flagged Email Tracker — ${d?.range_label || 'all time'}`,
  displayName: 'Flagged Email Tracker',
  previewData: {
    range_label: 'Last 7 days',
    generated_at: new Date().toISOString(),
    stats: { total: 4, pending: 2, replied: 1, followUpsSent: 3, missed: 1 },
    rows: [
      {
        subject: 'Q2 budget',
        recipient_name: 'Ali Rahimi',
        recipient_address: 'ali@example.com',
        sent_at: new Date().toISOString(),
        flag_due: new Date().toISOString(),
        follow_up_schedule: [
          { label: 'Follow-up 1', status: 'Sent', date: new Date().toISOString() },
          { label: 'Follow-up 2', status: 'Scheduled', date: new Date().toISOString() },
          { label: 'Follow-up 3', status: 'Pending', date: null },
        ],
        status: 'pending',
      },
    ],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '900px' }
const h1 = { fontSize: '22px', fontWeight: '600', color: '#14365C', margin: '0 0 8px' }
const h2 = { fontSize: '15px', fontWeight: '600', color: '#14365C', margin: '20px 0 10px' }
const meta = { fontSize: '13px', color: '#64748B', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#5C7185', lineHeight: '1.6' }
const hr = { borderColor: '#E2E8F0', margin: '20px 0' }
const statsWrap = { display: 'flex', gap: '10px', flexWrap: 'wrap' as const, margin: '16px 0' }
const statBox = { background: '#F1F5F9', borderRadius: '8px', padding: '10px 14px', minWidth: '90px' }
const statValue = { fontSize: '20px', fontWeight: '600', color: '#14365C', margin: '0' }
const statLabel = { fontSize: '11px', color: '#64748B', margin: '4px 0 0', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '12px', border: '1px solid #E2E8F0' }
const th = { textAlign: 'left' as const, background: '#14365C', color: '#fff', padding: '8px 10px', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #0F2A47' }
const td = { padding: '8px 10px', verticalAlign: 'top' as const, color: '#1E293B', borderBottom: '1px solid #E2E8F0' }
const tdNowrap = { ...td, whiteSpace: 'nowrap' as const }
const tdSubject = { ...td, fontWeight: 600, maxWidth: '220px' }
const trEven = { background: '#ffffff' }
const trOdd = { background: '#F8FAFC' }
const scheduleLine = { padding: '3px 6px', background: 'rgba(15,168,220,0.07)', borderRadius: '4px', margin: '2px 0', fontSize: '11px' }
const statusPill = { display: 'inline-block', padding: '2px 8px', borderRadius: '999px', background: '#E0F2FE', color: '#0F766E', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize' as const }
const footer = { fontSize: '12px', color: '#94A3B8', margin: '28px 0 0', borderTop: '1px solid #E2E8F0', paddingTop: '14px' }

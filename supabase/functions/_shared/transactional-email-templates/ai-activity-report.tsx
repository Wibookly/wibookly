/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE = 'InboxIQ'

interface Stats {
  totalDrafts: number
  totalAutoReplies: number
  totalScheduledEvents: number
  totalEmails: number
  totalChatMessages: number
  totalChatConversations: number
  totalMeetings: number
}
interface CategoryRow { categoryName: string; drafts: number; autoReplies: number }
interface Props {
  range_label?: string
  generated_at?: string
  stats?: Stats
  categories?: CategoryRow[]
}

const AIActivityReport = ({ range_label, generated_at, stats, categories = [] }: Props) => {
  const s = stats || { totalDrafts: 0, totalAutoReplies: 0, totalScheduledEvents: 0, totalEmails: 0, totalChatMessages: 0, totalChatConversations: 0, totalMeetings: 0 }
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{SITE} — AI Activity Report ({range_label || 'all time'})</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>AI Activity Report</Heading>
          <Text style={meta}>
            {range_label || 'all time'} · generated {generated_at ? new Date(generated_at).toLocaleString() : 'now'}
          </Text>
          <Hr style={hr} />

          <Section style={kpiGrid}>
            <KPI label="AI Drafts" value={s.totalDrafts} />
            <KPI label="AI Auto-Replies" value={s.totalAutoReplies} />
            <KPI label="Events Scheduled" value={s.totalScheduledEvents} />
            <KPI label="AI-Processed Emails" value={s.totalEmails} />
          </Section>

          <Section style={kpiGrid}>
            <KPI label="AI Chat Messages" value={s.totalChatMessages} sub={`${s.totalChatConversations} conv.`} />
            <KPI label="Meeting Copilot" value={s.totalMeetings} sub="meetings" />
          </Section>

          <Heading as="h2" style={h2}>By category</Heading>
          {categories.length === 0 ? (
            <Text style={muted}>No category activity in this range.</Text>
          ) : (
            <table style={table} cellPadding={0} cellSpacing={0}>
              <thead>
                <tr style={trh}>
                  <th style={th}>Category</th>
                  <th style={th}>Drafts</th>
                  <th style={th}>Auto-Replies</th>
                </tr>
              </thead>
              <tbody>
                {categories.slice(0, 25).map((c, i) => (
                  <tr key={i} style={tr}>
                    <td style={td}>{c.categoryName}</td>
                    <td style={td}>{c.drafts}</td>
                    <td style={td}>{c.autoReplies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <Hr style={hr} />
          <Text style={footer}>Sent by {SITE}. Open the AI Activity Report in-app for live charts.</Text>
        </Container>
      </Body>
    </Html>
  )
}

const KPI = ({ label, value, sub }: { label: string; value: number; sub?: string }) => (
  <div style={kpiCard}>
    <div style={kpiVal}>{value}</div>
    <div style={kpiLabel}>{label}</div>
    {sub && <div style={kpiSub}>{sub}</div>}
  </div>
)

export const template = {
  component: AIActivityReport,
  subject: ({ range_label }: any) => `Your AI Activity Report${range_label ? ` — ${range_label}` : ''}`,
  displayName: 'AI Activity Report',
  previewData: {
    range_label: 'Last 30 days',
    generated_at: new Date().toISOString(),
    stats: { totalDrafts: 24, totalAutoReplies: 6, totalScheduledEvents: 3, totalEmails: 58, totalChatMessages: 41, totalChatConversations: 9, totalMeetings: 2 },
    categories: [{ categoryName: 'Clients', drafts: 12, autoReplies: 2 }, { categoryName: 'Vendors', drafts: 7, autoReplies: 1 }],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif', color: '#0f172a' }
const container = { padding: '24px 28px', maxWidth: '640px' }
const h1 = { fontSize: '22px', margin: '0 0 4px', color: '#0f172a' }
const h2 = { fontSize: '15px', margin: '20px 0 8px', color: '#0f172a' }
const meta = { fontSize: '12px', color: '#64748b', margin: '0' }
const hr = { borderColor: '#e2e8f0', margin: '16px 0' }
const muted = { fontSize: '13px', color: '#64748b' }
const footer = { fontSize: '11px', color: '#94a3b8', textAlign: 'center' as const }
const kpiGrid = { display: 'block', marginBottom: '8px' }
const kpiCard = { display: 'inline-block', width: '23%', margin: '0 1% 8px', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', verticalAlign: 'top' as const, textAlign: 'center' as const, background: '#f8fafc' }
const kpiVal = { fontSize: '22px', fontWeight: 700, color: '#4f46e5' }
const kpiLabel = { fontSize: '11px', color: '#475569', marginTop: '4px' }
const kpiSub = { fontSize: '10px', color: '#94a3b8', marginTop: '2px' }
const table = { width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px' }
const trh = { background: '#f1f5f9' }
const th = { padding: '8px 10px', textAlign: 'left' as const, borderBottom: '1px solid #e2e8f0', color: '#334155', fontWeight: 600 }
const tr = { background: '#ffffff' }
const td = { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' }

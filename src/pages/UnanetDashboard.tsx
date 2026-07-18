import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, RefreshCw, X, Menu, ChevronLeft } from 'lucide-react';
import FinanceChatDock from '@/components/finance/FinanceChatDock';

/**
 * FinanceIQ — "The Ledger"
 * Replaces the previous Unanet Dashboard. Full-bleed layout with top nav,
 * CRM strip, filter bar, and 7 dashboard views. All numbers are illustrative
 * placeholders until the backend endpoint below is wired.
 *
 * TODO(backend): wire to
 *   GET /api/finance/:view?from=&to=&client=&office=
 *   returning { kpis, charts, tables } — read-only, sourced from Unanet A/E.
 */

// ---------- Design tokens (spec-exact) ----------
const T = {
  bg: '#0a0d14',
  panel: '#0f131c',
  panel2: '#131926',
  line: '#1e2634',
  ink: '#eef2f8',
  muted: '#8892a4',
  faint: '#5a6474',
  violet: '#8b5cf6',
  violet2: '#a78bfa',
  pink: '#e879b9',
  cyan: '#5ed0e0',
  green: '#3ecf8e',
  amber: '#f5b544',
  red: '#f0664f',
  blue: '#5b9dff',
};
const HERO_GRAD = 'linear-gradient(115deg,#7c3aed,#9333ea 42%,#c026d3 78%,#e879b9)';
const ACTIVE_GRAD = 'linear-gradient(135deg,#8b5cf6,#e879b9)';

// ---------- Nav ----------
type ViewId =
  | 'exec' | 'revenue' | 'cash' | 'ar' | 'ap' | 'projects' | 'utilization';

const NAV: { id: ViewId; icon: string; label: string }[] = [
  { id: 'exec',        icon: '📊', label: 'Executive Overview' },
  { id: 'revenue',     icon: '💵', label: 'Revenue & P&L' },
  { id: 'cash',        icon: '💧', label: 'Cash & WIP' },
  { id: 'ar',          icon: '📥', label: 'Accounts Receivable' },
  { id: 'ap',          icon: '📤', label: 'Accounts Payable' },
  { id: 'projects',    icon: '🏗️', label: 'Project Profitability' },
  { id: 'utilization', icon: '⏱️', label: 'Utilization & Labor' },
];

// ---------- Placeholder period datasets ----------
type Period = 'week' | 'month' | 'quarter' | 'ytd' | 'year';
const PERIOD_DATA: Record<Period, { echo: string; netrev: string; realization: string; wip: string; dso: string }> = {
  week:    { echo: 'Week of Jul 14',     netrev: '$0.58M', realization: '95.1%', wip: '$3.02M', dso: '58 days' },
  month:   { echo: 'June 2026',          netrev: '$2.41M', realization: '96.4%', wip: '$3.18M', dso: '58 days' },
  quarter: { echo: 'Q2 2026',            netrev: '$7.05M', realization: '96.0%', wip: '$3.40M', dso: '61 days' },
  ytd:     { echo: 'YTD 2026',           netrev: '$13.6M', realization: '95.7%', wip: '$3.18M', dso: '60 days' },
  year:    { echo: 'Trailing 12 mo',     netrev: '$26.8M', realization: '95.4%', wip: '$3.25M', dso: '62 days' },
};

// ---------- Small building blocks ----------
function TopBarButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border hover:bg-white/5"
      style={{ borderColor: T.line, background: T.panel, color: T.ink }}
    >
      {children}
    </button>
  );
}

function LiveSyncPill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide"
      style={{ background: 'rgba(62,207,142,0.10)', color: T.green, border: `1px solid ${T.green}40` }}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: T.green }} />
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: T.green }} />
      </span>
      LIVE SYNC
    </span>
  );
}

function KpiCard({
  icon, value, sub, note, accent, chip, chipTone = 'green',
}: {
  icon: string; value: string; sub: string; note?: string;
  accent: string; chip?: string; chipTone?: 'green' | 'red' | 'amber' | 'neutral';
}) {
  const chipColors: Record<string, { bg: string; fg: string }> = {
    green:   { bg: 'rgba(62,207,142,0.15)',  fg: T.green },
    red:     { bg: 'rgba(240,102,79,0.15)',  fg: T.red },
    amber:   { bg: 'rgba(245,181,68,0.15)',  fg: T.amber },
    neutral: { bg: 'rgba(139,92,246,0.15)',  fg: T.violet2 },
  };
  const cc = chipColors[chipTone];
  return (
    <div className="relative rounded-2xl p-5 overflow-hidden" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <div className="text-xl">{icon}</div>
        {chip && (
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: cc.bg, color: cc.fg }}>
            {chip}
          </span>
        )}
      </div>
      <div className="mt-4 text-3xl font-semibold" style={{ color: T.ink }}>{value}</div>
      <div className="mt-1 text-sm" style={{ color: T.ink }}>{sub}</div>
      {note && <div className="mt-1 text-xs" style={{ color: T.muted }}>{note}</div>}
    </div>
  );
}

function Panel({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium" style={{ color: T.ink }}>{title}</div>
        {right && <div className="text-xs" style={{ color: T.muted }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

const KPI_ACCENTS = [
  `linear-gradient(90deg,${T.blue},${T.blue}00)`,
  `linear-gradient(90deg,${T.violet},${T.violet}00)`,
  `linear-gradient(90deg,${T.amber},${T.amber}00)`,
  `linear-gradient(90deg,${T.green},${T.green}00)`,
];

// ---------- Views ----------
function ExecView({ p }: { p: Period }) {
  const d = PERIOD_DATA[p];
  return (
    <>
      {/* Hero */}
      <div className="relative rounded-2xl p-6 md:p-8 overflow-hidden" style={{ background: HERO_GRAD }}>
        <div className="text-[11px] font-semibold tracking-widest text-white/80">
          ✦ AI ANALYSIS · GENERATED 11:52 PM · EXECUTIVE VIEW
        </div>
        <div className="mt-3 text-3xl md:text-4xl font-semibold text-white">Good evening, Ali.</div>
        <p className="mt-3 text-white/90 max-w-3xl leading-relaxed">
          <strong>June close is healthy.</strong> Net multiplier holding at <strong>3.02×</strong> and utilization at{' '}
          <strong>67%</strong>, but <strong>$418K</strong> in receivables crossed 90 days — collections is your highest-leverage move.
        </p>
        <div
          className="absolute top-6 right-6 hidden md:flex gap-6 rounded-2xl px-6 py-4 backdrop-blur"
          style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.20)' }}
        >
          {[
            { v: '3.02×', l: 'NET MULT.' },
            { v: '67%',   l: 'UTILIZATION' },
            { v: '$418K', l: '90+ AR' },
          ].map((s) => (
            <div key={s.l} className="text-center">
              <div className="text-2xl font-semibold text-white">{s.v}</div>
              <div className="text-[10px] tracking-widest text-white/80 mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <KpiCard icon="💰" value={d.netrev} sub="Net revenue" note="vs $2.31M prior" accent={KPI_ACCENTS[0]} chip="+4.1%" chipTone="green" />
        <KpiCard icon="📈" value={d.realization} sub="Realization" note="Benchmark 96%" accent={KPI_ACCENTS[1]} chip="+2 pts" chipTone="green" />
        <KpiCard icon="⏳" value={d.wip} sub="Work in progress" note="Unbilled" accent={KPI_ACCENTS[2]} chip="+$0.3M" chipTone="red" />
        <KpiCard icon="🗓️" value={d.dso} sub="Collection (DSO)" note="Down from 64" accent={KPI_ACCENTS[3]} chip="−6 days" chipTone="green" />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Panel title="📊 Net revenue vs plan" right="$000s">
          <div className="flex items-end gap-3 h-40">
            {[
              { m: 'Nov', v: 1.5 }, { m: 'Dec', v: 1.7 }, { m: 'Jan', v: 1.4 },
              { m: 'Feb', v: 1.9 }, { m: 'Mar', v: 1.8 }, { m: 'Apr', v: 2.1 },
              { m: 'May', v: 2.2, alt: true }, { m: 'Jun', v: 2.4, alt: true },
            ].map((b) => (
              <div key={b.m} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${(b.v / 2.4) * 100}%`,
                    background: b.alt
                      ? `linear-gradient(180deg,${T.cyan},${T.cyan}90)`
                      : `linear-gradient(180deg,${T.violet2},${T.violet})`,
                  }}
                />
                <div className="text-[10px]" style={{ color: T.muted }}>{b.v.toFixed(1)}M</div>
                <div className="text-[10px]" style={{ color: T.faint }}>{b.m}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="📬 AR aging" right="$1.92M total">
          <div className="space-y-3">
            {[
              { l: 'Current',    pct: 58, v: '$1.11M' },
              { l: '31–60 days', pct: 22, v: '$0.42M' },
              { l: '61–90 days', pct: 10, v: '$0.20M' },
              { l: '90+ days',   pct: 22, v: '$0.42M' },
            ].map((r) => (
              <div key={r.l} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-sm">
                <div style={{ color: T.muted }}>{r.l}</div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: T.panel2 }}>
                  <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: `linear-gradient(90deg,${T.violet2},${T.violet})` }} />
                </div>
                <div className="text-right" style={{ color: T.ink }}>{r.v}</div>
              </div>
            ))}
          </div>
          <div
            className="mt-4 rounded-lg p-3 text-xs flex items-start gap-2"
            style={{ background: 'rgba(240,102,79,0.10)', border: `1px solid ${T.red}40`, color: '#fecaca' }}
          >
            <span>⚠️</span>
            <span><strong>3 invoices</strong> over 90 days for <strong>Meridian Tower</strong> — $418K. AI drafted a follow-up.</span>
          </div>
        </Panel>
      </div>
    </>
  );
}

function RevenueView({ p }: { p: Period }) {
  const d = PERIOD_DATA[p];
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="💵" value={d.netrev} sub="Net revenue" note="Gross $3.02M" accent={KPI_ACCENTS[0]} chip="+4.1%" chipTone="green" />
        <KpiCard icon="📈" value="3.02×" sub="Net multiplier" note="Target 3.00×" accent={KPI_ACCENTS[1]} chip="+1.3 pts" chipTone="green" />
        <KpiCard icon="🏢" value="1.58" sub="Overhead rate" note="On direct labor" accent={KPI_ACCENTS[2]} chip="+0.4 pts" chipTone="red" />
        <KpiCard icon="✅" value="11.4%" sub="Operating profit" note="On net revenue" accent={KPI_ACCENTS[3]} chip="+2.0 pts" chipTone="green" />
      </div>
      <Panel title="🧾 Income statement (summary)" right="June 2026 · accrual">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wider" style={{ color: T.muted }}>
                <th className="pb-3 font-medium">LINE</th>
                <th className="pb-3 font-medium">THIS PERIOD</th>
                <th className="pb-3 font-medium">PRIOR</th>
                <th className="pb-3 font-medium">YTD</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Gross revenue', '$3.02M', '$2.90M', '$17.1M', false, false],
                ['Consultants / pass-through', '($0.61M)', '($0.59M)', '($3.5M)', false, false],
                ['Net revenue', '$2.41M', '$2.31M', '$13.6M', true, false],
                ['Direct labor', '($0.80M)', '($0.78M)', '($4.6M)', false, false],
                ['Overhead', '($1.26M)', '($1.23M)', '($7.2M)', false, false],
                ['Operating profit', '$0.27M', '$0.22M', '$1.55M', true, true],
              ].map((row, i) => {
                const [line, tp, pr, ytd, bold, chip] = row as any;
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td className={`py-3 ${bold ? 'font-semibold' : ''}`}>{line}</td>
                    <td className="py-3">
                      {chip
                        ? <span className="px-2 py-0.5 rounded-md text-xs" style={{ background: 'rgba(62,207,142,0.15)', color: T.green }}>{tp}</span>
                        : tp}
                    </td>
                    <td className="py-3">{pr}</td>
                    <td className="py-3">{ytd}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function CashView() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="🏦" value="$1.84M" sub="Cash on hand" note="Operating account" accent={KPI_ACCENTS[0]} chip="+$0.2M" chipTone="green" />
        <KpiCard icon="⏳" value="$3.18M" sub="Total WIP" note="Unbilled work" accent={KPI_ACCENTS[1]} chip="+$0.3M" chipTone="red" />
        <KpiCard icon="💧" value="1.9×" sub="Operating cash ratio" note="Healthy > 1.0" accent={KPI_ACCENTS[2]} chip="1.9×" chipTone="neutral" />
        <KpiCard icon="🗓️" value="12 days" sub="Avg. WIP age" note="Time to invoice" accent={KPI_ACCENTS[3]} chip="−4 days" chipTone="green" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="💵 Cash flow (13-week)" right="projected">
          <div className="flex items-end gap-2 h-44">
            {[0.35, 0.55, 0.45, 0.75, 0.6, 0.72, 0.65, 0.82, 0.78, 0.85, 0.88, 0.95, 1.0].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${h * 100}%`,
                    background: i >= 11
                      ? `linear-gradient(180deg,${T.cyan},${T.cyan}90)`
                      : `linear-gradient(180deg,${T.violet2},${T.violet})`,
                  }}
                />
                <div className="text-[10px]" style={{ color: T.faint }}>W{i + 1}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="⏳ WIP aging" right="$3.18M">
          <div className="space-y-3">
            {[
              { l: '0–15 days',  pct: 55, v: '$1.75M' },
              { l: '16–30 days', pct: 26, v: '$0.83M' },
              { l: '31–45 days', pct: 12, v: '$0.38M' },
              { l: '45+ days',   pct: 7,  v: '$0.22M' },
            ].map((r) => (
              <div key={r.l} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-sm">
                <div style={{ color: T.muted }}>{r.l}</div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: T.panel2 }}>
                  <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: `linear-gradient(90deg,${T.violet2},${T.violet})` }} />
                </div>
                <div className="text-right" style={{ color: T.ink }}>{r.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg p-3 text-xs flex items-start gap-2"
               style={{ background: 'rgba(245,181,68,0.10)', border: `1px solid ${T.amber}40`, color: '#fde68a' }}>
            <span>💡</span>
            <span>Invoicing WIP older than 30 days would release <strong>$600K</strong> to cash.</span>
          </div>
        </Panel>
      </div>
    </>
  );
}

function ARView() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="🗓️" value="58 days" sub="DSO" note="Days sales outstanding" accent={KPI_ACCENTS[0]} chip="−6 days" chipTone="green" />
        <KpiCard icon="🔴" value="$0.42M" sub="90+ days AR" note="Needs collection" accent={KPI_ACCENTS[1]} chip="+$0.08M" chipTone="red" />
        <KpiCard icon="📬" value="$1.92M" sub="Total AR" note="Outstanding" accent={KPI_ACCENTS[2]} chip="+3%" chipTone="green" />
        <KpiCard icon="✅" value="92%" sub="Collected on time" note="Rolling 90 days" accent={KPI_ACCENTS[3]} chip="92%" chipTone="neutral" />
      </div>
      <Panel title="📬 Open invoices" right="sorted by age">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wider" style={{ color: T.muted }}>
                {['INVOICE','CLIENT','PROJECT','AMOUNT','AGE','STATUS'].map((h) => <th key={h} className="pb-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                ['INV-4821','Meridian Dev.','Meridian Tower','$182K','103 days','Overdue','red'],
                ['INV-4799','Meridian Dev.','Meridian Tower','$146K','96 days','Overdue','red'],
                ['INV-4903','Port Authority','Harborview Campus','$210K','44 days','Aging','amber'],
                ['INV-4955','HealthOne','Lakeshore Medical','$88K','21 days','Current','green'],
                ['INV-4970','Unified SD','Cedar K-8 School','$64K','12 days','Current','green'],
              ].map((r, i) => {
                const [inv, cl, pj, am, age, st, tone] = r as any;
                const tones: any = {
                  red:   { bg: 'rgba(240,102,79,0.15)', fg: T.red },
                  amber: { bg: 'rgba(245,181,68,0.15)', fg: T.amber },
                  green: { bg: 'rgba(62,207,142,0.15)', fg: T.green },
                };
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td className="py-3 font-medium">{inv}</td>
                    <td className="py-3">{cl}</td>
                    <td className="py-3">{pj}</td>
                    <td className="py-3">{am}</td>
                    <td className="py-3">{age}</td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded-md text-xs" style={{ background: tones[tone].bg, color: tones[tone].fg }}>{st}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 rounded-lg p-3 text-xs flex items-start gap-2"
             style={{ background: 'rgba(240,102,79,0.10)', border: `1px solid ${T.red}40`, color: '#fecaca' }}>
          <span>⚠️</span>
          <span><strong>$418K</strong> across 3 Meridian invoices is 90+ days. Ask the assistant to draft a collections email for all three.</span>
        </div>
      </Panel>
    </>
  );
}

function APView() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="🗓️" value="34 days" sub="DPO" note="Days payable outstanding" accent={KPI_ACCENTS[0]} chip="+2 days" chipTone="green" />
        <KpiCard icon="🔴" value="$0.11M" sub="Overdue payables" note="Past terms" accent={KPI_ACCENTS[1]} chip="$0.11M" chipTone="red" />
        <KpiCard icon="📤" value="$0.74M" sub="Total AP" note="Owed to vendors" accent={KPI_ACCENTS[2]} chip="$0.74M" chipTone="neutral" />
        <KpiCard icon="🤝" value="$0.28M" sub="Consultant payables" note="Sub-consultants" accent={KPI_ACCENTS[3]} chip="$0.28M" chipTone="green" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="📬 AP aging" right="$0.74M">
          <div className="space-y-3">
            {[
              { l: 'Current',    pct: 62, v: '$0.46M' },
              { l: '31–60 days', pct: 23, v: '$0.17M' },
              { l: '60+ days',   pct: 15, v: '$0.11M' },
            ].map((r) => (
              <div key={r.l} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-sm">
                <div style={{ color: T.muted }}>{r.l}</div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: T.panel2 }}>
                  <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: `linear-gradient(90deg,${T.violet2},${T.violet})` }} />
                </div>
                <div className="text-right" style={{ color: T.ink }}>{r.v}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="📅 Upcoming payments" right="next 14 days">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wider" style={{ color: T.muted }}>
                <th className="pb-2 font-medium">VENDOR</th><th className="pb-2 font-medium">DUE</th><th className="pb-2 font-medium">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Geotech Partners','Jul 20','$42K'],
                ['Reprographics Co.','Jul 23','$8K'],
                ['MEP Consultants LLC','Jul 28','$116K'],
                ['Cloud & Software','Jul 31','$21K'],
              ].map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td className="py-2.5 font-medium">{r[0]}</td>
                  <td className="py-2.5">{r[1]}</td>
                  <td className="py-2.5">{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

function ProjectsView() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="📊" value="24.6%" sub="Avg. project margin" note="Active portfolio" accent={KPI_ACCENTS[0]} chip="+1.2 pts" chipTone="green" />
        <KpiCard icon="🏗️" value="18" sub="Active projects" note="In production" accent={KPI_ACCENTS[1]} chip="18" chipTone="neutral" />
        <KpiCard icon="⚠️" value="2" sub="Over budget" note="Margin < 10%" accent={KPI_ACCENTS[2]} chip="2" chipTone="red" />
        <KpiCard icon="💼" value="$9.6M" sub="Backlog" note="Contracted, unearned" accent={KPI_ACCENTS[3]} chip="$9.6M" chipTone="green" />
      </div>
      <Panel title="🏗️ Project profitability" right="% complete vs margin">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] tracking-wider" style={{ color: T.muted }}>
              {['PROJECT','CLIENT','FEE','% COMPLETE','BILLED','MARGIN'].map((h) => <th key={h} className="pb-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {[
              ['Meridian Tower',    'PRJ-24-0118','Meridian Dev.','$1.85M', 78, '$1.31M','28%','green'],
              ['Harborview Campus', 'PRJ-24-0091','Port Authority','$3.20M', 45, '$1.44M','31%','green'],
              ['Cedar K-8 School',  'PRJ-24-0135','Unified SD',    '$980K',  62, '$540K', '14%','amber'],
              ['Riverside Transit Hub','PRJ-23-0207','Metro Transit','$2.40M',88,'$2.05M','6%', 'red'],
              ['Lakeshore Medical', 'PRJ-24-0142','HealthOne',     '$1.10M', 33, '$360K', '27%','green'],
            ].map((r, i) => {
              const [pj, code, cl, fee, pct, billed, mg, tone] = r as any;
              const tones: any = {
                green: { bg: 'rgba(62,207,142,0.15)', fg: T.green },
                amber: { bg: 'rgba(245,181,68,0.15)', fg: T.amber },
                red:   { bg: 'rgba(240,102,79,0.15)', fg: T.red },
              };
              return (
                <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td className="py-3">
                    <div className="font-medium">{pj}</div>
                    <div className="text-[11px]" style={{ color: T.faint }}>{code}</div>
                  </td>
                  <td className="py-3">{cl}</td>
                  <td className="py-3">{fee}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full overflow-hidden" style={{ background: T.panel2 }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg,${T.violet2},${T.pink})` }} />
                      </div>
                      <span className="text-xs">{pct}%</span>
                    </div>
                  </td>
                  <td className="py-3">{billed}</td>
                  <td className="py-3">
                    <span className="px-2 py-0.5 rounded-md text-xs" style={{ background: tones[tone].bg, color: tones[tone].fg }}>{mg}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

function UtilizationView() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="⏱️" value="67%" sub="Utilization" note="Target 80–90%" accent={KPI_ACCENTS[0]} chip="+2 pts" chipTone="green" />
        <KpiCard icon="📈" value="96.4%" sub="Realization" note="Billed vs collected" accent={KPI_ACCENTS[1]} chip="+1 pt" chipTone="green" />
        <KpiCard icon="🙋" value="7,240" sub="Billable hours" note="This period" accent={KPI_ACCENTS[2]} chip="7,240" chipTone="neutral" />
        <KpiCard icon="💲" value="$182" sub="Avg. billing rate" note="Blended" accent={KPI_ACCENTS[3]} chip="$182" chipTone="red" />
      </div>
      <Panel title="⏱️ Utilization by team" right="billable %">
        <div className="space-y-4">
          {[
            { l: 'Architecture', pct: 82 },
            { l: 'Structural',   pct: 74 },
            { l: 'MEP',          pct: 69 },
            { l: 'Interiors',    pct: 58 },
            { l: 'Principals',   pct: 41 },
          ].map((r) => (
            <div key={r.l} className="grid grid-cols-[130px_1fr_50px] items-center gap-3 text-sm">
              <div style={{ color: T.muted }}>{r.l}</div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: T.panel2 }}>
                <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: `linear-gradient(90deg,${T.violet},${T.pink})` }} />
              </div>
              <div className="text-right" style={{ color: T.ink }}>{r.pct}%</div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

// ---------- Page ----------
const APP_LINKS: { to: string; icon: string; label: string }[] = [
  { to: '/home',                 icon: '🏠', label: 'The Helm — Home' },
  { to: '/brief',                icon: '📰', label: 'The Helm — Full Brief' },
  { to: '/helm/brief',           icon: '🗞️', label: 'The Brief' },
  { to: '/chat',                 icon: '💬', label: 'AI Chat' },
  { to: '/flagged-email-tracker',icon: '🚩', label: 'Flagged Email Tracker' },
  { to: '/categories',           icon: '🏷️', label: 'Email Intelligence' },
  { to: '/integrations',         icon: '🔗', label: 'Integrations' },
  { to: '/admin',                icon: '🛡️', label: 'Admin Dashboard' },
];

export default function UnanetDashboard() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewId>('exec');
  const [period, setPeriod] = useState<Period>('month');
  const [client, setClient] = useState('All clients');
  const [office, setOffice] = useState('All offices');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState('2026-06-30');
  const [menuOpen, setMenuOpen] = useState(false);

  const activeNav = useMemo(() => NAV.find((n) => n.id === view)!, [view]);
  const echo = PERIOD_DATA[period].echo;

  // TODO(backend): call GET /api/finance/:view?from&to&client&office when filters change.

  return (
    <div className="min-h-screen" style={{ background: T.bg, color: T.ink, fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif' }}>
      {/* Top bar */}
      <div className="sticky top-0 z-30 backdrop-blur" style={{ background: `${T.bg}e8`, borderBottom: `1px solid ${T.line}` }}>
        <div className="px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ background: ACTIVE_GRAD }}
            >F</div>
            <div className="leading-tight">
              <div className="font-semibold text-[15px]">FinanceIQ</div>
              <div className="text-[11px]" style={{ color: T.muted }}>by Energy Forward AI</div>
            </div>
            <div className="mx-4 h-8 w-px" style={{ background: T.line }} />
            <div className="leading-tight">
              <div className="text-[10px] tracking-widest" style={{ color: T.muted }}>REPORTS</div>
              <div className="font-semibold text-[15px]">{activeNav.label}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TopBarButton onClick={() => window.location.reload()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</TopBarButton>
            <TopBarButton onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Print</TopBarButton>
            <LiveSyncPill />
            <button
              onClick={() => navigate('/home')}
              className="p-1.5 rounded-lg hover:bg-white/5 ml-2"
              style={{ color: T.muted }}
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <div className="px-6 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {NAV.map((n) => {
            const active = n.id === view;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className="relative px-4 py-3 text-sm whitespace-nowrap"
                style={{
                  color: active ? T.ink : T.muted,
                  background: active ? T.panel : 'transparent',
                  borderTopLeftRadius: 10, borderTopRightRadius: 10,
                }}
              >
                <span className="mr-1.5">{n.icon}</span>{n.label}
                {active && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full" style={{ background: ACTIVE_GRAD }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* CRM strip */}
      <div className="px-6 pt-5">
        <div
          className="flex items-center gap-5 flex-wrap rounded-xl px-4 py-2.5 text-sm"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <span
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-semibold"
            style={{ background: 'rgba(94,208,224,0.12)', color: T.cyan, border: `1px solid ${T.cyan}40` }}
          >
            <span className="h-5 w-5 rounded-md flex items-center justify-center text-[10px]" style={{ background: T.cyan, color: T.bg }}>U</span>
            Unanet CRM
          </span>
          <span><strong>$14.2M</strong> <span style={{ color: T.muted }}>Pipeline</span></span>
          <span><strong>32</strong> <span style={{ color: T.muted }}>Active pursuits</span></span>
          <span><strong>$4.8M</strong> <span style={{ color: T.muted }}>Weighted</span></span>
          <span><strong>41%</strong> <span style={{ color: T.muted }}>Win rate (TTM)</span></span>
          <span><strong>6</strong> <span style={{ color: T.muted }}>Proposals due &lt;14d</span></span>
          <span className="ml-auto text-xs" style={{ color: T.faint }}>synced 11:52 PM</span>
        </div>

        {/* Filter bar */}
        <div className="mt-4 flex items-center gap-4 flex-wrap rounded-xl px-4 py-3"
             style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <span className="text-[10px] tracking-widest" style={{ color: T.muted }}>PERIOD</span>
          <div className="inline-flex rounded-lg overflow-hidden" style={{ background: T.panel2 }}>
            {(['week','month','quarter','ytd','year'] as Period[]).map((p) => {
              const active = p === period;
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="px-3 py-1.5 text-xs capitalize"
                  style={{
                    color: active ? 'white' : T.muted,
                    background: active ? ACTIVE_GRAD : 'transparent',
                  }}
                >{p === 'ytd' ? 'YTD' : p}</button>
              );
            })}
          </div>
          <span className="text-[10px] tracking-widest" style={{ color: T.muted }}>FROM</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 className="bg-transparent text-xs px-2.5 py-1.5 rounded-lg outline-none"
                 style={{ border: `1px solid ${T.line}`, color: T.ink, colorScheme: 'dark' }} />
          <span className="text-[10px] tracking-widest" style={{ color: T.muted }}>TO</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 className="bg-transparent text-xs px-2.5 py-1.5 rounded-lg outline-none"
                 style={{ border: `1px solid ${T.line}`, color: T.ink, colorScheme: 'dark' }} />

          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <select value={client} onChange={(e) => setClient(e.target.value)}
                    className="bg-transparent text-xs px-2.5 py-1.5 rounded-lg outline-none"
                    style={{ border: `1px solid ${T.line}`, color: T.ink }}>
              <option style={{ background: T.panel }}>All clients</option>
              <option style={{ background: T.panel }}>Meridian Dev.</option>
              <option style={{ background: T.panel }}>Port Authority</option>
              <option style={{ background: T.panel }}>HealthOne</option>
            </select>
            <select value={office} onChange={(e) => setOffice(e.target.value)}
                    className="bg-transparent text-xs px-2.5 py-1.5 rounded-lg outline-none"
                    style={{ border: `1px solid ${T.line}`, color: T.ink }}>
              <option style={{ background: T.panel }}>All offices</option>
              <option style={{ background: T.panel }}>HQ</option>
              <option style={{ background: T.panel }}>West</option>
              <option style={{ background: T.panel }}>East</option>
            </select>
            <span className="text-xs" style={{ color: T.faint }}>Showing: {echo}</span>
          </div>
        </div>
      </div>

      {/* Views */}
      <div className="px-6 py-6 space-y-4">
        {view === 'exec'        && <ExecView p={period} />}
        {view === 'revenue'     && <RevenueView p={period} />}
        {view === 'cash'        && <CashView />}
        {view === 'ar'          && <ARView />}
        {view === 'ap'          && <APView />}
        {view === 'projects'    && <ProjectsView />}
        {view === 'utilization' && <UtilizationView />}

        <p className="text-center text-xs pt-6" style={{ color: T.faint }}>
          Illustrative data — placeholder figures for layout preview. Live values pull from Unanet A/E on each sync and respond to the filters above.
        </p>
      </div>

      <FinanceChatDock />

      {/* Bottom-left MENU pill (matches AI Chat page) */}
      <button
        onClick={() => setMenuOpen(true)}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold tracking-wider shadow-lg hover:brightness-110 transition"
        style={{ background: ACTIVE_GRAD, color: 'white' }}
        aria-label="Open Ledger menu"
      >
        <Menu className="h-3.5 w-3.5" /> MENU
      </button>

      {/* Slide-in side menu */}
      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
          />
          <aside
            className="fixed top-0 left-0 bottom-0 z-50 w-72 flex flex-col animate-in slide-in-from-left duration-200"
            style={{ background: T.panel, borderRight: `1px solid ${T.line}`, color: T.ink }}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${T.line}` }}>
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-md flex items-center justify-center text-white text-xs font-bold" style={{ background: ACTIVE_GRAD }}>F</div>
                <div className="text-sm font-semibold">The Ledger</div>
              </div>
              <button onClick={() => setMenuOpen(false)} className="p-1.5 rounded hover:bg-white/5" style={{ color: T.muted }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-5">
              <div>
                <div className="text-[10px] tracking-widest px-2 mb-2" style={{ color: T.muted }}>LEDGER VIEWS</div>
                <div className="space-y-1">
                  {NAV.map((n) => {
                    const active = n.id === view;
                    return (
                      <button
                        key={n.id}
                        onClick={() => { setView(n.id); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition"
                        style={{
                          color: active ? 'white' : T.ink,
                          background: active ? ACTIVE_GRAD : 'transparent',
                        }}
                        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        <span>{n.icon}</span>
                        <span className="flex-1">{n.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] tracking-widest px-2 mb-2" style={{ color: T.muted }}>GO TO</div>
                <div className="space-y-1">
                  {APP_LINKS.map((l) => (
                    <button
                      key={l.to}
                      onClick={() => { setMenuOpen(false); navigate(l.to); }}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                      style={{ color: T.ink }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    >
                      <span>{l.icon}</span>
                      <span className="flex-1">{l.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3 text-[10px]" style={{ color: T.faint, borderTop: `1px solid ${T.line}` }}>
              FinanceIQ · Energy Forward AI
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

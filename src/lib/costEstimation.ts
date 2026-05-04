// Mirrors supabase/functions/_shared/enforce-limits.ts for client-side projections.

export const FEATURE_TOKENS: Record<string, { in: number; out: number }> = {
  ai_chat:            { in: 4000,  out: 800  },
  ai_draft:           { in: 2000,  out: 400  },
  ai_auto_reply:      { in: 3000,  out: 500  },
  daily_brief:        { in: 8000,  out: 1500 },
  activity_reports:   { in: 15000, out: 3000 },
  email_agent:        { in: 10000, out: 1500 },
  teams_agent:        { in: 10000, out: 1500 },
  follow_up_reminder: { in: 5000,  out: 500  },
  documents:          { in: 12000, out: 8000 },
  powerpoints:        { in: 8000,  out: 5000 },
  excel:              { in: 8000,  out: 3000 },
  file_reading:       { in: 10000, out: 800  },
};

export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'phi-4':                    { input: 0.30, output: 0.60 },
  'gpt-4.1-mini':             { input: 0.40, output: 1.60 },
  'gpt-4.1':                  { input: 2.00, output: 8.00 },
  'gpt-4o':                   { input: 2.50, output: 10.00 },
  'gpt-4o-mini':              { input: 0.15, output: 0.60 },
  'gpt-5':                    { input: 2.50, output: 10.00 },
  'gpt-5-mini':               { input: 0.25, output: 2.00 },
  'gpt-5-nano':               { input: 0.05, output: 0.40 },
  'llama-3.3-70b':            { input: 1.50, output: 2.00 },
  'claude-sonnet-4-5':        { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-latest': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-latest':  { input: 0.80, output: 4.00 },
  'claude-haiku-4-5':         { input: 1.00, output: 5.00 },
  'claude-opus-4':            { input: 15.00, output: 75.00 },
};

export const MODEL_OPTIONS_BY_FEATURE: Record<string, string[]> = {
  ai_chat:            ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  ai_auto_reply:      ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  activity_reports:   ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  excel:              ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  file_reading:       ['gpt-4.1-mini', 'gpt-4.1', 'phi-4'],
  ai_draft:           ['phi-4', 'gpt-4.1-mini', 'gpt-4.1'],
  daily_brief:        ['phi-4', 'gpt-4.1-mini', 'gpt-4.1'],
  follow_up_reminder: ['phi-4', 'gpt-4.1-mini', 'gpt-4.1'],
  email_agent:        ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4-5'],
  teams_agent:        ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4-5'],
  documents:          ['llama-3.3-70b', 'gpt-4.1', 'claude-sonnet-4-5'],
  powerpoints:        ['llama-3.3-70b', 'gpt-4.1', 'claude-sonnet-4-5'],
};

export const ALL_FEATURES: { key: string; label: string }[] = [
  { key: 'ai_chat', label: 'AI Chat' },
  { key: 'ai_draft', label: 'AI Draft' },
  { key: 'ai_auto_reply', label: 'AI Auto Reply' },
  { key: 'daily_brief', label: 'Daily Brief' },
  { key: 'activity_reports', label: 'Activity Reports' },
  { key: 'email_agent', label: 'Email Agent' },
  { key: 'teams_agent', label: 'Teams Agent' },
  { key: 'follow_up_reminder', label: 'Follow-up Reminder' },
  { key: 'documents', label: 'Documents' },
  { key: 'powerpoints', label: 'PowerPoints' },
  { key: 'excel', label: 'Excel' },
  { key: 'file_reading', label: 'File Reading' },
];

export function costPerTask(feature: string, model: string): number {
  const t = FEATURE_TOKENS[feature];
  const r = MODEL_COSTS[model];
  if (!t || !r) return 0;
  return (t.in * r.input + t.out * r.output) / 1_000_000;
}

export function fmtUSD(n: number, digits = 2): string {
  if (!isFinite(n)) return '$0.00';
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

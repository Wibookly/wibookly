
ALTER TABLE public.meeting_sessions
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS key_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS followup_subject text,
  ADD COLUMN IF NOT EXISTS followup_body_html text,
  ADD COLUMN IF NOT EXISTS summary_generated_at timestamptz;

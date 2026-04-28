ALTER TABLE public.follow_up_settings
  ADD COLUMN IF NOT EXISTS daily_audit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_audit_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_audit_summary jsonb;
ALTER TABLE public.meeting_sessions
  ADD COLUMN IF NOT EXISTS recap_email_status text,
  ADD COLUMN IF NOT EXISTS recap_email_sent_at timestamp with time zone;
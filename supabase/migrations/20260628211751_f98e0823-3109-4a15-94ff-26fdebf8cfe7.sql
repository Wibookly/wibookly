ALTER TABLE public.tracked_emails
  ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS queued_reason text;

ALTER TABLE public.tracked_emails
  DROP CONSTRAINT IF EXISTS tracked_emails_status_check;

ALTER TABLE public.tracked_emails
  ADD CONSTRAINT tracked_emails_status_check
  CHECK (status IN (
    'pending',
    'replied',
    'drafted',
    'queued',
    'completed',
    'cancelled',
    'exhausted',
    'error'
  ));

CREATE INDEX IF NOT EXISTS idx_tracked_emails_queued
  ON public.tracked_emails(status, scheduled_send_at)
  WHERE scheduled_send_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tracked_emails_pending_due
  ON public.tracked_emails(status, follow_up_at)
  WHERE status = 'pending';
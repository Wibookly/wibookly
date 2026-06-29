-- Shift the VBridge follow-up out of the now-blocked 10:49 PM slot to the
-- next allowed Mon-Fri 8AM PT window so the UI and cron both reflect the
-- user's updated business-hours setting.
UPDATE public.tracked_emails
SET follow_up_at = '2026-06-30 15:00:00+00',
    last_checked_at = now()
WHERE id = '997acc25-8945-4278-955d-666ede4aa4c9'
  AND follow_up_at = '2026-06-30 05:49:23.365+00';
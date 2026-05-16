SELECT cron.schedule(
  'meeting-copilot-cleanup-transcripts',
  '0 3 * * *',
  $$ SELECT public.cleanup_old_meeting_transcripts(); $$
);
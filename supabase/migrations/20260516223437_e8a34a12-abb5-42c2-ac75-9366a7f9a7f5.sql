CREATE OR REPLACE FUNCTION public.cleanup_old_chat_conversations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.chat_conversations
    WHERE created_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*) INTO _count FROM del;
  RETURN _count;
END;
$$;

DO $$
DECLARE _jobid bigint;
BEGIN
  SELECT jobid INTO _jobid FROM cron.job WHERE jobname = 'cleanup-old-chat-conversations';
  IF _jobid IS NOT NULL THEN PERFORM cron.unschedule(_jobid); END IF;
END $$;

SELECT cron.schedule(
  'cleanup-old-chat-conversations',
  '15 3 * * *',
  $$ SELECT public.cleanup_old_chat_conversations(); $$
);
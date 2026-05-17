-- No Reply Tracker: cancel-by-BCC support + exhausted status

ALTER TABLE public.follow_up_trackers
  ADD COLUMN IF NOT EXISTS cancellation_alias text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.follow_up_settings
  ADD COLUMN IF NOT EXISTS stop_aliases text[] NOT NULL DEFAULT ARRAY['stop','0'];

-- Cancel all open trackers for a conversation on a given connection.
-- Returns the message_ids of the original sent emails so the caller (the
-- cron edge function) can move them out of the Follow-up Outlook folder.
CREATE OR REPLACE FUNCTION public.cancel_trackers_for_conversation(
  _connection_id uuid,
  _conversation_id text,
  _alias text
) RETURNS TABLE(message_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.follow_up_trackers t
     SET status = 'cancelled',
         cancellation_alias = _alias,
         cancelled_at = now(),
         next_reminder_at = NULL,
         updated_at = now()
   WHERE t.connection_id = _connection_id
     AND t.conversation_id = _conversation_id
     AND t.status IN ('pending','drafted','missed')
  RETURNING t.message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_trackers_for_conversation(uuid, text, text) TO authenticated, service_role;
-- Per-connection Follow-Up Reminder settings
CREATE TABLE IF NOT EXISTS public.follow_up_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT false,
  auto_draft_enabled boolean NOT NULL DEFAULT true,
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  skip_if_replied boolean NOT NULL DEFAULT true,
  reminder_max_count integer NOT NULL DEFAULT 3,
  reminder_intervals_days integer[] NOT NULL DEFAULT ARRAY[1, 3, 7],
  bcc_domain text NOT NULL DEFAULT 'energyforward.com',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.follow_up_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own follow-up settings"
  ON public.follow_up_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service role manages follow-up settings"
  ON public.follow_up_settings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_follow_up_settings_updated
  BEFORE UPDATE ON public.follow_up_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend trackers with reminder loop + action mode
ALTER TABLE public.follow_up_trackers
  ADD COLUMN IF NOT EXISTS action_mode text NOT NULL DEFAULT 'label_only',
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS skip_reason text;

-- Drop and recreate status check to allow new states
ALTER TABLE public.follow_up_trackers
  DROP CONSTRAINT IF EXISTS follow_up_trackers_status_check;

ALTER TABLE public.follow_up_trackers
  ADD CONSTRAINT follow_up_trackers_status_check
  CHECK (status IN (
    'pending','drafted','auto_sent','replied','missed',
    'paused_no_permission','cancelled','expired'
  ));

ALTER TABLE public.follow_up_trackers
  DROP CONSTRAINT IF EXISTS follow_up_trackers_action_mode_check;

ALTER TABLE public.follow_up_trackers
  ADD CONSTRAINT follow_up_trackers_action_mode_check
  CHECK (action_mode IN ('label_only','auto_draft','auto_reply'));

-- Helper RPC: read my settings (creates default row if missing)
CREATE OR REPLACE FUNCTION public.get_or_create_follow_up_settings(_connection_id uuid)
RETURNS public.follow_up_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.follow_up_settings;
  _org uuid;
BEGIN
  SELECT * INTO _row FROM public.follow_up_settings
  WHERE connection_id = _connection_id AND user_id = auth.uid();

  IF _row.id IS NULL THEN
    SELECT organization_id INTO _org FROM public.provider_connections
    WHERE id = _connection_id AND user_id = auth.uid();
    IF _org IS NULL THEN
      RAISE EXCEPTION 'Connection not found or not owned by user';
    END IF;
    INSERT INTO public.follow_up_settings (organization_id, user_id, connection_id)
    VALUES (_org, auth.uid(), _connection_id)
    RETURNING * INTO _row;
  END IF;

  RETURN _row;
END;
$$;
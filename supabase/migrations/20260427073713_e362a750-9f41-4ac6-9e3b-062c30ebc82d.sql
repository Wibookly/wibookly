-- About Me fields for AI personalization
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS role_description text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS responsibilities text,
  ADD COLUMN IF NOT EXISTS communication_style text;

-- Per-category AI overrides
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS example_reply_template text,
  ADD COLUMN IF NOT EXISTS additional_context text,
  ADD COLUMN IF NOT EXISTS format_style text;

-- Global AI defaults (per ai_settings row = per connection)
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS example_reply_template text,
  ADD COLUMN IF NOT EXISTS additional_context text,
  ADD COLUMN IF NOT EXISTS format_style text DEFAULT 'concise';

-- Daily Brief Schedule
CREATE TABLE IF NOT EXISTS public.daily_brief_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  connection_id uuid,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  send_time time NOT NULL,
  brief_type text NOT NULL DEFAULT 'morning' CHECK (brief_type IN ('morning','evening')),
  is_enabled boolean NOT NULL DEFAULT true,
  recipient_email text,
  sender_email text NOT NULL DEFAULT 'agent@energyforward.com',
  timezone text NOT NULL DEFAULT 'America/New_York',
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_brief_schedules_user
  ON public.daily_brief_schedules (user_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_daily_brief_schedules_lookup
  ON public.daily_brief_schedules (is_enabled, day_of_week, send_time);

ALTER TABLE public.daily_brief_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own brief schedules" ON public.daily_brief_schedules;
CREATE POLICY "Users manage own brief schedules"
  ON public.daily_brief_schedules
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages brief schedules" ON public.daily_brief_schedules;
CREATE POLICY "Service role manages brief schedules"
  ON public.daily_brief_schedules
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE TRIGGER set_daily_brief_schedules_updated_at
  BEFORE UPDATE ON public.daily_brief_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
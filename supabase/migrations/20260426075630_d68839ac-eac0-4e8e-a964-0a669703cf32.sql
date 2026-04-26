-- 1. New per-email tracker
CREATE TABLE IF NOT EXISTS public.follow_up_trackers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  user_id uuid NOT NULL,
  message_id text NOT NULL,                 -- Graph message id of the sent email
  conversation_id text,                      -- Graph conversation id, used to detect replies
  subject text,
  to_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  bcc_alias text NOT NULL,                   -- e.g. "5@energyforward.com"
  days_after_send integer NOT NULL,          -- 2, 3, 5, 7, 10, 14, ...
  sent_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',    -- pending | replied | drafted | sent | cancelled
  draft_id text,
  drafted_at timestamptz,
  replied_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS follow_up_trackers_msg_alias_idx
  ON public.follow_up_trackers (connection_id, message_id, bcc_alias);

CREATE INDEX IF NOT EXISTS follow_up_trackers_due_idx
  ON public.follow_up_trackers (status, due_at);

CREATE INDEX IF NOT EXISTS follow_up_trackers_org_idx
  ON public.follow_up_trackers (organization_id, status);

ALTER TABLE public.follow_up_trackers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages trackers"
  ON public.follow_up_trackers
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "members view org trackers"
  ON public.follow_up_trackers
  FOR SELECT
  USING (organization_id = public.get_user_organization_id(auth.uid()));

CREATE POLICY "admins manage org trackers"
  ON public.follow_up_trackers
  FOR ALL
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  );

CREATE TRIGGER set_follow_up_trackers_updated_at
  BEFORE UPDATE ON public.follow_up_trackers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Track the dedicated "Follow-up" folder per connection
ALTER TABLE public.provider_connections
  ADD COLUMN IF NOT EXISTS inbox_followup_folder_id text;

-- 3. Drop the old step-based seed data and table; not needed anymore
DROP TABLE IF EXISTS public.follow_up_steps CASCADE;

-- Remove the seeded "Follow-up · 2/5/10 days" categories that the previous attempt created
DELETE FROM public.categories
  WHERE is_follow_up = true
    AND name LIKE 'Follow-up · %';


-- 1) Add holidays + scheduled_send slot for queued sends
ALTER TABLE public.follow_up_settings
  ADD COLUMN IF NOT EXISTS holidays jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.follow_up_trackers
  ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS queued_reason text;

-- 2) Expand status check constraint to add 'queued'
ALTER TABLE public.follow_up_trackers DROP CONSTRAINT IF EXISTS follow_up_trackers_status_check;
ALTER TABLE public.follow_up_trackers ADD CONSTRAINT follow_up_trackers_status_check
  CHECK (status = ANY (ARRAY[
    'pending','drafted','queued','auto_sent','replied','missed',
    'paused_no_permission','cancelled','expired','manually_replied','error'
  ]));

CREATE INDEX IF NOT EXISTS follow_up_trackers_scheduled_idx
  ON public.follow_up_trackers (status, scheduled_send_at)
  WHERE scheduled_send_at IS NOT NULL;

-- 3) Ticket threading
CREATE TABLE IF NOT EXISTS public.support_issue_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.support_issues(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  author_role text NOT NULL DEFAULT 'user' CHECK (author_role IN ('user','admin','super_admin')),
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_issue_messages TO authenticated;
GRANT ALL ON public.support_issue_messages TO service_role;

ALTER TABLE public.support_issue_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket participants read messages"
  ON public.support_issue_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_issues si
      WHERE si.id = issue_id
        AND (
          si.user_id = auth.uid()
          OR si.organization_id = public.get_user_organization_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::app_role)
          OR public.is_current_user_super_admin()
        )
    )
  );

CREATE POLICY "ticket participants insert messages"
  ON public.support_issue_messages FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_issues si
      WHERE si.id = issue_id
        AND (
          si.user_id = auth.uid()
          OR si.organization_id = public.get_user_organization_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::app_role)
          OR public.is_current_user_super_admin()
        )
    )
  );

CREATE INDEX IF NOT EXISTS support_issue_messages_issue_idx
  ON public.support_issue_messages (issue_id, created_at);

-- 4) Per-user read receipts for unread-bell badge
CREATE TABLE IF NOT EXISTS public.support_issue_reads (
  issue_id uuid NOT NULL REFERENCES public.support_issues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_issue_reads TO authenticated;
GRANT ALL ON public.support_issue_reads TO service_role;

ALTER TABLE public.support_issue_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own read marks"
  ON public.support_issue_reads FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS support_issue_reads_user_idx
  ON public.support_issue_reads (user_id);

-- 5) Allow user to reopen / mark their own ticket
DROP POLICY IF EXISTS "users update own issues" ON public.support_issues;
CREATE POLICY "users update own issues"
  ON public.support_issues FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

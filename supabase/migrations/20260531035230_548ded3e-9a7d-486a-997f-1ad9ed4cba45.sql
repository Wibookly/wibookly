
-- 1) Privilege escalation: drop the self-assign member role insert policy
DROP POLICY IF EXISTS "Users can self-assign member role only" ON public.user_roles;

-- 2) agent_messages: replace admin-wide SELECT with owner-only SELECT
DROP POLICY IF EXISTS "admins can view org agent messages" ON public.agent_messages;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='agent_messages'
      AND policyname='Users can view their own agent messages'
  ) THEN
    CREATE POLICY "Users can view their own agent messages"
      ON public.agent_messages
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.provider_connections pc
          WHERE pc.user_id = auth.uid()
            AND lower(pc.connected_email) = lower(agent_messages.sender_email)
        )
        OR public.is_current_user_super_admin()
      );
  END IF;
END $$;

-- 3) follow_up_trackers: split the broad admin policy so admin SELECT is owner-only
DROP POLICY IF EXISTS "admins manage org trackers" ON public.follow_up_trackers;

CREATE POLICY "admins modify org trackers (non-select)"
  ON public.follow_up_trackers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND organization_id = public.get_user_organization_id(auth.uid())
  );

CREATE POLICY "admins update org trackers"
  ON public.follow_up_trackers
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND organization_id = public.get_user_organization_id(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND organization_id = public.get_user_organization_id(auth.uid())
  );

CREATE POLICY "admins delete org trackers"
  ON public.follow_up_trackers
  FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND organization_id = public.get_user_organization_id(auth.uid())
  );
-- Note: no admin SELECT policy is recreated. Existing owner-scoped SELECT policy
-- continues to allow users to read their own trackers; super_admin retains access via
-- existing super-admin policies if present.

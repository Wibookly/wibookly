-- Restrict agent_settings SELECT to admins; non-admin members no longer see internal M365 identifiers.
DROP POLICY IF EXISTS "members can view org agent settings" ON public.agent_settings;

CREATE POLICY "admins can view org agent settings"
ON public.agent_settings
FOR SELECT
TO authenticated
USING (
  organization_id = get_user_organization_id(auth.uid())
  AND has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);
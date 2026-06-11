
-- 1) alert_recipients: add an explicit RESTRICTIVE policy so only the super admin
--    can ever access this table, regardless of any future permissive policy.
DROP POLICY IF EXISTS "Restrict alert_recipients to super admin" ON public.alert_recipients;
CREATE POLICY "Restrict alert_recipients to super admin"
  ON public.alert_recipients
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (public.is_current_user_super_admin())
  WITH CHECK (public.is_current_user_super_admin());

-- 2) subscriptions: tighten SELECT so only org admins (not every member who owns
--    a row) can read Stripe customer / subscription identifiers.
DROP POLICY IF EXISTS "Org admins view subscription" ON public.subscriptions;
CREATE POLICY "Org admins view subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
  );

-- 3) user_roles: scope every policy to the authenticated role so anonymous
--    requests are explicitly rejected at the role layer, not just by NULL
--    short-circuiting inside the helper functions.
DROP POLICY IF EXISTS "Org admins can insert roles in their org" ON public.user_roles;
CREATE POLICY "Org admins can insert roles in their org"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
  );

DROP POLICY IF EXISTS "Users can view roles in their organization" ON public.user_roles;
CREATE POLICY "Users can view roles in their organization"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (organization_id = public.get_user_organization_id(auth.uid()));

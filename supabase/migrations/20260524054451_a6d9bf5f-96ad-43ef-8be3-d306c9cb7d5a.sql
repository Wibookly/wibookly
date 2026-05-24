DROP POLICY IF EXISTS "Org admins can insert roles in their org" ON public.user_roles;
CREATE POLICY "Org admins can insert roles in their org"
ON public.user_roles
FOR INSERT
WITH CHECK (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
);
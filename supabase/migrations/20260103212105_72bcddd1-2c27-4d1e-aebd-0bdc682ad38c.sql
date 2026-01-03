-- Add explicit DELETE and UPDATE policies for user_roles table
-- Only organization admins can delete or update roles (defense-in-depth)

CREATE POLICY "Only admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Only admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role(auth.uid(), 'admin')
);
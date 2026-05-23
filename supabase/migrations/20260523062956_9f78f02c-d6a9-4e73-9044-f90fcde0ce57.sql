
-- Helper: is_current_user_super_admin (looks up caller's email)
CREATE OR REPLACE FUNCTION public.is_current_user_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin(COALESCE((SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1), ''))
$$;

-- 1) allowed_domains: restrict admin policies to super admin only (global table, no org scope)
DROP POLICY IF EXISTS "Admins can manage domains" ON public.allowed_domains;
DROP POLICY IF EXISTS "Admins can view domains" ON public.allowed_domains;

CREATE POLICY "Super admin can manage domains"
ON public.allowed_domains
FOR ALL
TO authenticated
USING (public.is_current_user_super_admin())
WITH CHECK (public.is_current_user_super_admin());

-- 2) user_feature_access: scope admin manage policy to the row's organization
DROP POLICY IF EXISTS "Admins can manage feature access" ON public.user_feature_access;

CREATE POLICY "Org admins manage feature access"
ON public.user_feature_access
FOR ALL
TO authenticated
USING (public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id))
WITH CHECK (public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id));

-- 3) tool_diagnostics: scope admin policy to the row's organization
DROP POLICY IF EXISTS "Admins read all tool_diagnostics" ON public.tool_diagnostics;

CREATE POLICY "Org admins read tool_diagnostics"
ON public.tool_diagnostics
FOR SELECT
TO authenticated
USING (
  organization_id IS NOT NULL
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);

-- 4) extraction_regression_log: super admin only (no org column)
DROP POLICY IF EXISTS "Admins read all regression log" ON public.extraction_regression_log;

CREATE POLICY "Super admin reads regression log"
ON public.extraction_regression_log
FOR SELECT
TO authenticated
USING (public.is_current_user_super_admin());

-- 5) user_roles: remove the admin self-bootstrap path; only allow self-assigning 'member'.
--    Admin roles must be created by service_role (server-side flow) or by existing org admins.
DROP POLICY IF EXISTS "Users can insert their role with restrictions" ON public.user_roles;

CREATE POLICY "Users can self-assign member role only"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND role = 'member'::app_role
  AND public.is_org_member(auth.uid(), organization_id)
);

-- Allow existing org admins to grant roles within their own organization
CREATE POLICY "Org admins can insert roles in their org"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);

-- 6) user_profiles: allow users to read their own profile row directly
DROP POLICY IF EXISTS "no_direct_profile_select" ON public.user_profiles;

CREATE POLICY "Users can read own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

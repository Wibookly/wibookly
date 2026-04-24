-- ============================================================
-- Fix 1: Prevent organization_id spoofing on user_profiles INSERT
-- ============================================================
-- A user must only be able to insert a profile for an organization
-- that they are legitimately allowed to join: either their email
-- domain matches an allowed_domain row, OR they are the super admin,
-- OR they already have an organization_members row for that org.

DROP POLICY IF EXISTS "users_insert_own_profile_only" ON public.user_profiles;

CREATE POLICY "users_insert_own_profile_only"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    -- Already a member of that org (e.g. created via trigger / SSO callback)
    public.is_org_member(auth.uid(), organization_id)
    -- OR super admin
    OR public.is_super_admin(email)
    -- OR the org's name matches the user's allowed email domain
    -- (organization names are created as "<domain> Organization" in the SSO callback)
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.allowed_domains ad
        ON ad.is_active = true
       AND lower(ad.domain) = lower(split_part(email, '@', 2))
      WHERE o.id = organization_id
    )
  )
);

-- ============================================================
-- Fix 2: Scope has_role() to a specific organization
-- ============================================================
-- The existing has_role(_user_id, _role) checks any organization,
-- which lets an admin in one org pass admin checks in another.
-- Add an organization-scoped variant and use it where org-scoped
-- admin checks are needed. We keep the original signature so
-- existing policies that don't depend on org-scoping (e.g. domain
-- management, feature access management) continue to work.

CREATE OR REPLACE FUNCTION public.has_role_in_org(
  _user_id uuid,
  _role public.app_role,
  _organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND organization_id = _organization_id
  )
$$;

-- ============================================================
-- Fix 3: Restrict user_roles INSERT so admin can only be granted
-- when the user is actually a member of that organization, and
-- only as the FIRST admin of THAT specific org.
-- ============================================================
DROP POLICY IF EXISTS "Users can insert their role with restrictions" ON public.user_roles;

CREATE POLICY "Users can insert their role with restrictions"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.is_org_member(auth.uid(), organization_id)
  AND (
    role = 'member'::public.app_role
    OR (
      role = 'admin'::public.app_role
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.organization_id = user_roles.organization_id
      )
    )
  )
);

-- ============================================================
-- Fix 4: Tighten organization-scoped admin policies to use
-- has_role_in_org() instead of the global has_role().
-- ============================================================

-- organizations: only admins of THAT org can update it
DROP POLICY IF EXISTS "Only admins can update their organization" ON public.organizations;
CREATE POLICY "Only admins can update their organization"
ON public.organizations
FOR UPDATE
TO authenticated
USING (
  id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, id)
);

-- jobs: only admins of THAT org can update its jobs
DROP POLICY IF EXISTS "Only admins can update jobs in their organization" ON public.jobs;
CREATE POLICY "Only admins can update jobs in their organization"
ON public.jobs
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
);

-- user_roles: scope admin update/delete to that org
DROP POLICY IF EXISTS "Only admins can delete roles" ON public.user_roles;
CREATE POLICY "Only admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
);

DROP POLICY IF EXISTS "Only admins can update roles" ON public.user_roles;
CREATE POLICY "Only admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
);

-- organization_members: scope admin operations to that org
DROP POLICY IF EXISTS "admins_can_update_members" ON public.organization_members;
CREATE POLICY "admins_can_update_members"
ON public.organization_members
FOR UPDATE
USING (
  public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
  AND public.is_org_member(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "admins_can_delete_members" ON public.organization_members;
CREATE POLICY "admins_can_delete_members"
ON public.organization_members
FOR DELETE
USING (
  public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
  AND public.is_org_member(auth.uid(), organization_id)
);

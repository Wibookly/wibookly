DROP POLICY IF EXISTS "super admin can view all groups" ON public.permission_groups;
CREATE POLICY "super admin can view all groups"
ON public.permission_groups
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "super admin can manage all groups" ON public.permission_groups;
CREATE POLICY "super admin can manage all groups"
ON public.permission_groups
FOR ALL
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
)
WITH CHECK (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "super admin can view all group features" ON public.group_features;
CREATE POLICY "super admin can view all group features"
ON public.group_features
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "super admin can manage all group features" ON public.group_features;
CREATE POLICY "super admin can manage all group features"
ON public.group_features
FOR ALL
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
)
WITH CHECK (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "super admin can view all group cost caps" ON public.group_cost_caps;
CREATE POLICY "super admin can view all group cost caps"
ON public.group_cost_caps
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "super admin can manage all group cost caps" ON public.group_cost_caps;
CREATE POLICY "super admin can manage all group cost caps"
ON public.group_cost_caps
FOR ALL
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
)
WITH CHECK (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "super admin can view all memberships" ON public.user_group_memberships;
CREATE POLICY "super admin can view all memberships"
ON public.user_group_memberships
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "super admin can manage all memberships" ON public.user_group_memberships;
CREATE POLICY "super admin can manage all memberships"
ON public.user_group_memberships
FOR ALL
TO authenticated
USING (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
)
WITH CHECK (
  public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
  )
);
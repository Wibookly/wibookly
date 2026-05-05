
-- Fix super admin RLS policies: subquery to user_profiles fails because user_profiles SELECT is locked.
-- Read email directly from JWT instead.

DROP POLICY IF EXISTS "super admin can view all groups" ON public.permission_groups;
DROP POLICY IF EXISTS "super admin can manage all groups" ON public.permission_groups;
CREATE POLICY "super admin can view all groups" ON public.permission_groups
  FOR SELECT USING (public.is_super_admin((auth.jwt() ->> 'email')));
CREATE POLICY "super admin can manage all groups" ON public.permission_groups
  FOR ALL USING (public.is_super_admin((auth.jwt() ->> 'email')))
  WITH CHECK (public.is_super_admin((auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "super admin can view all group features" ON public.group_features;
DROP POLICY IF EXISTS "super admin can manage all group features" ON public.group_features;
CREATE POLICY "super admin can view all group features" ON public.group_features
  FOR SELECT USING (public.is_super_admin((auth.jwt() ->> 'email')));
CREATE POLICY "super admin can manage all group features" ON public.group_features
  FOR ALL USING (public.is_super_admin((auth.jwt() ->> 'email')))
  WITH CHECK (public.is_super_admin((auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "super admin can view all memberships" ON public.user_group_memberships;
DROP POLICY IF EXISTS "super admin can manage all memberships" ON public.user_group_memberships;
CREATE POLICY "super admin can view all memberships" ON public.user_group_memberships
  FOR SELECT USING (public.is_super_admin((auth.jwt() ->> 'email')));
CREATE POLICY "super admin can manage all memberships" ON public.user_group_memberships
  FOR ALL USING (public.is_super_admin((auth.jwt() ->> 'email')))
  WITH CHECK (public.is_super_admin((auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "super admin can view all group cost caps" ON public.group_cost_caps;
DROP POLICY IF EXISTS "super admin can manage all group cost caps" ON public.group_cost_caps;
CREATE POLICY "super admin can view all group cost caps" ON public.group_cost_caps
  FOR SELECT USING (public.is_super_admin((auth.jwt() ->> 'email')));
CREATE POLICY "super admin can manage all group cost caps" ON public.group_cost_caps
  FOR ALL USING (public.is_super_admin((auth.jwt() ->> 'email')))
  WITH CHECK (public.is_super_admin((auth.jwt() ->> 'email')));

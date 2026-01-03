-- Fix 1: Jobs UPDATE policy - allow service role (edge functions) to update
-- The previous policy blocked ALL updates which breaks background job processing
DROP POLICY IF EXISTS "Users cannot update jobs directly" ON public.jobs;

-- Allow only admin users to update jobs in their organization
-- Edge functions use service role which bypasses RLS entirely
CREATE POLICY "Only admins can update jobs in their organization"
ON public.jobs
FOR UPDATE
TO authenticated
USING (
  organization_id = get_user_organization_id(auth.uid()) 
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Fix 2: Organizations UPDATE - restrict to admin role only
DROP POLICY IF EXISTS "Users can update their own organization" ON public.organizations;

CREATE POLICY "Only admins can update their organization"
ON public.organizations
FOR UPDATE
TO authenticated
USING (
  id = get_user_organization_id(auth.uid()) 
  AND has_role(auth.uid(), 'admin'::app_role)
);
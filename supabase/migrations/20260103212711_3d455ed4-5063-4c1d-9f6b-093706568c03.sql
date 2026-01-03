-- Fix jobs table RLS: users should only see their own jobs
-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view jobs in their organization" ON public.jobs;

-- Create restrictive SELECT policy - users only see their own jobs
CREATE POLICY "Users can view their own jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND user_id = auth.uid()
);

-- Add DELETE policy for job cleanup
CREATE POLICY "Users can delete their own jobs"
ON public.jobs
FOR DELETE
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND user_id = auth.uid()
);
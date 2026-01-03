-- CRITICAL: Fix privilege escalation in user_roles table
-- Users could assign themselves 'admin' role during signup

-- Drop the existing permissive INSERT policy
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;

-- Create a new INSERT policy that ONLY allows inserting 'member' role
CREATE POLICY "Users can only insert member role for themselves"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() 
  AND role = 'member'::app_role
);

-- ALSO: Fix jobs table - prevent users from manipulating status fields
-- Drop existing overly permissive UPDATE policy
DROP POLICY IF EXISTS "Users can update jobs in their organization" ON public.jobs;

-- Create restrictive UPDATE policy - users can only update specific safe fields
-- In this case, we prevent status manipulation by not allowing UPDATE at all for regular users
-- Status transitions should be handled by server-side functions
CREATE POLICY "Users cannot update jobs directly"
ON public.jobs
FOR UPDATE
TO authenticated
USING (false);

-- Jobs status should be managed by admin/system only via edge functions with service role
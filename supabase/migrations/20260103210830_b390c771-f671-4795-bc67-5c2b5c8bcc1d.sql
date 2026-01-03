-- Fix 1: Add UPDATE policy for jobs table so sync status updates work
CREATE POLICY "Users can update jobs in their organization"
ON public.jobs
FOR UPDATE
TO authenticated
USING (organization_id = public.get_user_organization_id(auth.uid()) AND user_id = auth.uid());

-- Fix 2: Restrict provider_connections SELECT to only show own tokens
-- Drop the overly permissive organization-wide policy for sensitive token data
DROP POLICY IF EXISTS "Users can view connections in their organization" ON public.provider_connections;

-- Create a new policy that only allows users to see their own connections (with tokens)
CREATE POLICY "Users can view their own connections"
ON public.provider_connections
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
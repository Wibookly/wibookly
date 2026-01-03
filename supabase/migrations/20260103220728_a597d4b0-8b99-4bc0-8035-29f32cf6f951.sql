-- Fix: Allow inserting 'admin' role for the first user in an organization
-- The first user who creates an organization should automatically become admin
-- Subsequent users (invited) get 'member' role only

DROP POLICY IF EXISTS "Users can only insert member role for themselves" ON public.user_roles;

-- Create a policy that allows:
-- 1. Inserting 'admin' role if no other users exist in the organization
-- 2. Inserting 'member' role for any subsequent users
CREATE POLICY "Users can insert their role with restrictions"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    -- Allow 'admin' only if this is the first user in the organization (founder)
    (role = 'admin'::app_role AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.organization_id = user_roles.organization_id
    ))
    OR
    -- Allow 'member' for any subsequent user
    role = 'member'::app_role
  )
);
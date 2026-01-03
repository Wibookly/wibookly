-- Fix user_profiles RLS: users should only see their own profile
-- Drop existing permissive SELECT policy that exposes emails to organization members
DROP POLICY IF EXISTS "Users can view profiles in their organization" ON public.user_profiles;

-- Create restrictive SELECT policy - users only see their own profile
CREATE POLICY "Users can view their own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
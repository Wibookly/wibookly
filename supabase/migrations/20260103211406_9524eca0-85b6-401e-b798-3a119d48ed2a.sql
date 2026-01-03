-- Fix 1: Restrict organization creation to users who don't already have one
-- This prevents race conditions and multiple organization creation
DROP POLICY IF EXISTS "Allow insert during signup" ON public.organizations;

CREATE POLICY "Allow insert during signup only once"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (
  NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid()
  )
);
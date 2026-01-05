-- Fix processed_emails security: remove overly permissive policy and add proper user-scoped policies
DROP POLICY IF EXISTS "Service role can manage processed emails" ON public.processed_emails;

-- Users can insert their own processed emails
CREATE POLICY "Users can insert their own processed emails"
ON public.processed_emails
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own processed emails
CREATE POLICY "Users can update their own processed emails"
ON public.processed_emails
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own processed emails
CREATE POLICY "Users can delete their own processed emails"
ON public.processed_emails
FOR DELETE
USING (auth.uid() = user_id);

-- Add title field to user_profiles for email signatures
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS title TEXT;
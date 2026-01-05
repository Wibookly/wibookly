-- Add signature_enabled column to email_profiles table
-- Default is FALSE (signature from app is NOT used by default)
ALTER TABLE public.email_profiles 
ADD COLUMN signature_enabled BOOLEAN NOT NULL DEFAULT FALSE;
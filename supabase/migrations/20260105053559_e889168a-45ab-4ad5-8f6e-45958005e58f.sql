-- Add email_signature column to user_profiles table
ALTER TABLE public.user_profiles 
ADD COLUMN email_signature text;
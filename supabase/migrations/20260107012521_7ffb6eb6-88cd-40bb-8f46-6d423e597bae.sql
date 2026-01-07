-- Add default_meeting_duration column to email_profiles (in minutes)
ALTER TABLE public.email_profiles 
ADD COLUMN IF NOT EXISTS default_meeting_duration integer NOT NULL DEFAULT 30;

-- Add a comment explaining the column
COMMENT ON COLUMN public.email_profiles.default_meeting_duration IS 'Default meeting duration in minutes (e.g., 30, 45, 60)';
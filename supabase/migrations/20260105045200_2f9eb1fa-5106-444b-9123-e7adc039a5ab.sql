-- Add AI label color columns to ai_settings table
ALTER TABLE public.ai_settings 
ADD COLUMN IF NOT EXISTS ai_draft_label_color TEXT DEFAULT '#3B82F6',
ADD COLUMN IF NOT EXISTS ai_sent_label_color TEXT DEFAULT '#F97316';

-- Add comment for documentation
COMMENT ON COLUMN public.ai_settings.ai_draft_label_color IS 'Color for AI Draft label in email providers';
COMMENT ON COLUMN public.ai_settings.ai_sent_label_color IS 'Color for AI Sent label in email providers';
-- Add AI calendar event color to ai_settings table
ALTER TABLE public.ai_settings 
ADD COLUMN IF NOT EXISTS ai_calendar_event_color text DEFAULT '#9333EA';

COMMENT ON COLUMN public.ai_settings.ai_calendar_event_color IS 'Color for AI-created calendar events/appointments';
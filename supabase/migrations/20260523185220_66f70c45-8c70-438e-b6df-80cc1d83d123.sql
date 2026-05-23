
ALTER TABLE public.meeting_copilot_settings
  ADD COLUMN IF NOT EXISTS notify_scheduled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_detected boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS microphone_device_id text,
  ADD COLUMN IF NOT EXISTS shortcuts jsonb NOT NULL DEFAULT '{"ask":"Ctrl+Shift+A","answer":"Ctrl+Shift+R","say":"Ctrl+Shift+S","end":"Ctrl+Shift+E"}'::jsonb;

ALTER TABLE public.meeting_copilot_preferences
  ADD COLUMN IF NOT EXISTS tone_override text;

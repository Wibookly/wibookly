-- 1. AI Profile
CREATE TABLE IF NOT EXISTS public.user_ai_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text,
  responsibilities text,
  communication_style text,
  custom_context text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE public.user_ai_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own AI profile" ON public.user_ai_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_user_ai_profiles_updated
  BEFORE UPDATE ON public.user_ai_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Copilot settings
CREATE TABLE IF NOT EXISTS public.meeting_copilot_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_join_all boolean NOT NULL DEFAULT false,
  show_live_suggestions boolean NOT NULL DEFAULT true,
  auto_draft_followup boolean NOT NULL DEFAULT true,
  suggestion_style text NOT NULL DEFAULT 'concise' CHECK (suggestion_style IN ('concise','conversational','strategic')),
  save_transcripts boolean NOT NULL DEFAULT true,
  transcript_retention_days int NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE public.meeting_copilot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own copilot settings" ON public.meeting_copilot_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_meeting_copilot_settings_updated
  BEFORE UPDATE ON public.meeting_copilot_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Per-meeting preferences
CREATE TABLE IF NOT EXISTS public.meeting_copilot_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meeting_external_id text NOT NULL,
  copilot_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, meeting_external_id)
);
ALTER TABLE public.meeting_copilot_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meeting preferences" ON public.meeting_copilot_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Meeting sessions
CREATE TABLE IF NOT EXISTS public.meeting_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meeting_external_id text,
  meeting_title text NOT NULL,
  platform text CHECK (platform IN ('teams','zoom','meet','webex','other')),
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds int,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meeting sessions" ON public.meeting_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Transcripts
CREATE TABLE IF NOT EXISTS public.meeting_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.meeting_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  speaker text,
  speaker_color text,
  text text NOT NULL,
  spoken_at timestamptz NOT NULL DEFAULT now(),
  is_final boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own transcripts" ON public.meeting_transcripts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_session ON public.meeting_transcripts(session_id, spoken_at);

-- 6. Suggestions
CREATE TABLE IF NOT EXISTS public.meeting_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.meeting_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suggestion_type text CHECK (suggestion_type IN ('say','ask','fact','answer','recap')),
  content text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own suggestions" ON public.meeting_suggestions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. Action items
CREATE TABLE IF NOT EXISTS public.meeting_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.meeting_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description text NOT NULL,
  assigned_to text,
  due_date date,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own action items" ON public.meeting_action_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 8. Cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_meeting_transcripts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.meeting_transcripts t
  USING public.meeting_copilot_settings s
  WHERE s.user_id = t.user_id
    AND t.created_at < now() - (s.transcript_retention_days || ' days')::interval;
END;
$$;
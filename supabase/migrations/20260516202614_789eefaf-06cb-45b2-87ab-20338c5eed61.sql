ALTER TABLE public.meeting_transcripts REPLICA IDENTITY FULL;
ALTER TABLE public.meeting_suggestions REPLICA IDENTITY FULL;
ALTER TABLE public.meeting_sessions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_transcripts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_suggestions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_sessions;
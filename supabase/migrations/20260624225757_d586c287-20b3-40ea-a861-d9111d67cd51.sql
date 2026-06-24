GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_up_settings TO authenticated;
GRANT ALL ON public.follow_up_settings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_up_trackers TO authenticated;
GRANT ALL ON public.follow_up_trackers TO service_role;
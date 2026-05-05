
-- Add missing columns to ai_usage_logs for the AI Usage admin tab
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS domain_id uuid REFERENCES public.allowed_domains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.permission_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS block_reason text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS latency_ms integer;

-- Helpful indexes for the dashboard queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_org_created ON public.ai_usage_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_created ON public.ai_usage_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_status ON public.ai_usage_logs (status);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_action ON public.ai_usage_logs (action);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_group ON public.ai_usage_logs (group_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_domain ON public.ai_usage_logs (domain_id);

-- Backfill group_id and domain_id from user_profiles where possible
UPDATE public.ai_usage_logs l
SET group_id = COALESCE(l.group_id, (
  SELECT ugm.group_id FROM public.user_group_memberships ugm
  JOIN public.permission_groups pg ON pg.id = ugm.group_id
  WHERE ugm.user_id = l.user_id AND pg.organization_id = l.organization_id
  ORDER BY pg.display_order DESC LIMIT 1
)),
domain_id = COALESCE(l.domain_id, (
  SELECT up.domain_id FROM public.user_profiles up WHERE up.user_id = l.user_id LIMIT 1
))
WHERE l.user_id IS NOT NULL AND (l.group_id IS NULL OR l.domain_id IS NULL);

-- Enable Realtime for the AI Usage tab live feed
ALTER TABLE public.ai_usage_logs REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_usage_logs';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

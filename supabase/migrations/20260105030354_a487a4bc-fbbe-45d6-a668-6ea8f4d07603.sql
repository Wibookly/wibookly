-- Create table to track AI activity (drafts and auto-replies)
CREATE TABLE public.ai_activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('draft', 'auto_reply')),
  email_subject TEXT,
  email_from TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_ai_activity_logs_org_date ON public.ai_activity_logs(organization_id, created_at DESC);
CREATE INDEX idx_ai_activity_logs_user_date ON public.ai_activity_logs(user_id, created_at DESC);
CREATE INDEX idx_ai_activity_logs_type ON public.ai_activity_logs(activity_type);

-- Enable RLS
ALTER TABLE public.ai_activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can view AI activity in their organization
CREATE POLICY "Users can view AI activity in their organization"
ON public.ai_activity_logs
FOR SELECT
USING (organization_id = get_user_organization_id(auth.uid()));

-- Service role can insert (edge functions will log activity)
-- No direct client insert - only edge functions with service role can log
CREATE POLICY "No client insert for AI activity logs"
ON public.ai_activity_logs
FOR INSERT
WITH CHECK (false);
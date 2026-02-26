
-- Feature access table: admin assigns features to users
CREATE TABLE public.user_feature_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  feature_key TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  granted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, feature_key)
);

-- Enable RLS
ALTER TABLE public.user_feature_access ENABLE ROW LEVEL SECURITY;

-- Users can view their own feature access
CREATE POLICY "Users can view own feature access"
ON public.user_feature_access
FOR SELECT
USING (user_id = auth.uid());

-- Super admin (via service role in edge functions) or admin can manage all
CREATE POLICY "Admins can manage feature access"
ON public.user_feature_access
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to check if a user has a specific feature
CREATE OR REPLACE FUNCTION public.has_feature(_user_id UUID, _feature_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_feature_access
    WHERE user_id = _user_id
      AND feature_key = _feature_key
      AND is_enabled = true
  )
  OR public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = _user_id LIMIT 1)
  )
$$;

-- Trigger for updated_at
CREATE TRIGGER update_user_feature_access_updated_at
BEFORE UPDATE ON public.user_feature_access
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

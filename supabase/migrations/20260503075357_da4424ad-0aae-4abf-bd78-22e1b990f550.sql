CREATE TABLE public.group_cost_caps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.permission_groups(id) ON DELETE CASCADE,
  per_request_usd DECIMAL(10,4),
  per_user_daily_usd DECIMAL(10,2),
  per_user_monthly_usd DECIMAL(10,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id)
);

ALTER TABLE public.group_cost_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages cost caps"
ON public.group_cost_caps
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admins manage cost caps in their org"
ON public.group_cost_caps
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.permission_groups g
  WHERE g.id = group_cost_caps.group_id
    AND g.organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.permission_groups g
  WHERE g.id = group_cost_caps.group_id
    AND g.organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
));

CREATE POLICY "members view cost caps in their org"
ON public.group_cost_caps
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.permission_groups g
  WHERE g.id = group_cost_caps.group_id
    AND g.organization_id = public.get_user_organization_id(auth.uid())
));
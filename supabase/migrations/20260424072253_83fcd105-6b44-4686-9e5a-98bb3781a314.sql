-- 1. permission_groups: a named bundle of features per organization
CREATE TABLE public.permission_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (organization_id, name)
);

ALTER TABLE public.permission_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view groups in their org"
ON public.permission_groups FOR SELECT
USING (organization_id = public.get_user_organization_id(auth.uid()));

CREATE POLICY "admins can manage groups in their org"
ON public.permission_groups FOR ALL
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
)
WITH CHECK (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);

CREATE TRIGGER permission_groups_set_updated_at
BEFORE UPDATE ON public.permission_groups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. group_features: which features a group grants
CREATE TABLE public.group_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.permission_groups(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, feature_key)
);

ALTER TABLE public.group_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view group features in their org"
ON public.group_features FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.permission_groups g
  WHERE g.id = group_features.group_id
    AND g.organization_id = public.get_user_organization_id(auth.uid())
));

CREATE POLICY "admins can manage group features in their org"
ON public.group_features FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.permission_groups g
  WHERE g.id = group_features.group_id
    AND g.organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.permission_groups g
  WHERE g.id = group_features.group_id
    AND g.organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
));

CREATE TRIGGER group_features_set_updated_at
BEFORE UPDATE ON public.group_features
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. user_group_memberships: which users belong to which groups
CREATE TABLE public.user_group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.permission_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (group_id, user_id)
);

ALTER TABLE public.user_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_user_group_memberships_user ON public.user_group_memberships(user_id);
CREATE INDEX idx_user_group_memberships_group ON public.user_group_memberships(group_id);

CREATE POLICY "members can view memberships in their org"
ON public.user_group_memberships FOR SELECT
USING (organization_id = public.get_user_organization_id(auth.uid()));

CREATE POLICY "admins can manage memberships in their org"
ON public.user_group_memberships FOR ALL
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
)
WITH CHECK (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);

-- 4. Update has_feature() so group memberships also grant features
CREATE OR REPLACE FUNCTION public.has_feature(_user_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    -- Direct per-user grant
    EXISTS (
      SELECT 1 FROM public.user_feature_access
      WHERE user_id = _user_id
        AND feature_key = _feature_key
        AND is_enabled = true
    )
    -- Group-based grant
    OR EXISTS (
      SELECT 1
      FROM public.user_group_memberships m
      JOIN public.group_features gf ON gf.group_id = m.group_id
      WHERE m.user_id = _user_id
        AND gf.feature_key = _feature_key
        AND gf.is_enabled = true
    )
    -- Super admin bypass
    OR public.is_super_admin(
      (SELECT email FROM public.user_profiles WHERE user_id = _user_id LIMIT 1)
    );
$$;
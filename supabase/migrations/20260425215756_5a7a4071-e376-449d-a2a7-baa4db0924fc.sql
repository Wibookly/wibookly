-- ============================================================
-- Per-domain overrides for global permission groups
-- ============================================================
-- A global group (permission_groups.domain_id IS NULL) applies to every
-- domain in the org. Sometimes admins want to keep the same group but
-- enable/disable a specific feature only for one domain — that's what
-- this table is for. Rows here win over the group's own group_features
-- entry for users on that domain.

CREATE TABLE IF NOT EXISTS public.group_feature_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.permission_groups(id) ON DELETE CASCADE,
  domain_id uuid NOT NULL REFERENCES public.allowed_domains(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_feature_overrides_unique UNIQUE (group_id, domain_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_group_feature_overrides_group ON public.group_feature_overrides(group_id);
CREATE INDEX IF NOT EXISTS idx_group_feature_overrides_domain ON public.group_feature_overrides(domain_id);

ALTER TABLE public.group_feature_overrides ENABLE ROW LEVEL SECURITY;

-- Admins of the group's organization can read overrides
CREATE POLICY "admins can view overrides in their org"
ON public.group_feature_overrides
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.permission_groups g
    WHERE g.id = group_feature_overrides.group_id
      AND g.organization_id = public.get_user_organization_id(auth.uid())
      AND public.has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
  )
);

-- Admins of the group's organization can write overrides
CREATE POLICY "admins can manage overrides in their org"
ON public.group_feature_overrides
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.permission_groups g
    WHERE g.id = group_feature_overrides.group_id
      AND g.organization_id = public.get_user_organization_id(auth.uid())
      AND public.has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.permission_groups g
    WHERE g.id = group_feature_overrides.group_id
      AND g.organization_id = public.get_user_organization_id(auth.uid())
      AND public.has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
  )
);

-- Service role full access (used by admin-api edge function)
CREATE POLICY "service role manages overrides"
ON public.group_feature_overrides
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Updated-at trigger
DROP TRIGGER IF EXISTS group_feature_overrides_updated_at ON public.group_feature_overrides;
CREATE TRIGGER group_feature_overrides_updated_at
BEFORE UPDATE ON public.group_feature_overrides
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Update has_feature() to honor per-domain overrides
-- ============================================================
-- Order of precedence (first match wins):
--   1. Per-user grant (user_feature_access)
--   2. Per-domain override of a group the user belongs to
--   3. Group feature setting for a group the user belongs to
--   4. Super admin bypass
CREATE OR REPLACE FUNCTION public.has_feature(_user_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH user_domain AS (
    SELECT domain_id
    FROM public.user_profiles
    WHERE user_id = _user_id
    LIMIT 1
  )
  SELECT
    -- 1. Direct per-user grant
    EXISTS (
      SELECT 1 FROM public.user_feature_access
      WHERE user_id = _user_id
        AND feature_key = _feature_key
        AND is_enabled = true
    )
    -- 2. Per-domain override on a group the user belongs to
    OR (
      SELECT COALESCE(
        (
          SELECT bool_or(gfo.is_enabled)
          FROM public.user_group_memberships m
          JOIN public.group_feature_overrides gfo
            ON gfo.group_id = m.group_id
           AND gfo.feature_key = _feature_key
          WHERE m.user_id = _user_id
            AND gfo.domain_id = (SELECT domain_id FROM user_domain)
            AND (SELECT domain_id FROM user_domain) IS NOT NULL
        ),
        false
      )
    )
    -- 3. Plain group feature (only counted when no override exists for this user's domain)
    OR EXISTS (
      SELECT 1
      FROM public.user_group_memberships m
      JOIN public.group_features gf ON gf.group_id = m.group_id
      WHERE m.user_id = _user_id
        AND gf.feature_key = _feature_key
        AND gf.is_enabled = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.group_feature_overrides gfo
          WHERE gfo.group_id = m.group_id
            AND gfo.feature_key = _feature_key
            AND gfo.domain_id = (SELECT domain_id FROM user_domain)
        )
    )
    -- 4. Super admin bypass
    OR public.is_super_admin(
      (SELECT email FROM public.user_profiles WHERE user_id = _user_id LIMIT 1)
    );
$function$;

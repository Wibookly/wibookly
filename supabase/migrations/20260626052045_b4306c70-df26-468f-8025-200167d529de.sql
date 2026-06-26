
-- Phase 5: per-organization environment (Microsoft / Google) credentials
CREATE TABLE IF NOT EXISTS public.org_environment_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('microsoft','google')),
  tenant_id text,                          -- Microsoft tenant id ("common" allowed)
  client_id text NOT NULL,
  client_secret_encrypted text NOT NULL,   -- AES-GCM (TOKEN_ENCRYPTION_KEY)
  status text NOT NULL DEFAULT 'configured' CHECK (status IN ('configured','connected','disabled','error')),
  last_error text,
  last_test_at timestamptz,
  connected_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

GRANT ALL ON public.org_environment_credentials TO service_role;
-- NO client-side access: secrets are server-only.

ALTER TABLE public.org_environment_credentials ENABLE ROW LEVEL SECURITY;

-- Service role only (no other policies = locked for anon/authenticated).
CREATE POLICY org_env_creds_service_all
  ON public.org_environment_credentials
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_org_env_creds_updated
  BEFORE UPDATE ON public.org_environment_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Safe read-only view of *status* (no secrets) for org admins
CREATE OR REPLACE VIEW public.org_environment_status
WITH (security_invoker = true) AS
SELECT
  organization_id,
  provider,
  tenant_id,
  status,
  last_error,
  last_test_at,
  connected_at,
  updated_at
FROM public.org_environment_credentials;

GRANT SELECT ON public.org_environment_status TO authenticated;

-- View enforces org scoping via underlying RLS — but the base table is
-- service-role only, so we need a SECURITY DEFINER function instead.
DROP VIEW IF EXISTS public.org_environment_status;

CREATE OR REPLACE FUNCTION public.get_org_environment_status(_org_id uuid)
RETURNS TABLE (
  provider text,
  tenant_id text,
  status text,
  last_error text,
  last_test_at timestamptz,
  connected_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT provider, tenant_id, status, last_error, last_test_at, connected_at, updated_at
  FROM public.org_environment_credentials
  WHERE organization_id = _org_id
    AND (
      public.is_org_admin(_org_id)
      OR public.is_current_user_super_admin()
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_org_environment_status(uuid) TO authenticated;

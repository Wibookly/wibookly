
-- ============================================================================
-- Unanet multi-tenant integration schema
-- ============================================================================

-- 1) Feature-gate helper: is unanet_integration enabled for ANY permission
--    group in the given organization?
CREATE OR REPLACE FUNCTION public.org_has_unanet_feature(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_features gf
    JOIN public.permission_groups pg ON pg.id = gf.group_id
    WHERE pg.organization_id = _org_id
      AND gf.feature_key = 'unanet_integration'
      AND gf.is_enabled = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.org_has_unanet_feature(uuid) TO authenticated, service_role;

-- 2) unanet_connections: one row per organization (domain = organization).
CREATE TABLE public.unanet_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  database_name text NOT NULL,
  -- Encrypted API key material. ciphertext + key_id enables rotation.
  api_key_ciphertext text NOT NULL,
  api_key_key_id text NOT NULL DEFAULT 'v1',
  login_mode text,                                    -- from probe: STANDARD | SSO | ...
  access_rights_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','failing','disabled')),
  last_verified_at timestamptz,
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.unanet_connections TO authenticated;
GRANT ALL ON public.unanet_connections TO service_role;

ALTER TABLE public.unanet_connections ENABLE ROW LEVEL SECURITY;

-- Only org admins (or super admin) may READ the connection row.
-- All writes go through edge functions using the service role, which bypasses RLS.
CREATE POLICY "unanet_connections read for org admin"
  ON public.unanet_connections
  FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_super_admin()
    OR public.is_org_admin(organization_id)
  );

CREATE TRIGGER update_unanet_connections_updated_at
  BEFORE UPDATE ON public.unanet_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) unanet_records: generic sync target for dashboards.
--    Every row carries organization_id. Composite unique on
--    (organization_id, record_type, unanet_id) — Unanet ids are only
--    unique within one tenant.
CREATE TABLE public.unanet_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_type text NOT NULL,                          -- 'project' | 'timesheet' | 'invoice' | 'employee' | ...
  unanet_id text NOT NULL,                            -- id as returned by Unanet, scoped to tenant
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_date date,                                 -- accounting date for window-based sync
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, record_type, unanet_id)
);

CREATE INDEX unanet_records_org_type_date_idx
  ON public.unanet_records (organization_id, record_type, business_date DESC);

CREATE INDEX unanet_records_payload_gin
  ON public.unanet_records USING gin (payload);

GRANT SELECT ON public.unanet_records TO authenticated;
GRANT ALL ON public.unanet_records TO service_role;

ALTER TABLE public.unanet_records ENABLE ROW LEVEL SECURITY;

-- Any member of the org can read that org's synced records; nobody can read another org's.
CREATE POLICY "unanet_records read for org members"
  ON public.unanet_records
  FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_super_admin()
    OR organization_id = public.get_user_organization_id(auth.uid())
  );

CREATE TRIGGER update_unanet_records_updated_at
  BEFORE UPDATE ON public.unanet_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) unanet_sync_runs: sync audit trail.
CREATE TABLE public.unanet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','partial','failed')),
  triggered_by text NOT NULL DEFAULT 'cron'
    CHECK (triggered_by IN ('cron','manual','connect')),
  records_upserted integer NOT NULL DEFAULT 0,
  records_capped boolean NOT NULL DEFAULT false,
  window_start date,
  window_end date,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX unanet_sync_runs_org_started_idx
  ON public.unanet_sync_runs (organization_id, started_at DESC);

GRANT SELECT ON public.unanet_sync_runs TO authenticated;
GRANT ALL ON public.unanet_sync_runs TO service_role;

ALTER TABLE public.unanet_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unanet_sync_runs read for org admin"
  ON public.unanet_sync_runs
  FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_super_admin()
    OR public.is_org_admin(organization_id)
  );

CREATE TRIGGER update_unanet_sync_runs_updated_at
  BEFORE UPDATE ON public.unanet_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =====================================================================
-- Phase 3 — multi-level admin + roles
-- =====================================================================

-- 1) Plans catalogue
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in can read plans" ON public.plans;
CREATE POLICY "Anyone signed in can read plans" ON public.plans
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Only super_admin can manage plans" ON public.plans;
CREATE POLICY "Only super_admin can manage plans" ON public.plans
  FOR ALL TO authenticated
  USING (public.is_current_user_super_admin())
  WITH CHECK (public.is_current_user_super_admin());

INSERT INTO public.plans (slug, name, description, display_order)
VALUES
  ('starter','Starter','Single organization, core features',10),
  ('pro','Pro','Multiple users, advanced AI features',20),
  ('enterprise','Enterprise','Custom limits, dedicated support',30)
ON CONFLICT (slug) DO NOTHING;

-- Backfill: link organizations.plan_id FK if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='organizations'
      AND constraint_name='organizations_plan_id_fkey'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Default existing orgs to Starter plan
UPDATE public.organizations
   SET plan_id = (SELECT id FROM public.plans WHERE slug='starter' LIMIT 1)
 WHERE plan_id IS NULL;

-- 2) Grant super_admin role to platform owner (in admin org)
INSERT INTO public.user_roles (user_id, organization_id, role)
SELECT up.user_id, up.organization_id, 'super_admin'::app_role
  FROM public.user_profiles up
 WHERE up.email = 'arahimi@energyforward.com'
   AND NOT EXISTS (
     SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = up.user_id AND ur.role = 'super_admin'::app_role
   );

-- 3) Helper: is the current caller an org_admin of a given org
CREATE OR REPLACE FUNCTION public.is_org_admin(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = auth.uid()
       AND organization_id = _org_id
       AND role IN ('org_admin'::app_role, 'admin'::app_role)
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated, service_role;

-- 4) Organization RLS: super_admin full access; org_admin update own (plan/status protected by trigger below)
DROP POLICY IF EXISTS "Super admin manages organizations" ON public.organizations;
CREATE POLICY "Super admin manages organizations" ON public.organizations
  FOR ALL TO authenticated
  USING (public.is_current_user_super_admin())
  WITH CHECK (public.is_current_user_super_admin());

DROP POLICY IF EXISTS "Org admins can update their organization" ON public.organizations;
CREATE POLICY "Org admins can update their organization" ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(id))
  WITH CHECK (public.is_org_admin(id));

-- 5) Guard trigger: org_admin (non super) cannot change plan_id or status
CREATE OR REPLACE FUNCTION public.guard_org_plan_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.is_current_user_super_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'Only a super admin can change the organization plan';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only a super admin can change the organization status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_org_plan_status ON public.organizations;
CREATE TRIGGER trg_guard_org_plan_status
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_org_plan_status_change();

-- 6) Backend RPC used by Super Admin UI: create org + optional org_admin invitation
CREATE OR REPLACE FUNCTION public.admin_create_organization(
  _name text,
  _legal_name text DEFAULT NULL,
  _address_street text DEFAULT NULL,
  _address_city text DEFAULT NULL,
  _address_state text DEFAULT NULL,
  _address_zip text DEFAULT NULL,
  _address_country text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _contact_email text DEFAULT NULL,
  _logo_url text DEFAULT NULL,
  _environment_type text DEFAULT 'none',
  _plan_slug text DEFAULT 'starter',
  _status text DEFAULT 'active',
  _admin_invite_email text DEFAULT NULL
)
RETURNS TABLE(organization_id uuid, invitation_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
  _plan_id uuid;
  _token text;
BEGIN
  IF NOT public.is_current_user_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can create organizations';
  END IF;

  SELECT id INTO _plan_id FROM public.plans WHERE slug = COALESCE(_plan_slug,'starter') LIMIT 1;

  INSERT INTO public.organizations(
    name, legal_name, address_street, address_city, address_state, address_zip,
    address_country, phone, contact_email, logo_url,
    environment_type, plan_id, status
  ) VALUES (
    _name, _legal_name, _address_street, _address_city, _address_state, _address_zip,
    _address_country, _phone, _contact_email, _logo_url,
    COALESCE(_environment_type,'none')::text::organization_environment_type,
    _plan_id,
    COALESCE(_status,'active')::text::organization_status
  )
  RETURNING id INTO _org_id;

  IF _admin_invite_email IS NOT NULL AND length(trim(_admin_invite_email)) > 0 THEN
    _token := encode(gen_random_bytes(24), 'hex');
    INSERT INTO public.user_invitations(
      organization_id, email, mode, token, expires_at, invited_by
    ) VALUES (
      _org_id, lower(trim(_admin_invite_email)), 'org_admin',
      _token, now() + interval '14 days', auth.uid()
    );
  END IF;

  RETURN QUERY SELECT _org_id, _token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_organization(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;

-- 7) Backend RPC: super_admin update org status (suspend/reactivate)
CREATE OR REPLACE FUNCTION public.admin_set_org_status(_org_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_current_user_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change org status';
  END IF;
  UPDATE public.organizations
     SET status = _status::organization_status,
         updated_at = now()
   WHERE id = _org_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_org_status(uuid, text) TO authenticated;

-- 8) Backend RPC: list organizations with stats (super_admin only)
CREATE OR REPLACE FUNCTION public.admin_list_organizations()
RETURNS TABLE(
  id uuid, name text, legal_name text, status text, environment_type text,
  plan_slug text, plan_name text, user_count bigint, created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id, o.name, o.legal_name, o.status::text, o.environment_type::text,
    p.slug, p.name,
    (SELECT count(*) FROM public.user_profiles up WHERE up.organization_id = o.id) AS user_count,
    o.created_at
  FROM public.organizations o
  LEFT JOIN public.plans p ON p.id = o.plan_id
  WHERE public.is_current_user_super_admin()
  ORDER BY o.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations() TO authenticated;

-- 9) Org-admin scoped: list users in own org
CREATE OR REPLACE FUNCTION public.org_admin_list_users()
RETURNS TABLE(user_id uuid, email text, full_name text, title text, roles text[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_org AS (
    SELECT public.get_current_org_id() AS org_id
  ),
  perm AS (
    SELECT public.is_org_admin((SELECT org_id FROM my_org)) AS ok
  )
  SELECT
    up.user_id, up.email, up.full_name, up.title,
    COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
  FROM public.user_profiles up
  LEFT JOIN public.user_roles ur
    ON ur.user_id = up.user_id AND ur.organization_id = up.organization_id
  WHERE up.organization_id = (SELECT org_id FROM my_org)
    AND (SELECT ok FROM perm)
  GROUP BY up.user_id, up.email, up.full_name, up.title;
$$;
GRANT EXECUTE ON FUNCTION public.org_admin_list_users() TO authenticated;

-- 10) Org-admin scoped: change a user's role within own org (cannot grant super_admin)
CREATE OR REPLACE FUNCTION public.org_admin_set_user_role(_target_user uuid, _role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.get_current_org_id();
BEGIN
  IF NOT public.is_org_admin(_org) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _role = 'super_admin' THEN
    RAISE EXCEPTION 'Org admins cannot grant super_admin';
  END IF;
  -- Make sure target is in same org
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = _target_user AND organization_id = _org) THEN
    RAISE EXCEPTION 'User not in your organization';
  END IF;

  DELETE FROM public.user_roles
   WHERE user_id = _target_user AND organization_id = _org;

  INSERT INTO public.user_roles(user_id, organization_id, role)
  VALUES (_target_user, _org, _role::app_role);
END;
$$;
GRANT EXECUTE ON FUNCTION public.org_admin_set_user_role(uuid, text) TO authenticated;


-- =========================================================================
-- Phase 2 — RLS isolation layer
-- =========================================================================

-- 1) Org-context helper (recursion-safe via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.user_profiles
  WHERE user_id = auth.uid()
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_current_org_id() TO authenticated, anon, service_role;

-- Super-admin helper (alias to existing is_current_user_super_admin for clarity)
CREATE OR REPLACE FUNCTION public.is_platform_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_current_user_super_admin()
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_super_admin() TO authenticated, anon, service_role;

-- 2) Auto-default trigger so client cannot write into another org
CREATE OR REPLACE FUNCTION public.set_organization_id_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_org uuid;
BEGIN
  -- service_role bypass: trust whatever it sets
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  _caller_org := public.get_current_org_id();

  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := _caller_org;
  ELSIF _caller_org IS NOT NULL
        AND NEW.organization_id <> _caller_org
        AND NOT public.is_current_user_super_admin() THEN
    RAISE EXCEPTION 'organization_id mismatch: cannot write into another organization';
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Add restrictive org-isolation policies + default trigger to tenant tables
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'admin_audit_log','agent_messages','agent_response_cache','agent_settings',
    'ai_activity_logs','ai_chat_conversations','ai_chat_messages','ai_settings',
    'ai_usage_logs','availability_hours','categories','chat_conversations',
    'chat_folders','chat_messages','connect_attempts','daily_brief_schedules',
    'daily_brief_tasks','discovered_tenant_users','email_messages','email_profiles',
    'email_send_log','email_send_state','email_threads','email_unsubscribe_tokens',
    'extraction_regression_log','follow_up_settings','follow_up_trackers',
    'graph_health','jobs','knowledge_chunks','knowledge_documents','llm_call_logs',
    'm365_api_health','m365_sync_jobs','m365_sync_state','meeting_action_items',
    'meeting_copilot_preferences','meeting_copilot_settings','meeting_sessions',
    'meeting_suggestions','meeting_transcripts','org_agent_budget',
    'permission_groups','processed_emails','provider_connections','rules',
    'subscriptions','support_issues','tool_diagnostics','user_ai_profiles',
    'user_client_status','user_daily_spend','user_feature_access','user_overrides'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- Drop any prior versions to keep migration idempotent
    EXECUTE format('DROP POLICY IF EXISTS org_isolation_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation_modify ON public.%I', t);

    -- RESTRICTIVE policy: row must belong to caller's org OR caller is super admin / service_role.
    -- Nullable org_id is permitted (legacy rows) to avoid breakage; new inserts get defaulted via trigger.
    EXECUTE format($f$
      CREATE POLICY org_isolation_select ON public.%I
      AS RESTRICTIVE
      FOR SELECT TO authenticated
      USING (
        organization_id IS NULL
        OR organization_id = public.get_current_org_id()
        OR public.is_current_user_super_admin()
      )
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY org_isolation_modify ON public.%I
      AS RESTRICTIVE
      FOR ALL TO authenticated
      USING (
        organization_id IS NULL
        OR organization_id = public.get_current_org_id()
        OR public.is_current_user_super_admin()
      )
      WITH CHECK (
        organization_id IS NULL
        OR organization_id = public.get_current_org_id()
        OR public.is_current_user_super_admin()
      )
    $f$, t);

    -- Auto-default trigger
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_org_id ON public.%I', t);
    EXECUTE format($f$
      CREATE TRIGGER trg_set_org_id
      BEFORE INSERT ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_default()
    $f$, t);
  END LOOP;
END $$;

-- 4) Lock down secrets tables: service_role only
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='oauth_token_vault' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.oauth_token_vault', p.policyname);
  END LOOP;
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='api_key_config' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.api_key_config', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "service_role only - oauth_token_vault"
  ON public.oauth_token_vault FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role only - api_key_config"
  ON public.api_key_config FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.oauth_token_vault FROM anon, authenticated;
REVOKE ALL ON public.api_key_config    FROM anon, authenticated;
GRANT ALL ON public.oauth_token_vault TO service_role;
GRANT ALL ON public.api_key_config    TO service_role;

-- Safe metadata view for client (no tokens, only health fields) — replaces direct table read in MicrosoftStatusPanel
DROP VIEW IF EXISTS public.oauth_token_status;
CREATE VIEW public.oauth_token_status
WITH (security_invoker = on) AS
SELECT
  v.user_id,
  v.organization_id,
  v.provider,
  v.refresh_failure_count,
  v.requires_reauth,
  v.last_refresh_at,
  v.last_refresh_error,
  v.created_at
FROM public.oauth_token_vault v
WHERE v.user_id = auth.uid();

GRANT SELECT ON public.oauth_token_status TO authenticated;

-- =========================================================================
-- 5) ISOLATION TEST (inline; rolled back via cleanup at end)
-- =========================================================================
DO $$
DECLARE
  _test_org uuid;
  _test_user uuid := gen_random_uuid();
  _org1 uuid := '0a91e605-0000-0000-0000-000000000000';  -- will resolve below
  _visible_to_test int;
  _visible_org1_to_test int;
BEGIN
  -- Resolve real Org 1 id (Energyforward)
  SELECT id INTO _org1 FROM public.organizations
   WHERE lower(name) IN ('energyforward','eneryorward.') ORDER BY created_at LIMIT 1;

  -- Create second test org
  INSERT INTO public.organizations (name, status)
  VALUES ('Phase2 Test Org', 'active')
  RETURNING id INTO _test_org;

  -- Create a fake profile for a non-existent user mapped to the test org
  INSERT INTO public.user_profiles (user_id, organization_id, email, full_name)
  VALUES (_test_user, _test_org, 'phase2-test@example.invalid', 'Phase2 Tester');

  -- Insert a row that belongs to the test org in a tenant table
  INSERT INTO public.ai_chat_conversations (user_id, organization_id, title)
  VALUES (_test_user, _test_org, 'Phase2 isolation row');

  -- Simulate authenticated request as the test user
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _test_user::text, 'role', 'authenticated')::text, true);

  -- The test user should ONLY see their own org's rows
  SELECT count(*) INTO _visible_to_test
    FROM public.ai_chat_conversations WHERE organization_id = _test_org;
  SELECT count(*) INTO _visible_org1_to_test
    FROM public.ai_chat_conversations WHERE organization_id = _org1;

  RAISE NOTICE 'ISOLATION TEST: test_user sees % rows in test org, % rows in Org 1 (expect >0 and 0)',
    _visible_to_test, _visible_org1_to_test;

  IF _visible_org1_to_test > 0 THEN
    RAISE EXCEPTION 'Isolation FAILED: test user saw % Org-1 rows', _visible_org1_to_test;
  END IF;

  -- Reset role and cleanup
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.ai_chat_conversations WHERE organization_id = _test_org;
  DELETE FROM public.user_profiles WHERE user_id = _test_user;
  DELETE FROM public.organizations WHERE id = _test_org;

  RAISE NOTICE 'ISOLATION TEST: passed and cleanup complete';
END $$;

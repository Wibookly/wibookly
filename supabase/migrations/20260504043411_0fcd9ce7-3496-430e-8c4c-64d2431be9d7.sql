
-- 1) user_overrides table
CREATE TABLE IF NOT EXISTS public.user_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  feature_key TEXT,
  override_type TEXT NOT NULL CHECK (override_type IN (
    'daily_limit','weekly_limit','monthly_limit',
    'model_assignment','is_enabled',
    'per_request_usd','per_user_daily_usd','per_user_monthly_usd'
  )),
  override_value TEXT NOT NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_user_overrides_user
  ON public.user_overrides(user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_overrides_expires
  ON public.user_overrides(expires_at) WHERE is_active = TRUE AND expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_overrides_lookup
  ON public.user_overrides(user_id, feature_key, override_type) WHERE is_active = TRUE;

ALTER TABLE public.user_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage org overrides" ON public.user_overrides;
CREATE POLICY "admins manage org overrides" ON public.user_overrides
  FOR ALL USING (
    organization_id = get_user_organization_id(auth.uid())
    AND has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  ) WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  );

DROP POLICY IF EXISTS "users view own overrides" ON public.user_overrides;
CREATE POLICY "users view own overrides" ON public.user_overrides
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service role manages overrides" ON public.user_overrides;
CREATE POLICY "service role manages overrides" ON public.user_overrides
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 2) Add weekly/monthly to group_features
ALTER TABLE public.group_features
  ADD COLUMN IF NOT EXISTS weekly_limit INTEGER,
  ADD COLUMN IF NOT EXISTS monthly_limit INTEGER;

-- 3) Add weekly cap to group_cost_caps
ALTER TABLE public.group_cost_caps
  ADD COLUMN IF NOT EXISTS per_user_weekly_usd NUMERIC(10,2);

-- 4) Org budget enhancements
ALTER TABLE public.org_agent_budget
  ADD COLUMN IF NOT EXISTS auto_pause_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alert_thresholds INTEGER[] NOT NULL DEFAULT ARRAY[50,75,90,100],
  ADD COLUMN IF NOT EXISTS alert_email TEXT,
  ADD COLUMN IF NOT EXISTS monthly_usd_cap NUMERIC(10,2) NOT NULL DEFAULT 6600.00;

-- 5) Helper to get effective override value
CREATE OR REPLACE FUNCTION public.get_user_override(
  _user_id UUID,
  _feature_key TEXT,
  _override_type TEXT
) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT override_value FROM public.user_overrides
  WHERE user_id = _user_id
    AND feature_key = _feature_key
    AND override_type = _override_type
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1
$$;

-- 6) Patch enforce_llm_limits to apply USER override cascade for daily_limit, model, is_enabled, cost caps
CREATE OR REPLACE FUNCTION public.enforce_llm_limits(
  _user_id uuid, _organization_id uuid, _feature_key text,
  _est_cost_usd numeric DEFAULT 0, _fallback_model text DEFAULT NULL::text
)
RETURNS TABLE(
  allowed boolean, reason text, model text, group_id uuid, feature_enabled boolean,
  daily_count_remaining integer, user_daily_remaining numeric,
  user_monthly_remaining numeric, org_daily_remaining numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _email text;
  _is_super boolean := false;
  _group_id uuid;
  _is_enabled boolean := false;
  _daily_limit integer := 0;
  _model_assignment text;
  _today_count integer := 0;
  _per_req numeric;
  _per_day numeric;
  _per_mo numeric;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _month date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
  _spent_d numeric := 0;
  _spent_m numeric := 0;
  _org_row public.org_agent_budget;
  _resolved_model text;
  _ov text;
BEGIN
  SELECT email INTO _email FROM public.user_profiles WHERE user_id = _user_id LIMIT 1;
  _is_super := public.is_super_admin(COALESCE(_email,''));

  SELECT ugm.group_id INTO _group_id
  FROM public.user_group_memberships ugm
  JOIN public.permission_groups pg ON pg.id = ugm.group_id
  WHERE ugm.user_id = _user_id AND pg.organization_id = _organization_id
  ORDER BY pg.display_order DESC LIMIT 1;

  IF _group_id IS NULL THEN
    SELECT id INTO _group_id FROM public.permission_groups
    WHERE organization_id = _organization_id AND is_default_for_new_users = TRUE LIMIT 1;
  END IF;

  SELECT gf.is_enabled, gf.daily_limit, gf.model_assignment
    INTO _is_enabled, _daily_limit, _model_assignment
  FROM public.group_features gf
  WHERE gf.group_id = _group_id AND gf.feature_key = _feature_key
  LIMIT 1;

  -- USER OVERRIDE cascade
  _ov := public.get_user_override(_user_id, _feature_key, 'is_enabled');
  IF _ov IS NOT NULL THEN _is_enabled := (_ov::boolean); END IF;

  _ov := public.get_user_override(_user_id, _feature_key, 'daily_limit');
  IF _ov IS NOT NULL THEN _daily_limit := _ov::integer; END IF;

  _ov := public.get_user_override(_user_id, _feature_key, 'model_assignment');
  IF _ov IS NOT NULL THEN _model_assignment := _ov; END IF;

  _resolved_model := COALESCE(_model_assignment, _fallback_model);

  IF _is_super THEN
    RETURN QUERY SELECT TRUE, NULL::text, _resolved_model, _group_id, TRUE,
      999999, 999999::numeric, 999999::numeric, 999999::numeric;
    RETURN;
  END IF;

  IF _group_id IS NULL OR NOT COALESCE(_is_enabled, false) THEN
    RETURN QUERY SELECT FALSE, 'feature_disabled'::text, _resolved_model, _group_id, FALSE,
      0, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF _daily_limit > 0 THEN
    SELECT COUNT(*) INTO _today_count
    FROM public.ai_usage_logs
    WHERE user_id = _user_id AND action = _feature_key AND created_at >= _today;
    IF _today_count >= _daily_limit THEN
      RETURN QUERY SELECT FALSE, 'daily_count_exceeded'::text, _resolved_model, _group_id, TRUE,
        0, 0::numeric, 0::numeric, 0::numeric;
      RETURN;
    END IF;
  END IF;

  SELECT per_request_usd, per_user_daily_usd, per_user_monthly_usd
    INTO _per_req, _per_day, _per_mo
  FROM public.group_cost_caps WHERE group_cost_caps.group_id = _group_id;

  -- Cost cap overrides
  _ov := public.get_user_override(_user_id, _feature_key, 'per_request_usd');
  IF _ov IS NOT NULL THEN _per_req := _ov::numeric; END IF;
  _ov := public.get_user_override(_user_id, _feature_key, 'per_user_daily_usd');
  IF _ov IS NOT NULL THEN _per_day := _ov::numeric; END IF;
  _ov := public.get_user_override(_user_id, _feature_key, 'per_user_monthly_usd');
  IF _ov IS NOT NULL THEN _per_mo := _ov::numeric; END IF;

  SELECT COALESCE(spent_today_usd,0), COALESCE(spent_month_usd,0)
    INTO _spent_d, _spent_m
  FROM public.user_daily_spend
  WHERE user_id = _user_id AND day = _today;

  IF _per_req IS NOT NULL AND _est_cost_usd > _per_req THEN
    RETURN QUERY SELECT FALSE, 'per_request_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0), 0::numeric;
    RETURN;
  END IF;

  IF _per_day IS NOT NULL AND _spent_d + _est_cost_usd > _per_day THEN
    RETURN QUERY SELECT FALSE, 'user_daily_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(_per_day - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0), 0::numeric;
    RETURN;
  END IF;

  IF _per_mo IS NOT NULL AND _spent_m + _est_cost_usd > _per_mo THEN
    RETURN QUERY SELECT FALSE, 'user_monthly_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(_per_mo - _spent_m, 0), 0::numeric;
    RETURN;
  END IF;

  INSERT INTO public.org_agent_budget(organization_id) VALUES (_organization_id)
    ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO _org_row FROM public.org_agent_budget WHERE organization_id = _organization_id;

  IF _org_row.current_day <> _today THEN
    UPDATE public.org_agent_budget
       SET current_day = _today, spent_today_usd = 0, updated_at = now()
     WHERE organization_id = _organization_id RETURNING * INTO _org_row;
  END IF;
  IF _org_row.current_month <> _month THEN
    UPDATE public.org_agent_budget
       SET current_month = _month, spent_month_usd = 0, updated_at = now()
     WHERE organization_id = _organization_id RETURNING * INTO _org_row;
  END IF;

  IF _org_row.paused THEN
    RETURN QUERY SELECT FALSE, COALESCE(_org_row.paused_reason,'org_paused')::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
      GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
    RETURN;
  END IF;

  IF _org_row.spent_today_usd + _est_cost_usd > _org_row.daily_usd_cap THEN
    RETURN QUERY SELECT FALSE, 'org_daily_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
      GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::text, _resolved_model, _group_id, TRUE,
    GREATEST(_daily_limit - _today_count, 0),
    GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
    GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
    GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
END;
$function$;


-- Pre-flight enforcement: feature enabled? daily count? per-request cap? user daily/monthly cap? org daily/monthly cap?
CREATE OR REPLACE FUNCTION public.enforce_llm_limits(
  _user_id uuid,
  _organization_id uuid,
  _feature_key text,
  _est_cost_usd numeric DEFAULT 0,
  _fallback_model text DEFAULT NULL
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  model text,
  group_id uuid,
  feature_enabled boolean,
  daily_count_remaining integer,
  user_daily_remaining numeric,
  user_monthly_remaining numeric,
  org_daily_remaining numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  -- Super admin bypass
  SELECT email INTO _email FROM public.user_profiles WHERE user_id = _user_id LIMIT 1;
  _is_super := public.is_super_admin(COALESCE(_email,''));

  -- Resolve group (highest display_order wins; else default)
  SELECT ugm.group_id INTO _group_id
  FROM public.user_group_memberships ugm
  JOIN public.permission_groups pg ON pg.id = ugm.group_id
  WHERE ugm.user_id = _user_id AND pg.organization_id = _organization_id
  ORDER BY pg.display_order DESC LIMIT 1;

  IF _group_id IS NULL THEN
    SELECT id INTO _group_id FROM public.permission_groups
    WHERE organization_id = _organization_id AND is_default_for_new_users = TRUE LIMIT 1;
  END IF;

  -- Feature row
  SELECT gf.is_enabled, gf.daily_limit, gf.model_assignment
    INTO _is_enabled, _daily_limit, _model_assignment
  FROM public.group_features gf
  WHERE gf.group_id = _group_id AND gf.feature_key = _feature_key
  LIMIT 1;

  _resolved_model := COALESCE(_model_assignment, _fallback_model);

  IF _is_super THEN
    RETURN QUERY SELECT TRUE, NULL::text, _resolved_model, _group_id, TRUE,
      999999, 999999::numeric, 999999::numeric, 999999::numeric;
    RETURN;
  END IF;

  -- Feature enablement
  IF _group_id IS NULL OR NOT COALESCE(_is_enabled, false) THEN
    RETURN QUERY SELECT FALSE, 'feature_disabled'::text, _resolved_model, _group_id, FALSE,
      0, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Daily count limit (0 = unlimited)
  IF _daily_limit > 0 THEN
    SELECT COUNT(*) INTO _today_count
    FROM public.ai_usage_logs
    WHERE user_id = _user_id
      AND action = _feature_key
      AND created_at >= _today;
    IF _today_count >= _daily_limit THEN
      RETURN QUERY SELECT FALSE, 'daily_count_exceeded'::text, _resolved_model, _group_id, TRUE,
        0, 0::numeric, 0::numeric, 0::numeric;
      RETURN;
    END IF;
  END IF;

  -- Cost caps
  SELECT per_request_usd, per_user_daily_usd, per_user_monthly_usd
    INTO _per_req, _per_day, _per_mo
  FROM public.group_cost_caps WHERE group_cost_caps.group_id = _group_id;

  SELECT COALESCE(spent_today_usd,0), COALESCE(spent_month_usd,0)
    INTO _spent_d, _spent_m
  FROM public.user_daily_spend
  WHERE user_id = _user_id AND day = _today;

  IF _per_req IS NOT NULL AND _est_cost_usd > _per_req THEN
    RETURN QUERY SELECT FALSE, 'per_request_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
      0::numeric;
    RETURN;
  END IF;

  IF _per_day IS NOT NULL AND _spent_d + _est_cost_usd > _per_day THEN
    RETURN QUERY SELECT FALSE, 'user_daily_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(_per_day - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
      0::numeric;
    RETURN;
  END IF;

  IF _per_mo IS NOT NULL AND _spent_m + _est_cost_usd > _per_mo THEN
    RETURN QUERY SELECT FALSE, 'user_monthly_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(_per_mo - _spent_m, 0),
      0::numeric;
    RETURN;
  END IF;

  -- Org budget
  INSERT INTO public.org_agent_budget(organization_id) VALUES (_organization_id)
    ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO _org_row FROM public.org_agent_budget WHERE organization_id = _organization_id;

  -- Daily rollover
  IF _org_row.current_day <> _today THEN
    UPDATE public.org_agent_budget
       SET current_day = _today, spent_today_usd = 0, updated_at = now()
     WHERE organization_id = _organization_id
     RETURNING * INTO _org_row;
  END IF;
  IF _org_row.current_month <> _month THEN
    UPDATE public.org_agent_budget
       SET current_month = _month, spent_month_usd = 0, updated_at = now()
     WHERE organization_id = _organization_id
     RETURNING * INTO _org_row;
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

  IF _org_row.spent_month_usd + _est_cost_usd > _org_row.monthly_usd_cap THEN
    RETURN QUERY SELECT FALSE, 'org_monthly_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_daily_limit - _today_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
      GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::text, _resolved_model, _group_id, TRUE,
    CASE WHEN _daily_limit > 0 THEN _daily_limit - _today_count ELSE 999999 END,
    GREATEST(COALESCE(_per_day,999999) - _spent_d, 0),
    GREATEST(COALESCE(_per_mo,999999) - _spent_m, 0),
    GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
END;
$$;

-- Post-call: log + increment user/org spend in one shot
CREATE OR REPLACE FUNCTION public.record_llm_spend(
  _user_id uuid,
  _organization_id uuid,
  _group_id uuid,
  _feature_key text,
  _provider text,
  _model text,
  _tokens_in integer,
  _tokens_out integer,
  _cost_usd numeric,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _month date := date_trunc('month',(now() AT TIME ZONE 'UTC'))::date;
  _prov  text := CASE WHEN _provider IN ('openai','anthropic','lovable_ai','google') THEN _provider ELSE 'openai' END;
BEGIN
  -- Audit log
  INSERT INTO public.ai_usage_logs(
    organization_id, user_id, provider, model, action,
    prompt_tokens, completion_tokens, cost_usd, metadata
  ) VALUES (
    _organization_id, _user_id, _prov, _model, _feature_key,
    COALESCE(_tokens_in,0), COALESCE(_tokens_out,0), COALESCE(_cost_usd,0), COALESCE(_metadata,'{}'::jsonb)
  );

  -- User daily spend
  INSERT INTO public.user_daily_spend (
    user_id, organization_id, group_id, day, month,
    spent_today_usd, spent_month_usd, request_count_today
  ) VALUES (
    _user_id, _organization_id, _group_id, _today, _month,
    COALESCE(_cost_usd,0), COALESCE(_cost_usd,0), 1
  )
  ON CONFLICT (user_id, day) DO UPDATE SET
    spent_today_usd = user_daily_spend.spent_today_usd + EXCLUDED.spent_today_usd,
    spent_month_usd = CASE WHEN user_daily_spend.month = _month
      THEN user_daily_spend.spent_month_usd + EXCLUDED.spent_today_usd
      ELSE EXCLUDED.spent_today_usd END,
    month = _month,
    request_count_today = user_daily_spend.request_count_today + 1,
    updated_at = now();

  -- Org spend (with rollover safety)
  INSERT INTO public.org_agent_budget(organization_id) VALUES (_organization_id)
    ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.org_agent_budget
     SET current_day = CASE WHEN current_day = _today THEN current_day ELSE _today END,
         spent_today_usd = CASE WHEN current_day = _today
                                THEN spent_today_usd + COALESCE(_cost_usd,0)
                                ELSE COALESCE(_cost_usd,0) END,
         current_month = CASE WHEN current_month = _month THEN current_month ELSE _month END,
         spent_month_usd = CASE WHEN current_month = _month
                                THEN spent_month_usd + COALESCE(_cost_usd,0)
                                ELSE COALESCE(_cost_usd,0) END,
         updated_at = now()
   WHERE organization_id = _organization_id;
END;
$$;

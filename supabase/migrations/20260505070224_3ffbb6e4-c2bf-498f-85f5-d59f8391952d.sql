CREATE OR REPLACE FUNCTION public.enforce_llm_limits(_user_id uuid, _organization_id uuid, _feature_key text, _est_cost_usd numeric DEFAULT 0, _fallback_model text DEFAULT NULL::text)
 RETURNS TABLE(allowed boolean, reason text, model text, group_id uuid, feature_enabled boolean, daily_count_remaining integer, user_daily_remaining numeric, user_monthly_remaining numeric, org_daily_remaining numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _email text;
  _is_super boolean := false;
  _group_id uuid;
  _is_enabled boolean := false;
  _daily_limit integer := 0;
  _weekly_limit integer;
  _limit_term text := 'daily';
  _rollover text := 'none';
  _model_assignment text;
  _window_count integer := 0;
  _yesterday_count integer := 0;
  _effective_limit integer := 0;
  _per_req numeric;
  _per_day numeric;
  _per_mo numeric;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _yesterday date := ((now() AT TIME ZONE 'UTC') - interval '1 day')::date;
  _week_start date := date_trunc('week', (now() AT TIME ZONE 'UTC'))::date; -- Monday
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

  SELECT gf.is_enabled, gf.daily_limit, gf.weekly_limit, gf.model_assignment,
         COALESCE(gf.limit_term, 'daily'), COALESCE(gf.rollover, 'none')
    INTO _is_enabled, _daily_limit, _weekly_limit, _model_assignment, _limit_term, _rollover
  FROM public.group_features gf
  WHERE gf.group_id = _group_id AND gf.feature_key = _feature_key
  LIMIT 1;

  -- USER OVERRIDE cascade
  _ov := public.get_user_override(_user_id, _feature_key, 'is_enabled');
  IF _ov IS NOT NULL THEN _is_enabled := (_ov::boolean); END IF;

  _ov := public.get_user_override(_user_id, _feature_key, 'daily_limit');
  IF _ov IS NOT NULL THEN _daily_limit := _ov::integer; END IF;

  _ov := public.get_user_override(_user_id, _feature_key, 'weekly_limit');
  IF _ov IS NOT NULL THEN _weekly_limit := _ov::integer; END IF;

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

  -- Compute window count and effective limit based on limit_term + rollover.
  IF _limit_term = 'weekly' THEN
    _effective_limit := COALESCE(NULLIF(_weekly_limit, 0), _daily_limit * 5);
    IF _effective_limit > 0 THEN
      SELECT COUNT(*) INTO _window_count
      FROM public.ai_usage_logs
      WHERE user_id = _user_id AND action = _feature_key AND created_at >= _week_start;
    END IF;
  ELSE
    -- daily
    _effective_limit := _daily_limit;
    IF _effective_limit > 0 THEN
      SELECT COUNT(*) INTO _window_count
      FROM public.ai_usage_logs
      WHERE user_id = _user_id AND action = _feature_key AND created_at >= _today;

      -- Rollover: add yesterday's unused capacity (one day only).
      IF _rollover = 'next_day' AND _daily_limit > 0 THEN
        SELECT COUNT(*) INTO _yesterday_count
        FROM public.ai_usage_logs
        WHERE user_id = _user_id AND action = _feature_key
          AND created_at >= _yesterday AND created_at < _today;
        _effective_limit := _effective_limit + GREATEST(_daily_limit - _yesterday_count, 0);
      END IF;
    END IF;
  END IF;

  IF _effective_limit > 0 AND _window_count >= _effective_limit THEN
    RETURN QUERY SELECT FALSE,
      CASE WHEN _limit_term = 'weekly' THEN 'weekly_count_exceeded'::text
           ELSE 'daily_count_exceeded'::text END,
      _resolved_model, _group_id, TRUE,
      0, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
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
      GREATEST(_effective_limit - _window_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0), 0::numeric;
    RETURN;
  END IF;

  IF _per_day IS NOT NULL AND _spent_d + _est_cost_usd > _per_day THEN
    RETURN QUERY SELECT FALSE, 'user_daily_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_effective_limit - _window_count, 0),
      GREATEST(_per_day - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0), 0::numeric;
    RETURN;
  END IF;

  IF _per_mo IS NOT NULL AND _spent_m + _est_cost_usd > _per_mo THEN
    RETURN QUERY SELECT FALSE, 'user_monthly_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_effective_limit - _window_count, 0),
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
      GREATEST(_effective_limit - _window_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
      GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
    RETURN;
  END IF;

  IF _org_row.spent_today_usd + _est_cost_usd > _org_row.daily_usd_cap THEN
    RETURN QUERY SELECT FALSE, 'org_daily_cap_exceeded'::text, _resolved_model, _group_id, TRUE,
      GREATEST(_effective_limit - _window_count, 0),
      GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
      GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
      GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::text, _resolved_model, _group_id, TRUE,
    GREATEST(_effective_limit - _window_count, 0),
    GREATEST(COALESCE(_per_day,0) - _spent_d, 0),
    GREATEST(COALESCE(_per_mo,0) - _spent_m, 0),
    GREATEST(_org_row.daily_usd_cap - _org_row.spent_today_usd, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_feature_usage_summary(
  _user_id uuid,
  _organization_id uuid,
  _feature_keys text[]
)
RETURNS TABLE(
  feature_key text,
  enabled boolean,
  limit_term text,
  limit_count integer,
  used_count integer,
  remaining_count integer,
  model text,
  user_daily_cap numeric,
  user_daily_spent numeric,
  user_monthly_cap numeric,
  user_monthly_spent numeric,
  is_unlimited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email text;
  _is_super boolean := false;
  _group_id uuid;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _week_start date := date_trunc('week', (now() AT TIME ZONE 'UTC'))::date;
  _month date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
  _per_day numeric;
  _per_mo numeric;
  _spent_d numeric := 0;
  _spent_m numeric := 0;
  _fk text;
  _is_enabled boolean;
  _daily_limit integer;
  _weekly_limit integer;
  _limit_term text;
  _model_assignment text;
  _effective_limit integer;
  _used integer;
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

  -- Org-level user cost caps
  SELECT per_user_daily_usd, per_user_monthly_usd
    INTO _per_day, _per_mo
  FROM public.group_cost_caps WHERE group_cost_caps.group_id = _group_id;

  SELECT COALESCE(SUM(cost_usd),0) INTO _spent_d
  FROM public.ai_usage_logs
  WHERE user_id = _user_id AND created_at >= _today;

  SELECT COALESCE(SUM(cost_usd),0) INTO _spent_m
  FROM public.ai_usage_logs
  WHERE user_id = _user_id AND created_at >= _month;

  FOREACH _fk IN ARRAY _feature_keys LOOP
    _is_enabled := false;
    _daily_limit := 0;
    _weekly_limit := NULL;
    _limit_term := 'daily';
    _model_assignment := NULL;

    SELECT gf.is_enabled, gf.daily_limit, gf.weekly_limit, gf.model_assignment, COALESCE(gf.limit_term,'daily')
      INTO _is_enabled, _daily_limit, _weekly_limit, _model_assignment, _limit_term
    FROM public.group_features gf
    WHERE gf.group_id = _group_id AND gf.feature_key = _fk
    LIMIT 1;

    -- user overrides
    _ov := public.get_user_override(_user_id, _fk, 'is_enabled');
    IF _ov IS NOT NULL THEN _is_enabled := (_ov::boolean); END IF;
    _ov := public.get_user_override(_user_id, _fk, 'daily_limit');
    IF _ov IS NOT NULL THEN _daily_limit := _ov::integer; END IF;
    _ov := public.get_user_override(_user_id, _fk, 'weekly_limit');
    IF _ov IS NOT NULL THEN _weekly_limit := _ov::integer; END IF;
    _ov := public.get_user_override(_user_id, _fk, 'model_assignment');
    IF _ov IS NOT NULL THEN _model_assignment := _ov; END IF;

    IF _is_super THEN
      feature_key := _fk; enabled := TRUE; limit_term := 'daily';
      limit_count := 999999; used_count := 0; remaining_count := 999999;
      model := _model_assignment; user_daily_cap := 0; user_daily_spent := 0;
      user_monthly_cap := 0; user_monthly_spent := 0; is_unlimited := TRUE;
      RETURN NEXT; CONTINUE;
    END IF;

    IF _limit_term = 'weekly' THEN
      _effective_limit := COALESCE(NULLIF(_weekly_limit,0), _daily_limit * 5);
      SELECT COUNT(*) INTO _used FROM public.ai_usage_logs
       WHERE user_id = _user_id AND action = _fk AND created_at >= _week_start;
    ELSE
      _effective_limit := COALESCE(_daily_limit,0);
      SELECT COUNT(*) INTO _used FROM public.ai_usage_logs
       WHERE user_id = _user_id AND action = _fk AND created_at >= _today;
    END IF;

    feature_key := _fk;
    enabled := COALESCE(_is_enabled,false);
    limit_term := _limit_term;
    limit_count := COALESCE(_effective_limit,0);
    used_count := COALESCE(_used,0);
    remaining_count := GREATEST(COALESCE(_effective_limit,0) - COALESCE(_used,0), 0);
    model := _model_assignment;
    user_daily_cap := COALESCE(_per_day,0);
    user_daily_spent := COALESCE(_spent_d,0);
    user_monthly_cap := COALESCE(_per_mo,0);
    user_monthly_spent := COALESCE(_spent_m,0);
    is_unlimited := (COALESCE(_effective_limit,0) = 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_feature_usage_summary(uuid, uuid, text[]) TO authenticated, service_role;

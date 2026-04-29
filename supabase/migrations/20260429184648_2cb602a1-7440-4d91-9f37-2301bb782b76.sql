
CREATE OR REPLACE FUNCTION public.ensure_no_reply_tracker_category(_connection_id uuid)
RETURNS public.categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_cat public.categories;
BEGIN
  -- Validate caller has access to this connection via their organization
  SELECT organization_id INTO v_org_id
  FROM public.email_profiles
  WHERE connection_id = _connection_id
  LIMIT 1;

  IF v_org_id IS NULL THEN
    -- Fall back: derive org from any category on this connection
    SELECT organization_id INTO v_org_id
    FROM public.categories
    WHERE connection_id = _connection_id
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    SELECT public.get_user_organization_id(auth.uid()) INTO v_org_id;
  END IF;

  IF v_org_id IS NULL OR v_org_id <> public.get_user_organization_id(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized for this connection';
  END IF;

  -- Try to find an existing follow-up category on this connection
  SELECT * INTO v_cat
  FROM public.categories
  WHERE connection_id = _connection_id
    AND (
      is_follow_up = true
      OR name ILIKE '%no reply%'
      OR name ILIKE '%no-reply%'
      OR name ILIKE '%follow up%'
      OR name ILIKE '%follow-up%'
      OR name ILIKE '%followup%'
    )
  ORDER BY (is_follow_up) DESC, sort_order ASC
  LIMIT 1;

  IF v_cat.id IS NOT NULL THEN
    UPDATE public.categories
       SET is_follow_up = true,
           is_enabled   = true,
           color        = COALESCE(NULLIF(color,''), '#E81123'),
           updated_at   = now()
     WHERE id = v_cat.id
     RETURNING * INTO v_cat;
    RETURN v_cat;
  END IF;

  -- Create a fresh "No Reply Tracker" category
  INSERT INTO public.categories (
    organization_id, connection_id, name, color,
    is_enabled, ai_draft_enabled, is_follow_up, sort_order, writing_style
  )
  VALUES (
    v_org_id, _connection_id, 'No Reply Tracker', '#E81123',
    true, false, true,
    COALESCE((SELECT MAX(sort_order)+1 FROM public.categories WHERE connection_id = _connection_id), 0),
    'professional'
  )
  RETURNING * INTO v_cat;

  RETURN v_cat;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_no_reply_tracker_category(uuid) TO authenticated;

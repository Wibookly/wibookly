
-- Function: trim each connection's categories to its owner's group max_categories
CREATE OR REPLACE FUNCTION public.trim_categories_to_group_cap(_group_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer := 0;
  _rec record;
  _cap integer;
BEGIN
  FOR _rec IN
    SELECT pc.id AS connection_id, pc.user_id, pc.organization_id
    FROM provider_connections pc
  LOOP
    -- Resolve user's primary group cap (highest display_order). Skip if no group.
    SELECT pg.max_categories INTO _cap
    FROM user_group_memberships ugm
    JOIN permission_groups pg ON pg.id = ugm.group_id
    WHERE ugm.user_id = _rec.user_id
      AND pg.organization_id = _rec.organization_id
      AND (_group_id IS NULL OR pg.id = _group_id)
    ORDER BY pg.display_order DESC
    LIMIT 1;

    IF _cap IS NULL OR _cap <= 0 THEN
      CONTINUE;
    END IF;

    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY sort_order, created_at) AS rn
      FROM categories
      WHERE connection_id = _rec.connection_id
    )
    DELETE FROM categories
    WHERE id IN (SELECT id FROM ranked WHERE rn > _cap);

    GET DIAGNOSTICS _deleted = ROW_COUNT;
  END LOOP;

  RETURN _deleted;
END;
$$;

-- Update the seeding trigger to respect the user's group cap (default 10 if none)
CREATE OR REPLACE FUNCTION public.initialize_email_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_profile RECORD;
  default_cats TEXT[][] := ARRAY[
    ['Urgent', '#EF4444'],
    ['Follow Up', '#F97316'],
    ['Approvals', '#EAB308'],
    ['Events', '#22C55E'],
    ['Customers', '#06B6D4'],
    ['Vendors', '#3B82F6'],
    ['Internal', '#8B5CF6'],
    ['Projects', '#EC4899'],
    ['Finance', '#14B8A6'],
    ['FYI', '#6B7280']
  ];
  i INT;
  _cap INT := 10;
BEGIN
  IF NEW.is_connected = true AND (OLD IS NULL OR OLD.is_connected = false) THEN
    SELECT full_name, title, phone, mobile, website, email_signature,
           signature_logo_url, signature_font, signature_color
    INTO v_user_profile
    FROM public.user_profiles
    WHERE user_id = NEW.user_id
    LIMIT 1;

    INSERT INTO public.email_profiles (
      connection_id, user_id, organization_id,
      full_name, title, phone, mobile, website, email_signature,
      signature_logo_url, signature_font, signature_color
    )
    VALUES (
      NEW.id, NEW.user_id, NEW.organization_id,
      COALESCE(v_user_profile.full_name, ''),
      v_user_profile.title, v_user_profile.phone, v_user_profile.mobile,
      v_user_profile.website, v_user_profile.email_signature,
      v_user_profile.signature_logo_url,
      COALESCE(v_user_profile.signature_font, 'Arial, sans-serif'),
      COALESCE(v_user_profile.signature_color, '#333333')
    )
    ON CONFLICT (connection_id) DO NOTHING;

    -- Determine cap from user's group (defaults to 10)
    SELECT pg.max_categories INTO _cap
    FROM public.user_group_memberships ugm
    JOIN public.permission_groups pg ON pg.id = ugm.group_id
    WHERE ugm.user_id = NEW.user_id
      AND pg.organization_id = NEW.organization_id
    ORDER BY pg.display_order DESC
    LIMIT 1;
    IF _cap IS NULL OR _cap <= 0 THEN _cap := 10; END IF;
    IF _cap > array_length(default_cats, 1) THEN _cap := array_length(default_cats, 1); END IF;

    IF NOT EXISTS (SELECT 1 FROM public.categories WHERE connection_id = NEW.id) THEN
      FOR i IN 1.._cap LOOP
        INSERT INTO public.categories (
          organization_id, connection_id, name, color, sort_order,
          is_enabled, ai_draft_enabled, auto_reply_enabled
        )
        VALUES (
          NEW.organization_id, NEW.id, default_cats[i][1], default_cats[i][2],
          i - 1,
          true,   -- all categories enabled by default
          false,  -- AI Draft OFF until user enables
          false   -- AI Auto-Reply OFF until user enables
        );
      END LOOP;
    END IF;

    INSERT INTO public.ai_settings (organization_id, connection_id, writing_style)
    VALUES (NEW.organization_id, NEW.id, 'professional')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- One-shot cleanup: trim any existing connections to their group cap
SELECT public.trim_categories_to_group_cap();

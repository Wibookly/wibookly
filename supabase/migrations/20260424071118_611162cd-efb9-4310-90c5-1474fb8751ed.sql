-- Create a security definer RPC that signs up a user into the correct organization
-- based on their email domain (allowed_domains). Falls back to creating a new org
-- only for the super admin.

CREATE OR REPLACE FUNCTION public.signup_initialize_user(
  _full_name text,
  _title text DEFAULT NULL,
  _organization_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _email text;
  _domain text;
  _org_id uuid;
  _existing_profile uuid;
  _allowed_domain RECORD;
  _is_super boolean;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get email from auth.users
  SELECT email INTO _email FROM auth.users WHERE id = _user_id;
  IF _email IS NULL THEN
    RAISE EXCEPTION 'User email not found';
  END IF;

  -- If profile already exists, return its org
  SELECT organization_id INTO _existing_profile
  FROM public.user_profiles
  WHERE user_id = _user_id
  LIMIT 1;

  IF _existing_profile IS NOT NULL THEN
    RETURN _existing_profile;
  END IF;

  _domain := lower(split_part(_email, '@', 2));
  _is_super := public.is_super_admin(_email);

  -- Look up allowed domain
  SELECT * INTO _allowed_domain
  FROM public.allowed_domains
  WHERE lower(domain) = _domain AND is_active = true
  LIMIT 1;

  IF _allowed_domain.id IS NOT NULL THEN
    -- Find existing organization with the matching name, or create one
    SELECT id INTO _org_id
    FROM public.organizations
    WHERE lower(name) = lower(COALESCE(_allowed_domain.organization_name, _domain))
    LIMIT 1;

    IF _org_id IS NULL THEN
      INSERT INTO public.organizations (name)
      VALUES (COALESCE(_allowed_domain.organization_name, _domain))
      RETURNING id INTO _org_id;
    END IF;
  ELSIF _is_super THEN
    -- Super admin: use the fixed organization id
    _org_id := '00000000-0000-0000-0000-000000000001'::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id) THEN
      INSERT INTO public.organizations (id, name)
      VALUES (_org_id, COALESCE(_organization_name, 'Admin'));
    END IF;
  ELSE
    RAISE EXCEPTION 'Email domain % is not authorized. Please contact your administrator.', _domain;
  END IF;

  -- Create user profile
  INSERT INTO public.user_profiles (user_id, organization_id, email, full_name, title)
  VALUES (_user_id, _org_id, _email, _full_name, _title)
  ON CONFLICT DO NOTHING;

  -- Create membership
  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (_user_id, _org_id, 'member')
  ON CONFLICT DO NOTHING;

  -- Assign role: admin if first user in org or super admin, else member
  IF _is_super OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE organization_id = _org_id AND role = 'admin'
  ) THEN
    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (_user_id, _org_id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (_user_id, _org_id, 'member')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN _org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.signup_initialize_user(text, text, text) TO authenticated;
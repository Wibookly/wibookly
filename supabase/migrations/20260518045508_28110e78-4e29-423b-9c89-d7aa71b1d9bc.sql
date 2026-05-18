CREATE OR REPLACE FUNCTION public.update_my_about_me(
  _title text DEFAULT NULL,
  _responsibilities text DEFAULT NULL,
  _communication_style text DEFAULT NULL,
  _full_name text DEFAULT NULL,
  _company text DEFAULT NULL,
  _department text DEFAULT NULL,
  _business_phone text DEFAULT NULL,
  _mobile_phone text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_profiles
  SET
    title                = COALESCE(_title, title),
    responsibilities     = COALESCE(_responsibilities, responsibilities),
    communication_style  = COALESCE(_communication_style, communication_style),
    full_name            = COALESCE(_full_name, full_name),
    company              = COALESCE(_company, company),
    department           = COALESCE(_department, department),
    phone                = COALESCE(_business_phone, phone),
    mobile               = COALESCE(_mobile_phone, mobile),
    updated_at           = now()
  WHERE user_id = _uid;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_about_me(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_about_me(text,text,text,text,text,text,text,text) TO authenticated;
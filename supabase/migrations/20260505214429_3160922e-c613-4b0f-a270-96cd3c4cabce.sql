CREATE OR REPLACE FUNCTION public.get_org_user_directory(_organization_id uuid)
RETURNS TABLE(user_id uuid, full_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.user_id, up.full_name, up.email
  FROM public.user_profiles up
  WHERE up.organization_id = _organization_id
    AND (
      has_role_in_org(auth.uid(), 'admin'::app_role, _organization_id)
      OR is_super_admin((SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1))
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_org_user_directory(uuid) TO authenticated;
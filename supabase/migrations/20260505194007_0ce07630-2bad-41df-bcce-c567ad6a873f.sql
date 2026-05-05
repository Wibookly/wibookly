
CREATE OR REPLACE FUNCTION public.get_users_basic_info(_user_ids uuid[])
RETURNS TABLE(user_id uuid, email text, full_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.user_id, up.email, up.full_name
  FROM public.user_profiles up
  WHERE up.user_id = ANY(_user_ids)
    AND (
      public.is_super_admin((auth.jwt() ->> 'email'))
      OR up.organization_id = public.get_user_organization_id(auth.uid())
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_users_basic_info(uuid[]) TO authenticated;

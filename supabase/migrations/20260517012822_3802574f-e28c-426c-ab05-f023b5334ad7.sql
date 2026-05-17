DROP FUNCTION IF EXISTS public.get_my_profile();

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  organization_id uuid,
  email text,
  full_name text,
  title text,
  company text,
  department text,
  phone text,
  mobile text,
  role_description text,
  responsibilities text,
  communication_style text,
  profile_photo_url text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    up.id,
    up.user_id,
    up.organization_id,
    up.email,
    up.full_name,
    up.title,
    up.company,
    up.department,
    up.phone,
    up.mobile,
    up.role_description,
    up.responsibilities,
    up.communication_style,
    up.profile_photo_url,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
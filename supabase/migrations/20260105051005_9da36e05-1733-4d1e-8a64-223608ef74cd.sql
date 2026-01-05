-- Drop and recreate get_my_profile function to include title field
DROP FUNCTION IF EXISTS public.get_my_profile();

CREATE FUNCTION public.get_my_profile()
 RETURNS TABLE(id uuid, user_id uuid, organization_id uuid, email text, full_name text, title text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT
    up.id,
    up.user_id,
    up.organization_id,
    up.email,
    up.full_name,
    up.title,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
  LIMIT 1;
$$;
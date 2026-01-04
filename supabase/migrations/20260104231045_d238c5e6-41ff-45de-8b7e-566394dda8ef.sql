-- Update the get_my_connections function to include profile email as fallback
DROP FUNCTION IF EXISTS public.get_my_connections();

CREATE FUNCTION public.get_my_connections()
RETURNS TABLE (
  connected_at text,
  id uuid,
  is_connected boolean,
  organization_id uuid,
  provider text,
  connected_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pc.connected_at::text,
    pc.id,
    pc.is_connected,
    pc.organization_id,
    pc.provider,
    COALESCE(pc.connected_email, up.email) as connected_email
  FROM provider_connections pc
  LEFT JOIN user_profiles up ON pc.user_id = up.user_id
  WHERE pc.user_id = auth.uid();
END;
$$;
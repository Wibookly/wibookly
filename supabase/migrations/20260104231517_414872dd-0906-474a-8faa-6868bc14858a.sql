-- Add connected_email column to provider_connections if it doesn't exist
ALTER TABLE public.provider_connections ADD COLUMN IF NOT EXISTS connected_email text;

-- Recreate the function to handle the case where connected_email might be null
CREATE OR REPLACE FUNCTION public.get_my_connections()
 RETURNS TABLE(connected_at text, id uuid, is_connected boolean, organization_id uuid, provider text, connected_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
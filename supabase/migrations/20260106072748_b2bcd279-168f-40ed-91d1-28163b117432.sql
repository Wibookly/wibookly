-- Add calendar_connected column to provider_connections to track calendar access
ALTER TABLE public.provider_connections 
ADD COLUMN IF NOT EXISTS calendar_connected boolean NOT NULL DEFAULT false;

-- Add calendar_connected_at column
ALTER TABLE public.provider_connections 
ADD COLUMN IF NOT EXISTS calendar_connected_at timestamp with time zone;

-- Drop existing function first to allow return type change
DROP FUNCTION IF EXISTS public.get_my_connections();

-- Recreate get_my_connections function with calendar fields
CREATE FUNCTION public.get_my_connections()
 RETURNS TABLE(connected_at text, id uuid, is_connected boolean, organization_id uuid, provider text, connected_email text, calendar_connected boolean, calendar_connected_at text)
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
    COALESCE(pc.connected_email, up.email) as connected_email,
    pc.calendar_connected,
    pc.calendar_connected_at::text
  FROM provider_connections pc
  LEFT JOIN user_profiles up ON pc.user_id = up.user_id
  WHERE pc.user_id = auth.uid();
END;
$function$;
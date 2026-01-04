-- Create a function to get all organizations a user belongs to
CREATE OR REPLACE FUNCTION public.get_user_organizations(_user_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT 
    o.id,
    o.name,
    COALESCE(ur.role::text, om.role) as role
  FROM organizations o
  LEFT JOIN user_profiles up ON up.organization_id = o.id AND up.user_id = _user_id
  LEFT JOIN user_roles ur ON ur.organization_id = o.id AND ur.user_id = _user_id
  LEFT JOIN organization_members om ON om.organization_id = o.id AND om.user_id = _user_id
  WHERE up.user_id = _user_id 
     OR ur.user_id = _user_id 
     OR om.user_id = _user_id
$$;
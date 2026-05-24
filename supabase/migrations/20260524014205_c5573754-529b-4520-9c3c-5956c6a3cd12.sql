-- 1) Restrict self-insert into organization_members to allowed domains / super admin
DROP POLICY IF EXISTS "members_insert_self" ON public.organization_members;

CREATE POLICY "members_insert_self_allowed_domain"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    public.is_current_user_super_admin()
    OR EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.allowed_domains ad
        ON ad.is_active = true
       AND lower(ad.domain) = lower(split_part(u.email, '@', 2))
      LEFT JOIN public.organizations o
        ON lower(o.name) = lower(COALESCE(ad.organization_name, ad.domain))
      WHERE u.id = auth.uid()
        AND (
          o.id = organization_members.organization_id
          OR organization_members.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
        )
    )
  )
);

-- 2) Fix volatility of is_super_admin(text)
CREATE OR REPLACE FUNCTION public.is_super_admin(_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT lower(_email) = 'arahimi@energyforward.com'
$function$;
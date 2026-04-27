
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read of org logos
DROP POLICY IF EXISTS "Org logos are publicly readable" ON storage.objects;
CREATE POLICY "Org logos are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'org-logos');

-- Authenticated users in the matching org can upload (folder = org id)
DROP POLICY IF EXISTS "Org admins can upload org logo" ON storage.objects;
CREATE POLICY "Org admins can upload org logo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'org-logos'
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Org admins can update org logo" ON storage.objects;
CREATE POLICY "Org admins can update org logo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'org-logos'
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Org admins can delete org logo" ON storage.objects;
CREATE POLICY "Org admins can delete org logo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'org-logos'
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, ((storage.foldername(name))[1])::uuid)
);

-- Allow members to update logo_url on their own organization
DROP POLICY IF EXISTS "Org admins can update their organization" ON public.organizations;
CREATE POLICY "Org admins can update their organization"
ON public.organizations
FOR UPDATE
TO authenticated
USING (public.has_role_in_org(auth.uid(), 'admin'::app_role, id))
WITH CHECK (public.has_role_in_org(auth.uid(), 'admin'::app_role, id));

DROP POLICY IF EXISTS "Members can read their organization" ON public.organizations;
CREATE POLICY "Members can read their organization"
ON public.organizations
FOR SELECT
TO authenticated
USING (public.is_org_member(auth.uid(), id) OR public.is_super_admin((SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)));

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

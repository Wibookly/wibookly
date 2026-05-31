-- Tighten follow_up_trackers admin write policies to org-scoped role checks
DROP POLICY IF EXISTS "admins delete org trackers" ON public.follow_up_trackers;
DROP POLICY IF EXISTS "admins modify org trackers (non-select)" ON public.follow_up_trackers;
DROP POLICY IF EXISTS "admins update org trackers" ON public.follow_up_trackers;

CREATE POLICY "admins insert org trackers"
ON public.follow_up_trackers
FOR INSERT
WITH CHECK (public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id));

CREATE POLICY "admins update org trackers"
ON public.follow_up_trackers
FOR UPDATE
USING (public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id))
WITH CHECK (public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id));

CREATE POLICY "admins delete org trackers"
ON public.follow_up_trackers
FOR DELETE
USING (public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id));
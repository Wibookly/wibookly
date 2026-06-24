
-- Fix 1: Scope agent_messages SELECT to organization
DROP POLICY IF EXISTS "Users can view their own agent messages" ON public.agent_messages;
CREATE POLICY "Users can view their own agent messages"
ON public.agent_messages
FOR SELECT
USING (
  is_current_user_super_admin()
  OR (
    organization_id = public.get_user_organization_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_connections pc
      WHERE pc.user_id = auth.uid()
        AND lower(pc.connected_email) = lower(agent_messages.sender_email)
    )
  )
);

-- Fix 2: allowed_domains - add explicit deny-by-default by ensuring RLS is enabled (no SELECT for non-super-admins)
ALTER TABLE public.allowed_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowed_domains FORCE ROW LEVEL SECURITY;

-- Fix 3: support-attachments storage UPDATE/DELETE policies
DROP POLICY IF EXISTS "Users update their own support attachments" ON storage.objects;
CREATE POLICY "Users update their own support attachments"
ON storage.objects FOR UPDATE
USING (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete their own support attachments" ON storage.objects;
CREATE POLICY "Users delete their own support attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Admins delete support attachments" ON storage.objects;
CREATE POLICY "Admins delete support attachments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'support-attachments'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY['admin'::app_role, 'super_admin'::app_role])
  )
);

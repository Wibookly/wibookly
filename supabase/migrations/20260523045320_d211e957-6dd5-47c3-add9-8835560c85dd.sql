
-- 1. Backup tables: enable RLS, service role only
ALTER TABLE public.backup_group_features_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_permission_groups_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON public.backup_group_features_v2;
CREATE POLICY "Service role only" ON public.backup_group_features_v2
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role only" ON public.backup_permission_groups_v2;
CREATE POLICY "Service role only" ON public.backup_permission_groups_v2
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2. Profile photos storage: require auth + owner folder match
DROP POLICY IF EXISTS "Service role write profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Service role update profile photos" ON storage.objects;

CREATE POLICY "Authenticated users upload own profile photo"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Authenticated users update own profile photo"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Authenticated users delete own profile photo"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Service role manages profile photos"
  ON storage.objects
  FOR ALL
  TO public
  USING (bucket_id = 'profile-photos' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'profile-photos' AND auth.role() = 'service_role');

-- 3. follow_up_trackers: restrict member read to own rows; admins keep full access
DROP POLICY IF EXISTS "members view org trackers" ON public.follow_up_trackers;

CREATE POLICY "users view own trackers"
  ON public.follow_up_trackers
  FOR SELECT
  USING (user_id = auth.uid());

-- 4. subscriptions: restrict SELECT to org admins (and owning user)
DROP POLICY IF EXISTS "Users can view their organization subscription" ON public.subscriptions;

CREATE POLICY "Org admins view subscription"
  ON public.subscriptions
  FOR SELECT
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
    )
  );

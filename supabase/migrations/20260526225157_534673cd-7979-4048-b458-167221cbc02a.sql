
-- ai_activity_logs: restrict reads to owner; super admin sees all
DROP POLICY IF EXISTS "Users can view AI activity in their organization" ON public.ai_activity_logs;
CREATE POLICY "Users view own AI activity"
  ON public.ai_activity_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_current_user_super_admin());

-- alert_recipients: super admin only
DROP POLICY IF EXISTS "Admins manage alert recipients" ON public.alert_recipients;
CREATE POLICY "Super admin manages alert recipients"
  ON public.alert_recipients FOR ALL TO authenticated
  USING (public.is_current_user_super_admin())
  WITH CHECK (public.is_current_user_super_admin());

-- integration_settings: super admin only
DROP POLICY IF EXISTS "integration_settings admin read" ON public.integration_settings;
DROP POLICY IF EXISTS "integration_settings admin write" ON public.integration_settings;
CREATE POLICY "Super admin reads integration settings"
  ON public.integration_settings FOR SELECT TO authenticated
  USING (public.is_current_user_super_admin());
CREATE POLICY "Super admin writes integration settings"
  ON public.integration_settings FOR ALL TO authenticated
  USING (public.is_current_user_super_admin())
  WITH CHECK (public.is_current_user_super_admin());

-- sms_provider_config: super admin only
DROP POLICY IF EXISTS "Admins manage SMS provider config" ON public.sms_provider_config;
CREATE POLICY "Super admin manages SMS provider config"
  ON public.sms_provider_config FOR ALL TO authenticated
  USING (public.is_current_user_super_admin())
  WITH CHECK (public.is_current_user_super_admin());

-- system_flags: super admin only
DROP POLICY IF EXISTS "system_flags admin read" ON public.system_flags;
DROP POLICY IF EXISTS "system_flags admin write" ON public.system_flags;
CREATE POLICY "Super admin reads system flags"
  ON public.system_flags FOR SELECT TO authenticated
  USING (public.is_current_user_super_admin());
CREATE POLICY "Super admin writes system flags"
  ON public.system_flags FOR ALL TO authenticated
  USING (public.is_current_user_super_admin())
  WITH CHECK (public.is_current_user_super_admin());

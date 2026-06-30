
-- 1. agent_messages: tighten SELECT for shared mailboxes
DROP POLICY IF EXISTS "Users can view their own agent messages" ON public.agent_messages;
CREATE POLICY "Users can view their own agent messages"
ON public.agent_messages FOR SELECT TO authenticated
USING (
  is_current_user_super_admin()
  OR (
    organization_id = get_user_organization_id(auth.uid())
    AND (
      EXISTS (
        SELECT 1 FROM public.provider_connections pc
        WHERE pc.user_id = auth.uid()
          AND lower(pc.connected_email) = lower(agent_messages.sender_email)
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.agent_settings s
          WHERE s.organization_id = agent_messages.organization_id
            AND lower(s.shared_mailbox_address) = lower(agent_messages.sender_email)
        )
        AND has_role_in_org(auth.uid(), 'admin'::app_role, agent_messages.organization_id)
      )
    )
  )
);

-- 2. org_environment_credentials: restrictive deny for non-service roles
DROP POLICY IF EXISTS "deny_non_service_access" ON public.org_environment_credentials;
CREATE POLICY "deny_non_service_access"
ON public.org_environment_credentials
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- 3. suppressed_emails: restrictive deny for non-service roles
DROP POLICY IF EXISTS "deny_non_service_access" ON public.suppressed_emails;
CREATE POLICY "deny_non_service_access"
ON public.suppressed_emails
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- 4. user_profiles: tighten INSERT — require invitation or existing org member with same domain
DROP POLICY IF EXISTS "users_insert_own_profile_only" ON public.user_profiles;
CREATE POLICY "users_insert_own_profile_only"
ON public.user_profiles FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    is_super_admin(email)
    -- Valid pending invitation for this email + org
    OR EXISTS (
      SELECT 1 FROM public.user_invitations ui
      WHERE lower(ui.email) = lower(user_profiles.email)
        AND ui.organization_id = user_profiles.organization_id
        AND ui.used_at IS NULL
        AND ui.expires_at > now()
    )
    -- Org already has a member with same email domain (claimed domain)
    OR EXISTS (
      SELECT 1 FROM public.user_profiles existing
      WHERE existing.organization_id = user_profiles.organization_id
        AND lower(split_part(existing.email, '@', 2)) = lower(split_part(user_profiles.email, '@', 2))
    )
  )
);

-- 5. user_roles: tighten INSERT to current org + prevent self-promotion
DROP POLICY IF EXISTS "Org admins can insert roles in their org" ON public.user_roles;
CREATE POLICY "Org admins can insert roles in their org"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (
  organization_id = get_user_organization_id(auth.uid())
  AND organization_id = get_current_org_id()
  AND has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  AND user_id <> auth.uid()
);

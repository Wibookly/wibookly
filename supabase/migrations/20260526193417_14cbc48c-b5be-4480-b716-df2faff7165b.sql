
-- 1) Drop sensitive temp_password column from user_invitations.
--    Temporary passwords must never be stored or readable by any admin.
ALTER TABLE public.user_invitations DROP COLUMN IF EXISTS temp_password;

-- 2) integration_health is platform-level (published to Realtime).
--    Restrict SELECT and ALL to super admin only — any-org admin must NOT
--    be able to read other tenants' health rows via Realtime.
DROP POLICY IF EXISTS "integration_health admin read" ON public.integration_health;
DROP POLICY IF EXISTS "integration_health admin write" ON public.integration_health;

CREATE POLICY "integration_health super admin read"
ON public.integration_health
FOR SELECT
TO authenticated
USING (public.is_current_user_super_admin());

CREATE POLICY "integration_health super admin write"
ON public.integration_health
FOR ALL
TO authenticated
USING (public.is_current_user_super_admin())
WITH CHECK (public.is_current_user_super_admin());

CREATE POLICY "integration_health service role"
ON public.integration_health
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3) tool_diagnostics has SELECT policies but no write policies.
--    Add INSERT for users (own rows) and full access for service role.
CREATE POLICY "Users insert own tool_diagnostics"
ON public.tool_diagnostics
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role manages tool_diagnostics"
ON public.tool_diagnostics
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

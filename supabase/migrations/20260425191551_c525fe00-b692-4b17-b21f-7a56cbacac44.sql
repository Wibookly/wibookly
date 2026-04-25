-- Discovered tenant users (cached directory from Microsoft Graph)
CREATE TABLE IF NOT EXISTS public.discovered_tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES public.allowed_domains(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ms_user_id text NOT NULL,
  email text NOT NULL,
  display_name text,
  job_title text,
  is_licensed boolean NOT NULL DEFAULT false,
  account_enabled boolean NOT NULL DEFAULT true,
  invited_user_id uuid,
  invited_at timestamptz,
  status text NOT NULL DEFAULT 'discovered',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(domain_id, ms_user_id)
);

CREATE INDEX IF NOT EXISTS idx_discovered_tenant_users_domain ON public.discovered_tenant_users(domain_id);
CREATE INDEX IF NOT EXISTS idx_discovered_tenant_users_email ON public.discovered_tenant_users(lower(email));

ALTER TABLE public.discovered_tenant_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view discovered users in their org"
ON public.discovered_tenant_users
FOR SELECT
TO authenticated
USING (
  has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  OR is_super_admin((SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1))
);

CREATE POLICY "Service role manages discovered users"
ON public.discovered_tenant_users
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Invitations table
CREATE TABLE IF NOT EXISTS public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id uuid REFERENCES public.allowed_domains(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  token text NOT NULL UNIQUE,
  mode text NOT NULL DEFAULT 'sso_magic_link', -- 'sso_magic_link' | 'temp_password'
  temp_password text, -- only set when mode='temp_password'; consumed and cleared on first login
  invited_by uuid,
  group_id uuid REFERENCES public.permission_groups(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON public.user_invitations(token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON public.user_invitations(lower(email));

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view invitations in their org"
ON public.user_invitations
FOR SELECT
TO authenticated
USING (
  has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  OR is_super_admin((SELECT email FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1))
);

CREATE POLICY "Service role manages invitations"
ON public.user_invitations
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Add auto-connect & first-login flags to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS microsoft_auto_connect boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_outlook_connect boolean NOT NULL DEFAULT false;

-- Track last directory sync per domain
ALTER TABLE public.allowed_domains
  ADD COLUMN IF NOT EXISTS last_directory_sync_at timestamptz;
-- Drop earlier per-user scaffolding (never shipped).
DROP VIEW IF EXISTS public.egnyte_connection_status;
DROP TABLE IF EXISTS public.egnyte_connections;

-- ============================================================
-- 1) integration_definitions — static catalog
-- ============================================================
CREATE TABLE public.integration_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  icon_url text,
  category text,
  auth_type text NOT NULL,
  requires_subdomain boolean NOT NULL DEFAULT false,
  subdomain_label text,
  subdomain_suffix text,
  available_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  docs_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.integration_definitions TO authenticated;
GRANT ALL ON public.integration_definitions TO service_role;
ALTER TABLE public.integration_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "integration_definitions_read"
  ON public.integration_definitions FOR SELECT TO authenticated USING (is_active = true);

INSERT INTO public.integration_definitions
  (slug, display_name, description, category, auth_type,
   requires_subdomain, subdomain_label, subdomain_suffix,
   available_scopes, default_scopes, docs_url)
VALUES (
  'egnyte',
  'Egnyte',
  'Connect your Egnyte domain to search files, folders, and share links from InboxIQ and AI Chat.',
  'storage',
  'oauth2_authcode',
  true,
  'Your Egnyte domain',
  '.egnyte.com',
  '["Egnyte.filesystem","Egnyte.link","Egnyte.user","Egnyte.permission"]'::jsonb,
  '["Egnyte.filesystem","Egnyte.link"]'::jsonb,
  'https://developers.egnyte.com/docs/read/getting_started'
);

-- ============================================================
-- 2) tenant_integrations — per-org connection state
-- ============================================================
CREATE TABLE public.tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_slug text NOT NULL REFERENCES public.integration_definitions(slug),

  subdomain text,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,

  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,

  status text NOT NULL DEFAULT 'disconnected',   -- disconnected|pending|connected|error|expired
  last_error text,
  last_synced_at timestamptz,
  connected_by uuid REFERENCES auth.users(id),
  connected_email text,
  connected_at timestamptz,

  enabled boolean NOT NULL DEFAULT false,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, integration_slug)
);
GRANT SELECT ON public.tenant_integrations TO authenticated;   -- narrowed by RLS + safe view below
GRANT ALL ON public.tenant_integrations TO service_role;
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

-- Deny direct writes from the client — all mutations must go through edge functions.
CREATE POLICY "tenant_integrations_no_client_insert"
  ON public.tenant_integrations FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "tenant_integrations_no_client_update"
  ON public.tenant_integrations FOR UPDATE TO authenticated USING (false);
CREATE POLICY "tenant_integrations_no_client_delete"
  ON public.tenant_integrations FOR DELETE TO authenticated USING (false);
-- No SELECT policy on the table itself — the safe view is the read path.
CREATE POLICY "tenant_integrations_no_client_select"
  ON public.tenant_integrations FOR SELECT TO authenticated USING (false);

CREATE TRIGGER tenant_integrations_touch
BEFORE UPDATE ON public.tenant_integrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Safe projection (no token material) — this is what the app queries.
CREATE OR REPLACE VIEW public.tenant_integrations_safe
WITH (security_invoker = true) AS
SELECT
  ti.id,
  ti.organization_id,
  ti.integration_slug,
  ti.subdomain,
  ti.granted_scopes,
  ti.status,
  ti.last_error,
  ti.last_synced_at,
  ti.connected_by,
  ti.connected_email,
  ti.connected_at,
  ti.enabled,
  ti.feature_flags,
  ti.token_expires_at,
  ti.created_at,
  ti.updated_at
FROM public.tenant_integrations ti
WHERE ti.organization_id = public.get_user_organization_id(auth.uid());

GRANT SELECT ON public.tenant_integrations_safe TO authenticated;

-- ============================================================
-- 3) oauth_states — short-lived CSRF/correlation store
-- ============================================================
CREATE TABLE public.oauth_states (
  state text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_slug text NOT NULL REFERENCES public.integration_definitions(slug),
  subdomain text NOT NULL,
  requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  return_path text,
  created_by uuid REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.oauth_states TO service_role;
-- No grants to authenticated — only edge functions (service role) touch this.
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oauth_states_no_client"
  ON public.oauth_states FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE INDEX oauth_states_expires_idx ON public.oauth_states(expires_at);

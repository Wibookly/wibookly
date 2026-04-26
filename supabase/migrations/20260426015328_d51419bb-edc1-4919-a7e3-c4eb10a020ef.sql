
-- Agent settings (one row per organization)
CREATE TABLE public.agent_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE,
  email_agent_enabled BOOLEAN NOT NULL DEFAULT false,
  teams_agent_enabled BOOLEAN NOT NULL DEFAULT false,
  shared_mailbox_address TEXT,
  shared_mailbox_user_id TEXT,
  graph_subscription_id TEXT,
  graph_subscription_expires_at TIMESTAMPTZ,
  teams_tenant_id TEXT,
  teams_bot_app_id TEXT,
  -- Allowed sender domains (lowercased). If empty, defaults to org's allowed_domains.
  allowed_sender_domains TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view org agent settings"
  ON public.agent_settings FOR SELECT
  USING (organization_id = public.get_user_organization_id(auth.uid()));

CREATE POLICY "admins can manage org agent settings"
  ON public.agent_settings FOR ALL
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  );

CREATE POLICY "service role manages agent settings"
  ON public.agent_settings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER update_agent_settings_updated_at
  BEFORE UPDATE ON public.agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Agent messages (audit log)
CREATE TABLE public.agent_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','teams')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_email TEXT,
  sender_aad_id TEXT,
  sender_domain TEXT,
  subject TEXT,
  content TEXT,
  response_to_id UUID REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  external_message_id TEXT,
  conversation_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  rejected_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_messages_org_created ON public.agent_messages(organization_id, created_at DESC);
CREATE INDEX idx_agent_messages_external_id ON public.agent_messages(external_message_id);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can view org agent messages"
  ON public.agent_messages FOR SELECT
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  );

CREATE POLICY "service role manages agent messages"
  ON public.agent_messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

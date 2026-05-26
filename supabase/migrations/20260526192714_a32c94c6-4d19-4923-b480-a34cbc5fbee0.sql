
-- Recipients of admin alert notifications (email and/or SMS)
CREATE TABLE public.alert_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  min_severity TEXT NOT NULL DEFAULT 'warning' CHECK (min_severity IN ('warning','failed')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_recipients TO authenticated;
GRANT ALL ON public.alert_recipients TO service_role;

ALTER TABLE public.alert_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage alert recipients"
ON public.alert_recipients FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Singleton-style SMS provider configuration (non-secret fields)
CREATE TABLE public.sms_provider_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'twilio' CHECK (provider IN ('twilio')),
  from_number TEXT,
  account_sid_hint TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_provider_config TO authenticated;
GRANT ALL ON public.sms_provider_config TO service_role;

ALTER TABLE public.sms_provider_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage SMS provider config"
ON public.sms_provider_config FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default recipient (super admin) and an empty Twilio config row
INSERT INTO public.alert_recipients (name, email, email_enabled, sms_enabled, min_severity)
VALUES ('Super Admin', 'arahimi@energyforward.com', true, false, 'failed');

INSERT INTO public.sms_provider_config (provider, enabled) VALUES ('twilio', false);

CREATE TRIGGER trg_alert_recipients_updated
BEFORE UPDATE ON public.alert_recipients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_sms_provider_config_updated
BEFORE UPDATE ON public.sms_provider_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

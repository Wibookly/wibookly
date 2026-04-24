ALTER TABLE public.allowed_domains
  ADD COLUMN IF NOT EXISTS microsoft_tenant_id text,
  ADD COLUMN IF NOT EXISTS microsoft_consent_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS microsoft_consent_granted_at timestamptz;
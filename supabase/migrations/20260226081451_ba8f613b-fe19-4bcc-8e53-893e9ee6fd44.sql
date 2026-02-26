
-- Table to store admin-managed API keys securely
CREATE TABLE public.api_key_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_name text NOT NULL UNIQUE,
  encrypted_value text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

-- Enable RLS
ALTER TABLE public.api_key_config ENABLE ROW LEVEL SECURITY;

-- Only super admin (via service role in edge function) can access
-- Block all client-side access
CREATE POLICY "no_client_access" ON public.api_key_config FOR ALL USING (false);

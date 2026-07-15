-- Per-user Egnyte OAuth connections (tokens AES-GCM encrypted at rest with TOKEN_ENCRYPTION_KEY).
CREATE TABLE IF NOT EXISTS public.egnyte_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  egnyte_domain text NOT NULL,           -- e.g. 4steleng.egnyte.com
  egnyte_username text,                  -- captured from Egnyte /userinfo
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.egnyte_connections TO authenticated;
GRANT ALL ON public.egnyte_connections TO service_role;

ALTER TABLE public.egnyte_connections ENABLE ROW LEVEL SECURITY;

-- Deny direct client access to encrypted tokens; users read only through edge functions.
CREATE POLICY "egnyte_no_client_select" ON public.egnyte_connections FOR SELECT USING (false);
CREATE POLICY "egnyte_no_client_insert" ON public.egnyte_connections FOR INSERT WITH CHECK (false);
CREATE POLICY "egnyte_no_client_update" ON public.egnyte_connections FOR UPDATE USING (false);
CREATE POLICY "egnyte_no_client_delete" ON public.egnyte_connections FOR DELETE USING (false);

-- Safe metadata view for clients (no token material).
CREATE OR REPLACE VIEW public.egnyte_connection_status
WITH (security_invoker = true)
AS
SELECT
  user_id,
  egnyte_domain,
  egnyte_username,
  expires_at,
  updated_at,
  created_at
FROM public.egnyte_connections
WHERE user_id = auth.uid();

GRANT SELECT ON public.egnyte_connection_status TO authenticated;

CREATE TRIGGER egnyte_connections_touch
BEFORE UPDATE ON public.egnyte_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

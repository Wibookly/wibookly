
-- 1.1 m365_api_health
CREATE TABLE IF NOT EXISTS public.m365_api_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  api_name text NOT NULL CHECK (api_name IN ('mail','onedrive','sharepoint','calendar','user','auth')),
  status text NOT NULL CHECK (status IN ('healthy','degraded','failed')),
  endpoint text,
  response_ms int,
  error_code text,
  error_message text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.m365_api_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own API health" ON public.m365_api_health;
CREATE POLICY "Users see own API health"
  ON public.m365_api_health FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages API health" ON public.m365_api_health;
CREATE POLICY "Service role manages API health"
  ON public.m365_api_health FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_health_recent
  ON public.m365_api_health(user_id, api_name, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_failures
  ON public.m365_api_health(user_id, checked_at DESC)
  WHERE status = 'failed';

-- 1.2 Extend oauth_token_vault
ALTER TABLE public.oauth_token_vault
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS refresh_failure_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_refresh_error text,
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS requires_reauth boolean NOT NULL DEFAULT false;

-- Backfill connection_id from oldest matching provider_connection
UPDATE public.oauth_token_vault v
SET connection_id = sub.pc_id
FROM (
  SELECT DISTINCT ON (pc.user_id, pc.provider)
    pc.user_id, pc.provider, pc.id AS pc_id
  FROM public.provider_connections pc
  ORDER BY pc.user_id, pc.provider, pc.created_at ASC
) sub
WHERE v.connection_id IS NULL
  AND v.user_id = sub.user_id
  AND v.provider = sub.provider;

CREATE INDEX IF NOT EXISTS idx_vault_lookup
  ON public.oauth_token_vault(user_id, provider, connection_id);

CREATE INDEX IF NOT EXISTS idx_vault_reauth
  ON public.oauth_token_vault(user_id)
  WHERE requires_reauth = true;

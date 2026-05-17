
-- Phase 6: M365 sync state + sync jobs

CREATE TABLE IF NOT EXISTS public.m365_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('mail','onedrive','sharepoint','calendar')),
  delta_link text,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, source)
);

ALTER TABLE public.m365_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own sync state"
  ON public.m365_sync_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages sync state"
  ON public.m365_sync_state FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_sync_state_connection ON public.m365_sync_state(connection_id, source);


CREATE TABLE IF NOT EXISTS public.m365_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('mail','onedrive','sharepoint','calendar')),
  sync_type text NOT NULL CHECK (sync_type IN ('full','delta','webhook','manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','failed')),
  items_processed int NOT NULL DEFAULT 0,
  items_failed int NOT NULL DEFAULT 0,
  error_message text,
  retry_after timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.m365_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own sync jobs"
  ON public.m365_sync_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own sync jobs"
  ON public.m365_sync_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages sync jobs"
  ON public.m365_sync_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_sync_jobs_user_created ON public.m365_sync_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON public.m365_sync_jobs(status) WHERE status IN ('queued','running');

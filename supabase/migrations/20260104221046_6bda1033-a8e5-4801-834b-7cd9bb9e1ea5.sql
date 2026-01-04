-- Connect attempt logging table
CREATE TABLE IF NOT EXISTS public.connect_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  provider text NOT NULL,
  stage text NOT NULL,
  error_code text NULL,
  error_message text NULL,
  app_origin text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.connect_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_connect_attempts_user_created_at
  ON public.connect_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connect_attempts_org_created_at
  ON public.connect_attempts (organization_id, created_at DESC);

-- RLS: users can create/view their own attempts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connect_attempts'
      AND policyname = 'Users can view their own connect attempts'
  ) THEN
    CREATE POLICY "Users can view their own connect attempts"
    ON public.connect_attempts
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connect_attempts'
      AND policyname = 'Users can insert their own connect attempts'
  ) THEN
    CREATE POLICY "Users can insert their own connect attempts"
    ON public.connect_attempts
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

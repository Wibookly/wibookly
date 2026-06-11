
CREATE TABLE public.user_client_status (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID,
  browser_name TEXT,
  browser_version TEXT,
  os_name TEXT,
  device_type TEXT,
  user_agent TEXT,
  tts_state TEXT NOT NULL DEFAULT 'unused',
  tts_error TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_client_status TO authenticated;
GRANT ALL ON public.user_client_status TO service_role;

ALTER TABLE public.user_client_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own client status"
ON public.user_client_status
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "org admins read org client status"
ON public.user_client_status
FOR SELECT TO authenticated
USING (
  organization_id IS NOT NULL
  AND public.is_org_admin(auth.uid(), organization_id)
);

CREATE INDEX user_client_status_org_idx ON public.user_client_status(organization_id);

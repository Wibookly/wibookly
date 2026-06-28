
-- Scheduled outbox for The Helm replies the user wants sent later.
CREATE TABLE IF NOT EXISTS public.scheduled_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid,
  item_id uuid REFERENCES public.helm_items(id) ON DELETE CASCADE,
  body text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued',  -- queued | sending | sent | cancelled | failed
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  draft_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_outbox TO authenticated;
GRANT ALL ON public.scheduled_outbox TO service_role;

ALTER TABLE public.scheduled_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduled_outbox owner select"
  ON public.scheduled_outbox FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "scheduled_outbox owner insert"
  ON public.scheduled_outbox FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "scheduled_outbox owner update"
  ON public.scheduled_outbox FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "scheduled_outbox owner delete"
  ON public.scheduled_outbox FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS scheduled_outbox_due_idx
  ON public.scheduled_outbox (status, scheduled_for);
CREATE INDEX IF NOT EXISTS scheduled_outbox_user_idx
  ON public.scheduled_outbox (user_id, status);

CREATE OR REPLACE FUNCTION public.scheduled_outbox_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS scheduled_outbox_touch_tr ON public.scheduled_outbox;
CREATE TRIGGER scheduled_outbox_touch_tr
  BEFORE UPDATE ON public.scheduled_outbox
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_outbox_touch();

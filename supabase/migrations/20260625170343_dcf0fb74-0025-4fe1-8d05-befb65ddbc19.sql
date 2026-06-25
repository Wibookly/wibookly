
-- tracked_emails: replaces BCC-based follow_up_trackers with Outlook flag/category triggered tracking
CREATE TABLE public.tracked_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  connection_id UUID,
  graph_message_id TEXT NOT NULL,
  internet_message_id TEXT NOT NULL,
  conversation_id TEXT,
  recipient_address TEXT,
  recipient_name TEXT,
  subject TEXT,
  body_preview TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('flag','category')),
  trigger_detail JSONB,
  follow_up_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','replied','drafted','cancelled','exhausted','error')),
  last_checked_at TIMESTAMPTZ,
  last_draft_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, internet_message_id)
);

CREATE INDEX idx_tracked_emails_user_status ON public.tracked_emails(user_id, status);
CREATE INDEX idx_tracked_emails_due ON public.tracked_emails(status, follow_up_at) WHERE status = 'pending';
CREATE INDEX idx_tracked_emails_conversation ON public.tracked_emails(conversation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_emails TO authenticated;
GRANT ALL ON public.tracked_emails TO service_role;

ALTER TABLE public.tracked_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tracked_emails"
  ON public.tracked_emails FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- graph_health: log of each preflight probe run
CREATE TABLE public.graph_health (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  connection_id UUID,
  probe TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','warn','skipped')),
  detail JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_graph_health_user_recent ON public.graph_health(user_id, checked_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.graph_health TO authenticated;
GRANT ALL ON public.graph_health TO service_role;

ALTER TABLE public.graph_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own graph_health"
  ON public.graph_health FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own graph_health"
  ON public.graph_health FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own graph_health"
  ON public.graph_health FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_tracked_emails_updated_at
  BEFORE UPDATE ON public.tracked_emails
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

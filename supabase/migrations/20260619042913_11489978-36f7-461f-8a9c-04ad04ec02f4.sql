
CREATE TABLE public.daily_brief_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID,
  brief_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT NOT NULL DEFAULT 'email',
  fingerprint TEXT NOT NULL,
  priority INTEGER,
  urgency TEXT,
  title TEXT NOT NULL,
  from_text TEXT,
  subject TEXT,
  received_at TEXT,
  context TEXT,
  action TEXT,
  why TEXT,
  estimated_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  carried_from_date DATE,
  carry_count INTEGER NOT NULL DEFAULT 0,
  reminder_at TIMESTAMPTZ,
  calendar_event_id TEXT,
  completed_at TIMESTAMPTZ,
  snoozed_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_brief_tasks_user_fp_date_unique UNIQUE (user_id, fingerprint, brief_date)
);

CREATE INDEX idx_daily_brief_tasks_user_status ON public.daily_brief_tasks (user_id, status);
CREATE INDEX idx_daily_brief_tasks_conn_date ON public.daily_brief_tasks (connection_id, brief_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_brief_tasks TO authenticated;
GRANT ALL ON public.daily_brief_tasks TO service_role;

ALTER TABLE public.daily_brief_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own daily brief tasks"
  ON public.daily_brief_tasks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access daily brief tasks"
  ON public.daily_brief_tasks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_daily_brief_tasks_updated_at
  BEFORE UPDATE ON public.daily_brief_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

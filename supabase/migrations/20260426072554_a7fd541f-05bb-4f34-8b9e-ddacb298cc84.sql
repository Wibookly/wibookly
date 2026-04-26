
-- 1. Mark categories as follow-up categories
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_follow_up boolean NOT NULL DEFAULT false;

-- 2. Follow-up steps table (up to 3 escalating reminders per category)
CREATE TABLE IF NOT EXISTS public.follow_up_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  step_order integer NOT NULL CHECK (step_order BETWEEN 1 AND 3),
  days_after_send integer NOT NULL CHECK (days_after_send > 0),
  action text NOT NULL DEFAULT 'draft' CHECK (action IN ('draft','auto_send')),
  message_template text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_steps_category ON public.follow_up_steps(category_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_steps_org ON public.follow_up_steps(organization_id);

ALTER TABLE public.follow_up_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view follow-up steps in their org"
  ON public.follow_up_steps FOR SELECT
  USING (organization_id = public.get_user_organization_id(auth.uid()));

CREATE POLICY "admins can manage follow-up steps"
  ON public.follow_up_steps FOR ALL
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
  );

CREATE POLICY "service role manages follow-up steps"
  ON public.follow_up_steps FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_follow_up_steps_updated_at
  BEFORE UPDATE ON public.follow_up_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. AI usage logs — track every AI call for per-user cost reporting
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid,
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','lovable_ai','google')),
  model text NOT NULL,
  action text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org_date ON public.ai_usage_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON public.ai_usage_logs(user_id, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can view org ai usage"
  ON public.ai_usage_logs FOR SELECT
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::public.app_role, organization_id)
  );

CREATE POLICY "users can view own ai usage"
  ON public.ai_usage_logs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "service role manages ai usage"
  ON public.ai_usage_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. Seed 3 default follow-up categories for the existing org/connection if none exist yet
DO $$
DECLARE
  v_conn RECORD;
  v_cat_id uuid;
  v_defaults int[] := ARRAY[2, 5, 10];
  v_names text[] := ARRAY['Follow-up · 2 days', 'Follow-up · 5 days', 'Follow-up · 10 days'];
  v_colors text[] := ARRAY['#8B5CF6', '#A855F7', '#D946EF'];
  i int;
BEGIN
  FOR v_conn IN
    SELECT DISTINCT pc.id AS connection_id, pc.organization_id
    FROM public.provider_connections pc
    WHERE pc.is_connected = true
      AND NOT EXISTS (
        SELECT 1 FROM public.categories c
        WHERE c.connection_id = pc.id AND c.is_follow_up = true
      )
  LOOP
    FOR i IN 1..3 LOOP
      INSERT INTO public.categories (organization_id, connection_id, name, color, sort_order, is_enabled, is_follow_up, ai_draft_enabled, auto_reply_enabled)
      VALUES (v_conn.organization_id, v_conn.connection_id, v_names[i], v_colors[i], 100 + i, true, true, true, false)
      RETURNING id INTO v_cat_id;

      INSERT INTO public.follow_up_steps (category_id, organization_id, step_order, days_after_send, action, message_template, is_enabled)
      VALUES (
        v_cat_id, v_conn.organization_id, 1, v_defaults[i], 'draft',
        'Polite follow-up since I haven''t heard back. Reference the original message and ask if they had a chance to review.',
        true
      );
    END LOOP;
  END LOOP;
END$$;

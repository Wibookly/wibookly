-- Phase 1: The Helm schema (tenant-scoped, RLS, grants, triggers)

DO $$ BEGIN CREATE TYPE public.helm_source AS ENUM ('email','calendar','commitment','task'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.helm_tier AS ENUM ('decision','draft','overdue','big3','auto'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.helm_status AS ENUM ('open','resolved','sent','snoozed','auto_done'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.helm_focus_window AS ENUM ('morning','afternoon'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.helm_autonomy AS ENUM ('ask_all','auto_internal_ask_external','auto_all'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.helm_action_type AS ENUM ('email_sent','draft_saved','event_moved','event_created','item_filed','note_sent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.helm_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.helm_set_org_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.get_current_org_id();
  END IF;
  RETURN NEW;
END $$;

-- 1) helm_items
CREATE TABLE IF NOT EXISTS public.helm_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source public.helm_source NOT NULL,
  graph_id text,
  conversation_id text,
  tier public.helm_tier NOT NULL DEFAULT 'auto',
  score numeric NOT NULL DEFAULT 0,
  title text NOT NULL,
  context text,
  sender_name text,
  sender_email text,
  due_at timestamptz,
  is_external boolean NOT NULL DEFAULT false,
  status public.helm_status NOT NULL DEFAULT 'open',
  ai_draft text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS helm_items_user_action_key_uidx ON public.helm_items(user_id, action_key) WHERE action_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS helm_items_user_source_graph_uidx ON public.helm_items(user_id, source, graph_id) WHERE graph_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS helm_items_user_status_tier_idx ON public.helm_items(user_id, status, tier);
CREATE INDEX IF NOT EXISTS helm_items_org_idx ON public.helm_items(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.helm_items TO authenticated;
GRANT ALL ON public.helm_items TO service_role;
ALTER TABLE public.helm_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "helm_items org+user select" ON public.helm_items FOR SELECT TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_items org+user insert" ON public.helm_items FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_items org+user update" ON public.helm_items FOR UPDATE TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid()) WITH CHECK (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_items org+user delete" ON public.helm_items FOR DELETE TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_items super_admin all" ON public.helm_items FOR ALL TO authenticated USING (public.is_platform_super_admin()) WITH CHECK (public.is_platform_super_admin());

CREATE TRIGGER helm_items_set_org BEFORE INSERT ON public.helm_items FOR EACH ROW EXECUTE FUNCTION public.helm_set_org_id();
CREATE TRIGGER helm_items_set_updated BEFORE UPDATE ON public.helm_items FOR EACH ROW EXECUTE FUNCTION public.helm_set_updated_at();

-- 2) helm_big3
CREATE TABLE IF NOT EXISTS public.helm_big3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  title text NOT NULL,
  meta text,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ordinal)
);
CREATE INDEX IF NOT EXISTS helm_big3_org_idx ON public.helm_big3(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.helm_big3 TO authenticated;
GRANT ALL ON public.helm_big3 TO service_role;
ALTER TABLE public.helm_big3 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "helm_big3 org+user select" ON public.helm_big3 FOR SELECT TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_big3 org+user insert" ON public.helm_big3 FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_big3 org+user update" ON public.helm_big3 FOR UPDATE TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid()) WITH CHECK (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_big3 org+user delete" ON public.helm_big3 FOR DELETE TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_big3 super_admin all" ON public.helm_big3 FOR ALL TO authenticated USING (public.is_platform_super_admin()) WITH CHECK (public.is_platform_super_admin());

CREATE TRIGGER helm_big3_set_org BEFORE INSERT ON public.helm_big3 FOR EACH ROW EXECUTE FUNCTION public.helm_set_org_id();
CREATE TRIGGER helm_big3_set_updated BEFORE UPDATE ON public.helm_big3 FOR EACH ROW EXECUTE FUNCTION public.helm_set_updated_at();

-- 3) helm_focus_rules  (note: "window" is reserved -> use focus_window)
CREATE TABLE IF NOT EXISTS public.helm_focus_rules (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  focus_days text[] NOT NULL DEFAULT ARRAY[]::text[],
  block_minutes int NOT NULL DEFAULT 90 CHECK (block_minutes IN (60,90,120)),
  focus_window public.helm_focus_window NOT NULL DEFAULT 'morning',
  autonomy public.helm_autonomy NOT NULL DEFAULT 'auto_internal_ask_external',
  auto_reply_categories text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS helm_focus_rules_org_idx ON public.helm_focus_rules(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.helm_focus_rules TO authenticated;
GRANT ALL ON public.helm_focus_rules TO service_role;
ALTER TABLE public.helm_focus_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "helm_focus_rules own select" ON public.helm_focus_rules FOR SELECT TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_focus_rules own insert" ON public.helm_focus_rules FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_focus_rules own update" ON public.helm_focus_rules FOR UPDATE TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid()) WITH CHECK (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_focus_rules own delete" ON public.helm_focus_rules FOR DELETE TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_focus_rules super_admin all" ON public.helm_focus_rules FOR ALL TO authenticated USING (public.is_platform_super_admin()) WITH CHECK (public.is_platform_super_admin());

CREATE TRIGGER helm_focus_rules_set_org BEFORE INSERT ON public.helm_focus_rules FOR EACH ROW EXECUTE FUNCTION public.helm_set_org_id();
CREATE TRIGGER helm_focus_rules_set_updated BEFORE UPDATE ON public.helm_focus_rules FOR EACH ROW EXECUTE FUNCTION public.helm_set_updated_at();

-- 4) activity_log
CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action_type public.helm_action_type NOT NULL,
  detail text,
  graph_id text,
  tier text,
  action_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS activity_log_user_action_key_uidx ON public.activity_log(user_id, action_key) WHERE action_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_log_user_created_idx ON public.activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_org_idx ON public.activity_log(organization_id);

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log own select" ON public.activity_log FOR SELECT TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "activity_log own insert" ON public.activity_log FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "activity_log super_admin select" ON public.activity_log FOR SELECT TO authenticated USING (public.is_platform_super_admin());

CREATE TRIGGER activity_log_set_org BEFORE INSERT ON public.activity_log FOR EACH ROW EXECUTE FUNCTION public.helm_set_org_id();

-- 5) helm_subscriptions
CREATE TABLE IF NOT EXISTS public.helm_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource text NOT NULL,
  graph_subscription_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, resource)
);
CREATE INDEX IF NOT EXISTS helm_subscriptions_expires_idx ON public.helm_subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS helm_subscriptions_org_idx ON public.helm_subscriptions(organization_id);

GRANT SELECT ON public.helm_subscriptions TO authenticated;
GRANT ALL ON public.helm_subscriptions TO service_role;
ALTER TABLE public.helm_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "helm_subscriptions own select" ON public.helm_subscriptions FOR SELECT TO authenticated USING (organization_id = public.get_current_org_id() AND user_id = auth.uid());
CREATE POLICY "helm_subscriptions super_admin all" ON public.helm_subscriptions FOR ALL TO authenticated USING (public.is_platform_super_admin()) WITH CHECK (public.is_platform_super_admin());

CREATE TRIGGER helm_subscriptions_set_org BEFORE INSERT ON public.helm_subscriptions FOR EACH ROW EXECUTE FUNCTION public.helm_set_org_id();
CREATE TRIGGER helm_subscriptions_set_updated BEFORE UPDATE ON public.helm_subscriptions FOR EACH ROW EXECUTE FUNCTION public.helm_set_updated_at();
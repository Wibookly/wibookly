
CREATE TABLE public.home_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  widget_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  item_limit int NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, widget_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.home_preferences TO authenticated;
GRANT ALL ON public.home_preferences TO service_role;
ALTER TABLE public.home_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own home prefs" ON public.home_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id AND org_id = get_user_organization_id(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND org_id = get_user_organization_id(auth.uid()));

CREATE TABLE public.daily_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  digest_date date NOT NULL,
  urgency_level text NOT NULL DEFAULT 'calm',
  headline text NOT NULL,
  subline text,
  narrative text NOT NULL DEFAULT '',
  top_priority jsonb,
  meetings jsonb,
  commitments jsonb,
  client_signals jsonb,
  counts jsonb,
  full_brief_md text,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, digest_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_digests TO authenticated;
GRANT ALL ON public.daily_digests TO service_role;
ALTER TABLE public.daily_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own daily digests select" ON public.daily_digests FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND org_id = get_user_organization_id(auth.uid()));
CREATE POLICY "own daily digests update" ON public.daily_digests FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

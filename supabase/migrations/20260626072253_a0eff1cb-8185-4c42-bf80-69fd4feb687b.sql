
-- Helm VIP senders (configurable per user; seeds itself from frequent/important senders)
CREATE TABLE IF NOT EXISTS public.helm_vips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  email text NOT NULL,
  name text,
  source text NOT NULL DEFAULT 'manual', -- 'manual' | 'seeded'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.helm_vips TO authenticated;
GRANT ALL ON public.helm_vips TO service_role;

ALTER TABLE public.helm_vips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "helm_vips owner read"
  ON public.helm_vips FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_current_user_super_admin());

CREATE POLICY "helm_vips owner write"
  ON public.helm_vips FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_current_org_id());

CREATE POLICY "helm_vips owner update"
  ON public.helm_vips FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "helm_vips owner delete"
  ON public.helm_vips FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "helm_vips service all"
  ON public.helm_vips FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Track Graph delta link per user/connection for incremental sync
CREATE TABLE IF NOT EXISTS public.helm_mail_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  delta_link text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id)
);

GRANT SELECT ON public.helm_mail_sync_state TO authenticated;
GRANT ALL ON public.helm_mail_sync_state TO service_role;

ALTER TABLE public.helm_mail_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "helm_mail_sync_state owner read"
  ON public.helm_mail_sync_state FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_current_user_super_admin());

CREATE POLICY "helm_mail_sync_state service all"
  ON public.helm_mail_sync_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

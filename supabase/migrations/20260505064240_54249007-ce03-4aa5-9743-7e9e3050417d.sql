
-- Backups
CREATE TABLE IF NOT EXISTS backup_permission_groups_v2 AS TABLE permission_groups;
CREATE TABLE IF NOT EXISTS backup_group_features_v2 AS TABLE group_features;

-- permission_groups alters
ALTER TABLE permission_groups
  ADD COLUMN IF NOT EXISTS price_per_user_mo NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_categories INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope_domain TEXT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='permission_groups_max_categories_chk') THEN
    ALTER TABLE permission_groups ADD CONSTRAINT permission_groups_max_categories_chk CHECK (max_categories BETWEEN 0 AND 10);
  END IF;
END $$;

-- group_features alters
ALTER TABLE group_features
  ADD COLUMN IF NOT EXISTS limit_term TEXT NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS rollover TEXT NOT NULL DEFAULT 'none';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='group_features_limit_term_chk') THEN
    ALTER TABLE group_features ADD CONSTRAINT group_features_limit_term_chk CHECK (limit_term IN ('daily','weekly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='group_features_rollover_chk') THEN
    ALTER TABLE group_features ADD CONSTRAINT group_features_rollover_chk CHECK (rollover IN ('none','next_day'));
  END IF;
END $$;

-- feature_model_pricing
CREATE TABLE IF NOT EXISTS feature_model_pricing (
  feature_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dollar_per_task NUMERIC NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL,
  PRIMARY KEY (feature_id, model_id)
);
ALTER TABLE feature_model_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read pricing" ON feature_model_pricing;
CREATE POLICY "authenticated read pricing" ON feature_model_pricing
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service role manages pricing" ON feature_model_pricing;
CREATE POLICY "service role manages pricing" ON feature_model_pricing
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- permission_group_domain_assignments
CREATE TABLE IF NOT EXISTS permission_group_domain_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES allowed_domains(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,
  UNIQUE (group_id, domain_id)
);
ALTER TABLE permission_group_domain_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage domain assignments" ON permission_group_domain_assignments;
CREATE POLICY "admins manage domain assignments" ON permission_group_domain_assignments
  FOR ALL USING (EXISTS (
    SELECT 1 FROM permission_groups g
    WHERE g.id = permission_group_domain_assignments.group_id
      AND g.organization_id = get_user_organization_id(auth.uid())
      AND has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM permission_groups g
    WHERE g.id = permission_group_domain_assignments.group_id
      AND g.organization_id = get_user_organization_id(auth.uid())
      AND has_role_in_org(auth.uid(), 'admin'::app_role, g.organization_id)
  ));

DROP POLICY IF EXISTS "members view domain assignments" ON permission_group_domain_assignments;
CREATE POLICY "members view domain assignments" ON permission_group_domain_assignments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM permission_groups g
    WHERE g.id = permission_group_domain_assignments.group_id
      AND g.organization_id = get_user_organization_id(auth.uid())
  ));

DROP POLICY IF EXISTS "service role manages domain assignments" ON permission_group_domain_assignments;
CREATE POLICY "service role manages domain assignments" ON permission_group_domain_assignments
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Seed feature_model_pricing
INSERT INTO feature_model_pricing (feature_id, model_id, dollar_per_task) VALUES
  ('ai_draft','gpt-4.1-mini',0.0020),('ai_draft','gpt-4.1',0.0130),('ai_draft','phi-4',0.0007),
  ('ai_auto_reply','gpt-4.1',0.0120),('ai_auto_reply','gpt-4.1-mini',0.0018),('ai_auto_reply','claude-sonnet-4.5',0.0220),
  ('ai_chat','gpt-4.1',0.0150),('ai_chat','gpt-4.1-mini',0.0023),('ai_chat','claude-sonnet-4.5',0.0280),
  ('daily_brief','gpt-4.1-mini',0.0080),('daily_brief','gpt-4.1',0.0520),('daily_brief','phi-4',0.0028),
  ('activity_reports','gpt-4.1',0.0500),('activity_reports','gpt-4.1-mini',0.0075),('activity_reports','claude-sonnet-4.5',0.0920),
  ('email_agent','gpt-4.1',0.0400),('email_agent','gpt-4.1-mini',0.0060),('email_agent','claude-sonnet-4.5',0.0740),
  ('teams_agent','gpt-4.1',0.0400),('teams_agent','gpt-4.1-mini',0.0060),('teams_agent','claude-sonnet-4.5',0.0740),
  ('follow_up_reminder','gpt-4.1-mini',0.0050),('follow_up_reminder','gpt-4.1',0.0330),('follow_up_reminder','phi-4',0.0017),
  ('documents','claude-sonnet-4.5',0.1800),('documents','gpt-4.1',0.0980),('documents','llama-3.3-70b',0.0180),
  ('powerpoints','claude-sonnet-4.5',0.1200),('powerpoints','gpt-4.1',0.0650),('powerpoints','llama-3.3-70b',0.0120),
  ('excel','gpt-4.1',0.0400),('excel','gpt-4.1-mini',0.0060),('excel','claude-sonnet-4.5',0.0740),
  ('file_review','gpt-4.1',0.0300),('file_review','gpt-4.1-mini',0.0045),('file_review','claude-sonnet-4.5',0.0550)
ON CONFLICT (feature_id, model_id) DO UPDATE SET dollar_per_task = EXCLUDED.dollar_per_task, last_updated = now();

-- Update existing plans
UPDATE permission_groups SET price_per_user_mo = 49,  max_categories = 3  WHERE name = 'Standard';
UPDATE permission_groups SET price_per_user_mo = 129, max_categories = 5  WHERE name = 'Power User';
UPDATE permission_groups SET price_per_user_mo = 299, max_categories = 10 WHERE name = 'Executive';

-- Seed Chat plan + 12 feature rows for each org that has a Standard plan but no Chat plan
DO $$
DECLARE
  org RECORD;
  new_group_id UUID;
  std_domain_id UUID;
BEGIN
  FOR org IN
    SELECT DISTINCT pg_std.organization_id, pg_std.domain_id
    FROM permission_groups pg_std
    WHERE pg_std.name = 'Standard'
      AND NOT EXISTS (
        SELECT 1 FROM permission_groups pg_chat
        WHERE pg_chat.organization_id = pg_std.organization_id AND pg_chat.name = 'Chat'
      )
  LOOP
    INSERT INTO permission_groups (name, description, organization_id, domain_id, price_per_user_mo, max_categories, scope_domain)
    VALUES ('Chat', 'AI Chat only — Teams or web', org.organization_id, org.domain_id, 19, 0, NULL)
    RETURNING id INTO new_group_id;

    INSERT INTO group_features (group_id, feature_key, is_enabled, daily_limit, limit_term, rollover, model_assignment) VALUES
      (new_group_id, 'ai_chat',            TRUE,  50, 'weekly', 'next_day', 'gpt-4.1-mini'),
      (new_group_id, 'ai_draft',           FALSE, 0,  'daily',  'none',     'gpt-4.1-mini'),
      (new_group_id, 'ai_auto_reply',      FALSE, 0,  'daily',  'none',     'gpt-4.1'),
      (new_group_id, 'daily_brief',        FALSE, 0,  'daily',  'none',     'gpt-4.1-mini'),
      (new_group_id, 'activity_reports',   FALSE, 0,  'daily',  'none',     'gpt-4.1'),
      (new_group_id, 'email_agent',        FALSE, 0,  'daily',  'none',     'gpt-4.1'),
      (new_group_id, 'teams_agent',        FALSE, 0,  'daily',  'none',     'gpt-4.1'),
      (new_group_id, 'follow_up_reminder', FALSE, 0,  'daily',  'none',     'gpt-4.1-mini'),
      (new_group_id, 'documents',          FALSE, 0,  'daily',  'none',     'claude-sonnet-4.5'),
      (new_group_id, 'powerpoints',        FALSE, 0,  'daily',  'none',     'claude-sonnet-4.5'),
      (new_group_id, 'excel',              FALSE, 0,  'daily',  'none',     'gpt-4.1'),
      (new_group_id, 'file_review',        FALSE, 0,  'daily',  'none',     'gpt-4.1');
  END LOOP;
END $$;

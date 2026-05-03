-- BACKUPS
CREATE TABLE IF NOT EXISTS backup_permission_groups_v1 AS SELECT * FROM permission_groups;
CREATE TABLE IF NOT EXISTS backup_group_features_v1 AS SELECT * FROM group_features;
CREATE TABLE IF NOT EXISTS backup_group_feature_overrides_v1 AS SELECT * FROM group_feature_overrides;
CREATE TABLE IF NOT EXISTS backup_org_agent_budget_v1 AS SELECT * FROM org_agent_budget;

ALTER TABLE permission_groups
  ADD COLUMN IF NOT EXISTS monthly_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS is_default_for_new_users BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_group_per_org
  ON permission_groups(organization_id) WHERE is_default_for_new_users = TRUE;

ALTER TABLE group_features
  ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_assignment TEXT;

-- Drop BOTH legacy check constraints first
ALTER TABLE group_features DROP CONSTRAINT IF EXISTS group_features_feature_key_check;
ALTER TABLE group_feature_overrides DROP CONSTRAINT IF EXISTS group_feature_overrides_feature_key_check;

-- Now rename and clean up data
UPDATE group_features SET feature_key='ai_chat' WHERE feature_key='ai_assistant';
UPDATE group_features SET feature_key='activity_reports' WHERE feature_key='reports';
DELETE FROM group_features WHERE feature_key IN ('ai_model_chatgpt','ai_model_claude');

UPDATE group_feature_overrides SET feature_key='ai_chat' WHERE feature_key='ai_assistant';
UPDATE group_feature_overrides SET feature_key='activity_reports' WHERE feature_key='reports';
DELETE FROM group_feature_overrides WHERE feature_key IN ('ai_model_chatgpt','ai_model_claude');

-- Re-apply canonical CHECK constraint to BOTH tables
ALTER TABLE group_features ADD CONSTRAINT group_features_feature_key_check
  CHECK (feature_key = ANY (ARRAY[
    'ai_draft','ai_auto_reply','ai_chat','daily_brief','activity_reports',
    'email_agent','teams_agent','feature.follow_up_reminder',
    'documents','powerpoints','excel','file_reading'
  ]));
ALTER TABLE group_feature_overrides ADD CONSTRAINT group_feature_overrides_feature_key_check
  CHECK (feature_key = ANY (ARRAY[
    'ai_draft','ai_auto_reply','ai_chat','daily_brief','activity_reports',
    'email_agent','teams_agent','feature.follow_up_reminder',
    'documents','powerpoints','excel','file_reading'
  ]));

CREATE TABLE IF NOT EXISTS group_cost_caps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL UNIQUE REFERENCES permission_groups(id) ON DELETE CASCADE,
  per_request_usd NUMERIC(10,4),
  per_user_daily_usd NUMERIC(10,2),
  per_user_monthly_usd NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE group_cost_caps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages group cost caps" ON group_cost_caps;
CREATE POLICY "service role manages group cost caps" ON group_cost_caps
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "admins manage cost caps in org" ON group_cost_caps;
CREATE POLICY "admins manage cost caps in org" ON group_cost_caps
  USING (EXISTS (SELECT 1 FROM permission_groups g WHERE g.id = group_cost_caps.group_id
    AND g.organization_id = get_user_organization_id(auth.uid())
    AND has_role_in_org(auth.uid(),'admin'::app_role,g.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM permission_groups g WHERE g.id = group_cost_caps.group_id
    AND g.organization_id = get_user_organization_id(auth.uid())
    AND has_role_in_org(auth.uid(),'admin'::app_role,g.organization_id)));
DROP POLICY IF EXISTS "members view cost caps in org" ON group_cost_caps;
CREATE POLICY "members view cost caps in org" ON group_cost_caps FOR SELECT
  USING (EXISTS (SELECT 1 FROM permission_groups g WHERE g.id = group_cost_caps.group_id
    AND g.organization_id = get_user_organization_id(auth.uid())));

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_id UUID,
  organization_id UUID,
  group_id UUID,
  target_user_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages audit log" ON admin_audit_log;
CREATE POLICY "service role manages audit log" ON admin_audit_log
  USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
DROP POLICY IF EXISTS "admins view audit log in org" ON admin_audit_log;
CREATE POLICY "admins view audit log in org" ON admin_audit_log FOR SELECT
  USING (organization_id = get_user_organization_id(auth.uid())
    AND has_role_in_org(auth.uid(),'admin'::app_role,organization_id));

ALTER TABLE org_agent_budget
  ADD COLUMN IF NOT EXISTS monthly_usd_cap NUMERIC(10,2) NOT NULL DEFAULT 6600.00,
  ADD COLUMN IF NOT EXISTS spent_month_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_month DATE NOT NULL DEFAULT date_trunc('month',(now() AT TIME ZONE 'UTC'))::date;

CREATE TABLE IF NOT EXISTS user_daily_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  group_id UUID REFERENCES permission_groups(id) ON DELETE SET NULL,
  day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  month DATE NOT NULL DEFAULT date_trunc('month',(now() AT TIME ZONE 'UTC'))::date,
  spent_today_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  spent_month_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  request_count_today INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, day)
);
ALTER TABLE user_daily_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages user spend" ON user_daily_spend;
CREATE POLICY "service role manages user spend" ON user_daily_spend
  USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
DROP POLICY IF EXISTS "users view own spend" ON user_daily_spend;
CREATE POLICY "users view own spend" ON user_daily_spend FOR SELECT USING (user_id=auth.uid());
DROP POLICY IF EXISTS "admins view org spend" ON user_daily_spend;
CREATE POLICY "admins view org spend" ON user_daily_spend FOR SELECT
  USING (organization_id = get_user_organization_id(auth.uid())
    AND has_role_in_org(auth.uid(),'admin'::app_role,organization_id));

INSERT INTO permission_groups (organization_id, name, description, monthly_price, is_default_for_new_users, display_order)
SELECT DISTINCT organization_id, 'Chat',
  'AI chat in Microsoft Teams — equivalent to ChatGPT inside your Microsoft tenant',
  19.00, TRUE, 1
FROM permission_groups
ON CONFLICT (organization_id, name) DO NOTHING;

UPDATE permission_groups SET description='Email assistant with manual review',
  monthly_price=49.00, is_default_for_new_users=FALSE, display_order=2 WHERE name='Standard';
UPDATE permission_groups SET description='Full automation for managers and operators',
  monthly_price=129.00, is_default_for_new_users=FALSE, display_order=3 WHERE name='Power User';
UPDATE permission_groups SET description='Premium tier for C-suite and senior leaders',
  monthly_price=299.00, is_default_for_new_users=FALSE, display_order=4 WHERE name='Executive';

DELETE FROM group_features WHERE group_id IN (SELECT id FROM permission_groups);

WITH g AS (SELECT id, name FROM permission_groups)
INSERT INTO group_features (group_id, feature_key, is_enabled, daily_limit, model_assignment)
SELECT id,'ai_chat',TRUE,200,'gpt-4.1-mini' FROM g WHERE name='Chat'
UNION ALL SELECT id,'ai_draft',FALSE,0,'phi-4' FROM g WHERE name='Chat'
UNION ALL SELECT id,'ai_auto_reply',FALSE,0,'gpt-4.1-mini' FROM g WHERE name='Chat'
UNION ALL SELECT id,'daily_brief',FALSE,0,'phi-4' FROM g WHERE name='Chat'
UNION ALL SELECT id,'activity_reports',FALSE,0,'gpt-4.1-mini' FROM g WHERE name='Chat'
UNION ALL SELECT id,'email_agent',FALSE,0,'gpt-4.1' FROM g WHERE name='Chat'
UNION ALL SELECT id,'teams_agent',FALSE,0,'gpt-4.1' FROM g WHERE name='Chat'
UNION ALL SELECT id,'feature.follow_up_reminder',FALSE,0,'phi-4' FROM g WHERE name='Chat'
UNION ALL SELECT id,'documents',FALSE,0,'llama-3.3-70b' FROM g WHERE name='Chat'
UNION ALL SELECT id,'powerpoints',FALSE,0,'llama-3.3-70b' FROM g WHERE name='Chat'
UNION ALL SELECT id,'excel',FALSE,0,'gpt-4.1-mini' FROM g WHERE name='Chat'
UNION ALL SELECT id,'file_reading',FALSE,0,'gpt-4.1-mini' FROM g WHERE name='Chat'
UNION ALL SELECT id,'ai_draft',TRUE,30,'phi-4' FROM g WHERE name='Standard'
UNION ALL SELECT id,'ai_auto_reply',FALSE,0,'gpt-4.1-mini' FROM g WHERE name='Standard'
UNION ALL SELECT id,'ai_chat',TRUE,10,'gpt-4.1-mini' FROM g WHERE name='Standard'
UNION ALL SELECT id,'daily_brief',FALSE,0,'phi-4' FROM g WHERE name='Standard'
UNION ALL SELECT id,'activity_reports',FALSE,0,'gpt-4.1-mini' FROM g WHERE name='Standard'
UNION ALL SELECT id,'email_agent',TRUE,5,'gpt-4.1' FROM g WHERE name='Standard'
UNION ALL SELECT id,'teams_agent',TRUE,5,'gpt-4.1' FROM g WHERE name='Standard'
UNION ALL SELECT id,'feature.follow_up_reminder',FALSE,0,'phi-4' FROM g WHERE name='Standard'
UNION ALL SELECT id,'documents',TRUE,2,'llama-3.3-70b' FROM g WHERE name='Standard'
UNION ALL SELECT id,'powerpoints',FALSE,0,'llama-3.3-70b' FROM g WHERE name='Standard'
UNION ALL SELECT id,'excel',TRUE,1,'gpt-4.1-mini' FROM g WHERE name='Standard'
UNION ALL SELECT id,'file_reading',TRUE,5,'gpt-4.1-mini' FROM g WHERE name='Standard'
UNION ALL SELECT id,'ai_draft',TRUE,80,'phi-4' FROM g WHERE name='Power User'
UNION ALL SELECT id,'ai_auto_reply',TRUE,30,'gpt-4.1-mini' FROM g WHERE name='Power User'
UNION ALL SELECT id,'ai_chat',TRUE,40,'gpt-4.1-mini' FROM g WHERE name='Power User'
UNION ALL SELECT id,'daily_brief',TRUE,1,'phi-4' FROM g WHERE name='Power User'
UNION ALL SELECT id,'activity_reports',TRUE,1,'gpt-4.1-mini' FROM g WHERE name='Power User'
UNION ALL SELECT id,'email_agent',TRUE,25,'gpt-4.1' FROM g WHERE name='Power User'
UNION ALL SELECT id,'teams_agent',TRUE,25,'gpt-4.1' FROM g WHERE name='Power User'
UNION ALL SELECT id,'feature.follow_up_reminder',TRUE,1,'phi-4' FROM g WHERE name='Power User'
UNION ALL SELECT id,'documents',TRUE,8,'llama-3.3-70b' FROM g WHERE name='Power User'
UNION ALL SELECT id,'powerpoints',TRUE,2,'llama-3.3-70b' FROM g WHERE name='Power User'
UNION ALL SELECT id,'excel',TRUE,3,'gpt-4.1-mini' FROM g WHERE name='Power User'
UNION ALL SELECT id,'file_reading',TRUE,15,'gpt-4.1-mini' FROM g WHERE name='Power User'
UNION ALL SELECT id,'ai_draft',TRUE,200,'phi-4' FROM g WHERE name='Executive'
UNION ALL SELECT id,'ai_auto_reply',TRUE,100,'gpt-4.1-mini' FROM g WHERE name='Executive'
UNION ALL SELECT id,'ai_chat',TRUE,100,'gpt-4.1-mini' FROM g WHERE name='Executive'
UNION ALL SELECT id,'daily_brief',TRUE,1,'phi-4' FROM g WHERE name='Executive'
UNION ALL SELECT id,'activity_reports',TRUE,1,'gpt-4.1-mini' FROM g WHERE name='Executive'
UNION ALL SELECT id,'email_agent',TRUE,60,'gpt-4.1' FROM g WHERE name='Executive'
UNION ALL SELECT id,'teams_agent',TRUE,60,'gpt-4.1' FROM g WHERE name='Executive'
UNION ALL SELECT id,'feature.follow_up_reminder',TRUE,2,'phi-4' FROM g WHERE name='Executive'
UNION ALL SELECT id,'documents',TRUE,20,'llama-3.3-70b' FROM g WHERE name='Executive'
UNION ALL SELECT id,'powerpoints',TRUE,5,'llama-3.3-70b' FROM g WHERE name='Executive'
UNION ALL SELECT id,'excel',TRUE,10,'gpt-4.1-mini' FROM g WHERE name='Executive'
UNION ALL SELECT id,'file_reading',TRUE,40,'gpt-4.1-mini' FROM g WHERE name='Executive';

INSERT INTO group_cost_caps (group_id, per_request_usd, per_user_daily_usd, per_user_monthly_usd)
SELECT id, 0.05, 0.50, 8.00 FROM permission_groups WHERE name='Chat'
UNION ALL SELECT id, 0.10, 5.00, 50.00 FROM permission_groups WHERE name='Standard'
UNION ALL SELECT id, 0.50, 15.00, 150.00 FROM permission_groups WHERE name='Power User'
UNION ALL SELECT id, 2.00, 40.00, 400.00 FROM permission_groups WHERE name='Executive'
ON CONFLICT (group_id) DO UPDATE SET
  per_request_usd=EXCLUDED.per_request_usd,
  per_user_daily_usd=EXCLUDED.per_user_daily_usd,
  per_user_monthly_usd=EXCLUDED.per_user_monthly_usd,
  updated_at=NOW();

INSERT INTO org_agent_budget (organization_id, daily_usd_cap, monthly_usd_cap, max_concurrent_runs)
SELECT DISTINCT organization_id, 300.00, 6600.00, 10
FROM permission_groups
ON CONFLICT (organization_id) DO UPDATE SET
  daily_usd_cap=300.00, monthly_usd_cap=6600.00, max_concurrent_runs=10;

CREATE OR REPLACE FUNCTION public.check_user_budget(
  _user_id UUID, _organization_id UUID, _est_cost_usd NUMERIC DEFAULT 0
) RETURNS TABLE(allowed BOOLEAN, reason TEXT, group_id UUID, daily_remaining NUMERIC, monthly_remaining NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _group_id UUID; _per_req NUMERIC; _per_day NUMERIC; _per_mo NUMERIC;
  _today DATE := (now() AT TIME ZONE 'UTC')::date;
  _spent_d NUMERIC := 0; _spent_m NUMERIC := 0;
BEGIN
  SELECT ugm.group_id INTO _group_id
  FROM user_group_memberships ugm
  JOIN permission_groups pg ON pg.id = ugm.group_id
  WHERE ugm.user_id = _user_id AND pg.organization_id = _organization_id
  ORDER BY pg.display_order DESC LIMIT 1;
  IF _group_id IS NULL THEN
    SELECT id INTO _group_id FROM permission_groups
    WHERE organization_id = _organization_id AND is_default_for_new_users = TRUE LIMIT 1;
  END IF;
  SELECT per_request_usd, per_user_daily_usd, per_user_monthly_usd
    INTO _per_req, _per_day, _per_mo FROM group_cost_caps WHERE group_cost_caps.group_id = _group_id;
  SELECT COALESCE(spent_today_usd,0), COALESCE(spent_month_usd,0) INTO _spent_d, _spent_m
  FROM user_daily_spend WHERE user_id = _user_id AND day = _today;
  IF _per_req IS NOT NULL AND _est_cost_usd > _per_req THEN
    RETURN QUERY SELECT FALSE,'per_request_cap_exceeded',_group_id,
      GREATEST(_per_day-_spent_d,0),GREATEST(_per_mo-_spent_m,0); RETURN;
  END IF;
  IF _per_day IS NOT NULL AND _spent_d + _est_cost_usd > _per_day THEN
    RETURN QUERY SELECT FALSE,'daily_cap_exceeded',_group_id,
      GREATEST(_per_day-_spent_d,0),GREATEST(_per_mo-_spent_m,0); RETURN;
  END IF;
  IF _per_mo IS NOT NULL AND _spent_m + _est_cost_usd > _per_mo THEN
    RETURN QUERY SELECT FALSE,'monthly_cap_exceeded',_group_id,
      GREATEST(_per_day-_spent_d,0),GREATEST(_per_mo-_spent_m,0); RETURN;
  END IF;
  RETURN QUERY SELECT TRUE,NULL::TEXT,_group_id,
    GREATEST(COALESCE(_per_day,999999)-_spent_d,0),
    GREATEST(COALESCE(_per_mo,999999)-_spent_m,0);
END $$;

CREATE OR REPLACE FUNCTION public.record_user_spend(
  _user_id UUID, _organization_id UUID, _group_id UUID, _cost_usd NUMERIC
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _today DATE := (now() AT TIME ZONE 'UTC')::date;
  _month DATE := date_trunc('month',(now() AT TIME ZONE 'UTC'))::date;
BEGIN
  INSERT INTO user_daily_spend (user_id, organization_id, group_id, day, month, spent_today_usd, spent_month_usd, request_count_today)
  VALUES (_user_id, _organization_id, _group_id, _today, _month, _cost_usd, _cost_usd, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET
    spent_today_usd = user_daily_spend.spent_today_usd + EXCLUDED.spent_today_usd,
    spent_month_usd = CASE WHEN user_daily_spend.month = _month
      THEN user_daily_spend.spent_month_usd + EXCLUDED.spent_today_usd
      ELSE EXCLUDED.spent_today_usd END,
    month = _month,
    request_count_today = user_daily_spend.request_count_today + 1,
    updated_at = NOW();
END $$;

INSERT INTO admin_audit_log (action, details)
SELECT 'phase_1_consolidated_migration',
  jsonb_build_object('timestamp', NOW(),
    'changes', ARRAY[
      'Schema additions across permission_groups/group_features/org_agent_budget',
      'New tables: group_cost_caps, admin_audit_log, user_daily_spend',
      'Renamed ai_assistant->ai_chat, reports->activity_reports',
      'Removed ai_model_chatgpt/ai_model_claude (replaced by model_assignment)',
      'Added Chat tier as default for new users',
      'Rebuilt group_features (4 groups x 12 features)',
      'Per-group cost caps + per-user spend RPCs',
      'Org budget raised to $300/day, $6600/month, 10 concurrent'
    ]);
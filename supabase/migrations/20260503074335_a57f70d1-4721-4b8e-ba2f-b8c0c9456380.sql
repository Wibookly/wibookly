BEGIN;

ALTER TABLE group_features DROP CONSTRAINT IF EXISTS group_features_feature_key_check;
ALTER TABLE group_feature_overrides DROP CONSTRAINT IF EXISTS group_feature_overrides_feature_key_check;

TRUNCATE permission_groups CASCADE;
INSERT INTO permission_groups SELECT * FROM backup_permission_groups_v1;

TRUNCATE group_features CASCADE;
INSERT INTO group_features SELECT * FROM backup_group_features_v1;

-- Restore overrides too if backup exists and has rows
INSERT INTO group_feature_overrides
SELECT * FROM backup_group_feature_overrides_v1
ON CONFLICT DO NOTHING;

TRUNCATE org_agent_budget;
INSERT INTO org_agent_budget SELECT * FROM backup_org_agent_budget_v1;

DROP TABLE IF EXISTS group_cost_caps;

COMMIT;
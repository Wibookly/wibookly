ALTER TABLE backup_permission_groups_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_group_features_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_group_feature_overrides_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_org_agent_budget_v1 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON backup_permission_groups_v1
  USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "service role only" ON backup_group_features_v1
  USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "service role only" ON backup_group_feature_overrides_v1
  USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "service role only" ON backup_org_agent_budget_v1
  USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
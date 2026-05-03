UPDATE group_cost_caps SET per_user_daily_usd = 0.10
WHERE group_id = (SELECT id FROM permission_groups WHERE name = 'Executive');
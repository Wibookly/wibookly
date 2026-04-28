-- Allow feature.follow_up_reminder in group_features and group_feature_overrides check constraints

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE conname IN ('group_features_feature_key_check', 'group_feature_overrides_feature_key_check')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', con.tbl, con.conname);
  END LOOP;
END $$;

ALTER TABLE public.group_features
  ADD CONSTRAINT group_features_feature_key_check
  CHECK (feature_key IN (
    'ai_draft','ai_auto_reply','ai_assistant','daily_brief','reports',
    'ai_model_chatgpt','ai_model_claude','email_agent','teams_agent',
    'feature.follow_up_reminder'
  ));

ALTER TABLE public.group_feature_overrides
  ADD CONSTRAINT group_feature_overrides_feature_key_check
  CHECK (feature_key IN (
    'ai_draft','ai_auto_reply','ai_assistant','daily_brief','reports',
    'ai_model_chatgpt','ai_model_claude','email_agent','teams_agent',
    'feature.follow_up_reminder'
  ));
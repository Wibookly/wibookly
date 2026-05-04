-- Restrict the "Chat" permission group to only: ai_chat, ai_model_chatgpt, ai_model_claude, teams_agent
DO $$
DECLARE
  chat_group_id uuid;
BEGIN
  SELECT id INTO chat_group_id FROM public.permission_groups WHERE name = 'Chat' LIMIT 1;
  IF chat_group_id IS NULL THEN
    RAISE NOTICE 'Chat group not found';
    RETURN;
  END IF;

  -- Disable everything currently set
  UPDATE public.group_features
  SET is_enabled = false
  WHERE group_id = chat_group_id;

  -- Upsert the four allowed features as enabled
  INSERT INTO public.group_features (group_id, feature_key, is_enabled)
  VALUES
    (chat_group_id, 'ai_chat', true),
    (chat_group_id, 'teams_agent', true),
    (chat_group_id, 'ai_model_chatgpt', true),
    (chat_group_id, 'ai_model_claude', true)
  ON CONFLICT (group_id, feature_key)
  DO UPDATE SET is_enabled = EXCLUDED.is_enabled;
END $$;
ALTER TABLE public.user_feature_access DROP CONSTRAINT IF EXISTS user_feature_access_feature_key_check;
ALTER TABLE public.user_feature_access
ADD CONSTRAINT user_feature_access_feature_key_check
CHECK (
  feature_key IN (
    'ai_draft',
    'ai_auto_reply',
    'ai_assistant',
    'daily_brief',
    'reports',
    'ai_model_chatgpt',
    'ai_model_claude',
    'email_agent',
    'teams_agent'
  )
);

ALTER TABLE public.group_features DROP CONSTRAINT IF EXISTS group_features_feature_key_check;
ALTER TABLE public.group_features
ADD CONSTRAINT group_features_feature_key_check
CHECK (
  feature_key IN (
    'ai_draft',
    'ai_auto_reply',
    'ai_assistant',
    'daily_brief',
    'reports',
    'ai_model_chatgpt',
    'ai_model_claude',
    'email_agent',
    'teams_agent'
  )
);

ALTER TABLE public.group_feature_overrides DROP CONSTRAINT IF EXISTS group_feature_overrides_feature_key_check;
ALTER TABLE public.group_feature_overrides
ADD CONSTRAINT group_feature_overrides_feature_key_check
CHECK (
  feature_key IN (
    'ai_draft',
    'ai_auto_reply',
    'ai_assistant',
    'daily_brief',
    'reports',
    'ai_model_chatgpt',
    'ai_model_claude',
    'email_agent',
    'teams_agent'
  )
);

CREATE OR REPLACE FUNCTION public.has_feature(_user_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH user_domain AS (
    SELECT domain_id
    FROM public.user_profiles
    WHERE user_id = _user_id
    LIMIT 1
  )
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_feature_access
      WHERE user_id = _user_id
        AND feature_key = _feature_key
        AND is_enabled = true
    )
    OR (
      SELECT COALESCE(
        (
          SELECT bool_or(gfo.is_enabled)
          FROM public.user_group_memberships m
          JOIN public.group_feature_overrides gfo
            ON gfo.group_id = m.group_id
           AND gfo.feature_key = _feature_key
          WHERE m.user_id = _user_id
            AND gfo.domain_id = (SELECT domain_id FROM user_domain)
            AND (SELECT domain_id FROM user_domain) IS NOT NULL
        ),
        false
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_group_memberships m
      JOIN public.group_features gf ON gf.group_id = m.group_id
      WHERE m.user_id = _user_id
        AND gf.feature_key = _feature_key
        AND gf.is_enabled = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.group_feature_overrides gfo
          WHERE gfo.group_id = m.group_id
            AND gfo.feature_key = _feature_key
            AND gfo.domain_id = (SELECT domain_id FROM user_domain)
        )
    )
    OR public.is_super_admin(
      (SELECT email FROM public.user_profiles WHERE user_id = _user_id LIMIT 1)
    );
$$;
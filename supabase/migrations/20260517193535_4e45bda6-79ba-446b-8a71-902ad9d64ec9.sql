UPDATE oauth_token_vault v
SET connection_id = pc.id
FROM (
  SELECT DISTINCT ON (user_id, provider) id, user_id, provider
  FROM provider_connections
  ORDER BY user_id, provider, created_at ASC
) pc
WHERE v.connection_id IS NULL
  AND v.user_id = pc.user_id
  AND v.provider = pc.provider;
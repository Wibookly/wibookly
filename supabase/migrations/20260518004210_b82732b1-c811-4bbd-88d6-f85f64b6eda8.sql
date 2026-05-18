UPDATE public.oauth_token_vault v
SET connection_id = pc.id, updated_at = now()
FROM public.provider_connections pc
WHERE v.connection_id IS NULL
  AND v.user_id = pc.user_id
  AND v.provider = pc.provider
  AND pc.is_connected = true;
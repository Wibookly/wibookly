-- Drop duplicate agent_messages rows (keep oldest per (org, external_message_id))
DELETE FROM public.agent_messages a
USING public.agent_messages b
WHERE a.organization_id = b.organization_id
  AND a.external_message_id = b.external_message_id
  AND a.external_message_id IS NOT NULL
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS agent_messages_org_extid_unique
  ON public.agent_messages (organization_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

ALTER TABLE public.discovered_tenant_users
  ADD COLUMN IF NOT EXISTS profile_photo_url text;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS profile_photo_url text;
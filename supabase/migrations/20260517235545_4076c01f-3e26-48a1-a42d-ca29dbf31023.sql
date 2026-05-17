ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS citations jsonb;
ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS agent_conversation_id uuid;
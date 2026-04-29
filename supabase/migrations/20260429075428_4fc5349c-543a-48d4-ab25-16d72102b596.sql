-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================================
-- knowledge_documents
-- =========================================================
CREATE TABLE public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  connection_id uuid,
  title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('upload','email','manual','url')),
  source_ref text,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','indexed','failed')),
  chunk_count integer NOT NULL DEFAULT 0,
  error_message text,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own knowledge documents"
ON public.knowledge_documents
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service role manages knowledge documents"
ON public.knowledge_documents
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_knowledge_documents_user ON public.knowledge_documents(user_id);
CREATE INDEX idx_knowledge_documents_connection ON public.knowledge_documents(connection_id);

CREATE TRIGGER trg_knowledge_documents_updated_at
BEFORE UPDATE ON public.knowledge_documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- knowledge_chunks
-- =========================================================
CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  connection_id uuid,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own knowledge chunks"
ON public.knowledge_chunks
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "service role manages knowledge chunks"
ON public.knowledge_chunks
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_knowledge_chunks_document ON public.knowledge_chunks(document_id);
CREATE INDEX idx_knowledge_chunks_user ON public.knowledge_chunks(user_id);
CREATE INDEX idx_knowledge_chunks_connection ON public.knowledge_chunks(connection_id);
CREATE INDEX idx_knowledge_chunks_embedding
  ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =========================================================
-- email_threads
-- =========================================================
CREATE TABLE public.email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  provider_thread_id text NOT NULL,
  subject text,
  participants text[] NOT NULL DEFAULT '{}',
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_thread_id)
);

ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own email threads"
ON public.email_threads
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "service role manages email threads"
ON public.email_threads
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_email_threads_user ON public.email_threads(user_id);
CREATE INDEX idx_email_threads_connection ON public.email_threads(connection_id);
CREATE INDEX idx_email_threads_last_message ON public.email_threads(last_message_at DESC);

CREATE TRIGGER trg_email_threads_updated_at
BEFORE UPDATE ON public.email_threads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- email_messages
-- =========================================================
CREATE TABLE public.email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.email_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  provider_message_id text NOT NULL,
  from_email text,
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text,
  body_clean text,
  body_raw text,
  embedding vector(1536),
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_message_id)
);

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own email messages"
ON public.email_messages
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "service role manages email messages"
ON public.email_messages
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_email_messages_thread ON public.email_messages(thread_id);
CREATE INDEX idx_email_messages_user ON public.email_messages(user_id);
CREATE INDEX idx_email_messages_connection ON public.email_messages(connection_id);
CREATE INDEX idx_email_messages_sent_at ON public.email_messages(sent_at DESC);
CREATE INDEX idx_email_messages_embedding
  ON public.email_messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =========================================================
-- llm_call_logs
-- =========================================================
CREATE TABLE public.llm_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  organization_id uuid,
  connection_id uuid,
  conversation_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  purpose text,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  latency_ms integer,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own llm logs"
ON public.llm_call_logs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "admins view org llm logs"
ON public.llm_call_logs
FOR SELECT
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);

CREATE POLICY "service role manages llm logs"
ON public.llm_call_logs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_llm_call_logs_user ON public.llm_call_logs(user_id);
CREATE INDEX idx_llm_call_logs_org ON public.llm_call_logs(organization_id);
CREATE INDEX idx_llm_call_logs_created ON public.llm_call_logs(created_at DESC);

-- =========================================================
-- Extend ai_chat_conversations
-- =========================================================
ALTER TABLE public.ai_chat_conversations
  ADD COLUMN IF NOT EXISTS context_email_thread_id uuid REFERENCES public.email_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_mode boolean NOT NULL DEFAULT false;

-- =========================================================
-- Extend ai_chat_messages
-- =========================================================
ALTER TABLE public.ai_chat_messages
  ADD COLUMN IF NOT EXISTS tool_calls jsonb,
  ADD COLUMN IF NOT EXISTS tool_results jsonb,
  ADD COLUMN IF NOT EXISTS citations jsonb,
  ADD COLUMN IF NOT EXISTS model_used text,
  ADD COLUMN IF NOT EXISTS tokens_in integer,
  ADD COLUMN IF NOT EXISTS tokens_out integer;
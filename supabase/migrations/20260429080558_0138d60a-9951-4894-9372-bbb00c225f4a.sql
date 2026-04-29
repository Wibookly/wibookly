-- RPC functions for hybrid retrieval (semantic search via pgvector cosine distance)

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector(1536),
  p_user_id uuid,
  p_connection_id uuid,
  match_count integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    kc.id,
    kc.document_id,
    kc.chunk_index,
    kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.user_id = p_user_id
    AND (kc.connection_id = p_connection_id OR kc.connection_id IS NULL)
    AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count
$$;

CREATE OR REPLACE FUNCTION public.match_email_messages(
  query_embedding vector(1536),
  p_user_id uuid,
  p_connection_id uuid,
  match_count integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  thread_id uuid,
  subject text,
  from_email text,
  body_clean text,
  sent_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    em.id,
    em.thread_id,
    em.subject,
    em.from_email,
    em.body_clean,
    em.sent_at,
    1 - (em.embedding <=> query_embedding) AS similarity
  FROM public.email_messages em
  WHERE em.user_id = p_user_id
    AND em.connection_id = p_connection_id
    AND em.embedding IS NOT NULL
  ORDER BY em.embedding <=> query_embedding
  LIMIT match_count
$$;

-- Lock down execution to authenticated users; data is filtered by user_id inside
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(vector, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_email_messages(vector, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_email_messages(vector, uuid, uuid, integer) TO authenticated, service_role;
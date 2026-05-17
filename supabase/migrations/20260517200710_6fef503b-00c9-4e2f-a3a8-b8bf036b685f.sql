-- GIN index for fast keyword ranking
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_fts
  ON public.knowledge_chunks
  USING GIN (to_tsvector('english', content));

-- Hybrid search: vector cosine + ts_rank, weighted, joined to document for citation metadata
CREATE OR REPLACE FUNCTION public.search_knowledge_hybrid(
  query_embedding vector,
  query_text text,
  p_user_id uuid,
  p_connection_id uuid DEFAULT NULL,
  strict_connection boolean DEFAULT false,
  match_count int DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity float,
  keyword_rank float,
  combined_score float,
  title text,
  source_type text,
  source_ref text,
  extracted_metadata jsonb,
  connection_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('english', COALESCE(NULLIF(query_text,''), 'x')) AS tsq
  )
  SELECT
    kc.id AS chunk_id,
    kc.document_id,
    kc.chunk_index,
    kc.content,
    (1 - (kc.embedding <=> query_embedding))::float AS similarity,
    COALESCE(ts_rank(to_tsvector('english', kc.content), (SELECT tsq FROM q)), 0)::float AS keyword_rank,
    ((1 - (kc.embedding <=> query_embedding)) * 0.7
      + COALESCE(ts_rank(to_tsvector('english', kc.content), (SELECT tsq FROM q)), 0) * 0.3)::float AS combined_score,
    kd.title,
    kd.source_type,
    kd.source_ref,
    kd.extracted_metadata,
    kc.connection_id
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_documents kd ON kd.id = kc.document_id
  WHERE kc.user_id = p_user_id
    AND kc.embedding IS NOT NULL
    AND (
      (strict_connection = true AND kc.connection_id = p_connection_id)
      OR (strict_connection = false AND (p_connection_id IS NULL OR kc.connection_id = p_connection_id OR kc.connection_id IS NULL))
    )
  ORDER BY combined_score DESC
  LIMIT match_count
$$;

REVOKE ALL ON FUNCTION public.search_knowledge_hybrid(vector, text, uuid, uuid, boolean, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_knowledge_hybrid(vector, text, uuid, uuid, boolean, int) TO authenticated, service_role;
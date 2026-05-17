-- Drop old CHECK constraint on source_type and add expanded one
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.knowledge_documents'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%source_type%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.knowledge_documents DROP CONSTRAINT %I', con_name);
  END IF;
END$$;

ALTER TABLE public.knowledge_documents
  ADD CONSTRAINT knowledge_documents_source_type_check
  CHECK (source_type IN ('upload','email','manual','url','mail_attachment','onedrive','sharepoint'));

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS extraction_error text,
  ADD COLUMN IF NOT EXISTS extracted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_extraction_status_check;
ALTER TABLE public.knowledge_documents
  ADD CONSTRAINT knowledge_documents_extraction_status_check
  CHECK (extraction_status IN ('pending','extracting','completed','failed','skipped'));

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_external_uniq
  ON public.knowledge_documents (user_id, connection_id, source_type, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_documents_extraction_status_idx
  ON public.knowledge_documents (extraction_status)
  WHERE extraction_status IN ('pending','extracting','failed');
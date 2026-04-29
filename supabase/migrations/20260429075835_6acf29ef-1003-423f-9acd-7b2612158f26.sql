INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-files', 'knowledge-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own knowledge files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'knowledge-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can read their own knowledge files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'knowledge-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own knowledge files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'knowledge-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
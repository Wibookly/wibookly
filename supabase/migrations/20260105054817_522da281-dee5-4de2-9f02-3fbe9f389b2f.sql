-- Add signature fields to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS mobile text,
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS signature_logo_url text;

-- Create storage bucket for signature logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('signature-logos', 'signature-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Create policy for users to upload their own signature logos
CREATE POLICY "Users can upload signature logos"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'signature-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create policy for users to update their own signature logos
CREATE POLICY "Users can update signature logos"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'signature-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create policy for users to delete their own signature logos
CREATE POLICY "Users can delete signature logos"
ON storage.objects
FOR DELETE
USING (bucket_id = 'signature-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create policy for public access to signature logos
CREATE POLICY "Signature logos are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'signature-logos');
-- Add font and color fields to user_profiles for signature styling
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS signature_font text DEFAULT 'Arial',
ADD COLUMN IF NOT EXISTS signature_color text DEFAULT '#333333';
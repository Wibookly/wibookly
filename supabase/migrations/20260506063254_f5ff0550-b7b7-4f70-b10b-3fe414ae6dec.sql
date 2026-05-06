ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS ai_generated_sample TEXT;
ALTER TABLE public.ai_settings ADD COLUMN IF NOT EXISTS ai_generated_sample TEXT;
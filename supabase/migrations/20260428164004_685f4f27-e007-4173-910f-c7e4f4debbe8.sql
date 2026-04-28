ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS last_synced_name TEXT;
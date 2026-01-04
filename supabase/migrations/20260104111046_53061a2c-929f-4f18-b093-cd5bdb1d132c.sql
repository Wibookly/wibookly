-- Add last_synced_at column to track sync status per category
ALTER TABLE public.categories
ADD COLUMN last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
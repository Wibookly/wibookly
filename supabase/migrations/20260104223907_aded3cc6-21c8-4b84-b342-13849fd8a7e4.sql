-- Add advanced rule fields to rules table
ALTER TABLE public.rules
ADD COLUMN is_advanced boolean NOT NULL DEFAULT false,
ADD COLUMN subject_contains text DEFAULT NULL,
ADD COLUMN body_contains text DEFAULT NULL,
ADD COLUMN last_synced_at timestamp with time zone DEFAULT NULL;
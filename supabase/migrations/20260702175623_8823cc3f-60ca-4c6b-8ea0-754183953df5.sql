ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS show_on_home boolean NOT NULL DEFAULT false;
-- Enforce mutual exclusivity: home-routed categories cannot auto-reply
UPDATE public.categories SET auto_reply_enabled = false WHERE show_on_home = true;
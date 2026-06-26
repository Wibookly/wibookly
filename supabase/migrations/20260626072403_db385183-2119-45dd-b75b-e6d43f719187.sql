
ALTER TABLE public.helm_items
  ADD CONSTRAINT helm_items_action_key_unique UNIQUE (action_key);

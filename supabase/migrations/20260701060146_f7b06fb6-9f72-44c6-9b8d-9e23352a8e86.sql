ALTER TABLE public.helm_focus_rules
  DROP CONSTRAINT IF EXISTS helm_focus_rules_block_minutes_check;

ALTER TABLE public.helm_focus_rules
  ADD CONSTRAINT helm_focus_rules_block_minutes_check
  CHECK (block_minutes = ANY (ARRAY[30, 45, 60, 90, 120]));

UPDATE public.helm_focus_rules
SET block_minutes = 30,
    updated_at = now()
WHERE block_minutes = 60;
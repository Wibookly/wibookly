
ALTER TABLE public.follow_up_settings
  ADD COLUMN IF NOT EXISTS enabled_at timestamptz;

-- Backfill: anyone currently enabled starts fresh from now (don't process old flagged emails)
UPDATE public.follow_up_settings
SET enabled_at = now()
WHERE enabled_at IS NULL;

-- Keep enabled_at in sync: stamp it whenever is_enabled flips false -> true.
CREATE OR REPLACE FUNCTION public.touch_follow_up_enabled_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_enabled IS TRUE AND NEW.enabled_at IS NULL THEN
      NEW.enabled_at := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_enabled IS TRUE AND (OLD.is_enabled IS DISTINCT FROM TRUE) THEN
      NEW.enabled_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_follow_up_enabled_at ON public.follow_up_settings;
CREATE TRIGGER trg_touch_follow_up_enabled_at
BEFORE INSERT OR UPDATE ON public.follow_up_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_follow_up_enabled_at();

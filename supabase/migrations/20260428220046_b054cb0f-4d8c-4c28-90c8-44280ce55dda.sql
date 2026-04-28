ALTER TABLE public.follow_up_settings
  ADD COLUMN IF NOT EXISTS business_hours_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_hours_start smallint NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS business_hours_end smallint NOT NULL DEFAULT 17,
  ADD COLUMN IF NOT EXISTS business_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.follow_up_settings
  DROP CONSTRAINT IF EXISTS follow_up_settings_business_hours_check;
ALTER TABLE public.follow_up_settings
  ADD CONSTRAINT follow_up_settings_business_hours_check
  CHECK (
    business_hours_start BETWEEN 0 AND 23
    AND business_hours_end BETWEEN 1 AND 24
    AND business_hours_start < business_hours_end
  );
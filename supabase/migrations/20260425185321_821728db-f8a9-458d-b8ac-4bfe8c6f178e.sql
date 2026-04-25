
ALTER TABLE public.permission_groups
  ADD COLUMN IF NOT EXISTS domain_id uuid REFERENCES public.allowed_domains(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_permission_groups_domain_id
  ON public.permission_groups(domain_id);

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS domain_id uuid REFERENCES public.allowed_domains(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_domain_id
  ON public.user_profiles(domain_id);

-- Backfill: link existing user_profiles to allowed_domains by email domain
UPDATE public.user_profiles up
SET domain_id = ad.id
FROM public.allowed_domains ad
WHERE up.domain_id IS NULL
  AND lower(ad.domain) = lower(split_part(up.email, '@', 2));

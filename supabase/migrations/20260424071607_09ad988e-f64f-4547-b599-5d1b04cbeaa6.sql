-- Clean up orphan profile/role and duplicate organizations from earlier failed signups.
-- Keep only the active user (8844077e...) mapped to organization 00000000-0000-0000-0000-000000000001.

-- 1. Remove orphan user_profile (user_id no longer exists in auth.users)
DELETE FROM public.user_profiles
WHERE user_id = 'da9d21c8-d596-4d13-8dbe-2f69d8831b79';

-- 2. Remove orphan user_role
DELETE FROM public.user_roles
WHERE user_id = 'da9d21c8-d596-4d13-8dbe-2f69d8831b79';

-- 3. Remove orphan organization_member rows
DELETE FROM public.organization_members
WHERE user_id = 'da9d21c8-d596-4d13-8dbe-2f69d8831b79';

-- 4. Remove duplicate organizations (no users, no profiles attached)
DELETE FROM public.organizations
WHERE id IN (
  '8aed9822-11ff-4471-9139-5fae894345dc',
  'fbcebe3c-e513-4405-827a-9bddd12547d7',
  'e12901d8-bbe6-4c98-a66e-be13a5444bcc'
);

-- 5. Rename the kept org to match the allowed_domains entry "Energyforward"
UPDATE public.organizations
SET name = 'Energyforward'
WHERE id = '00000000-0000-0000-0000-000000000001';
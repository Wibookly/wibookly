UPDATE public.allowed_domains
SET domain = 'energyforward.com',
    organization_name = COALESCE(NULLIF(organization_name, ''), 'EnergyForward'),
    updated_at = now()
WHERE id = 'f46e791d-6a1d-4e46-b58c-5c801492a7f4';

-- Also clean up any discovered_tenant_users that pointed at the misspelled domain
-- (none should exist yet since the filter rejected them all, but just in case).
DELETE FROM public.discovered_tenant_users
WHERE domain_id = 'f46e791d-6a1d-4e46-b58c-5c801492a7f4'
  AND email NOT LIKE '%@energyforward.com';
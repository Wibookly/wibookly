
-- Create allowed_domains table for tenant domain management
CREATE TABLE public.allowed_domains (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  organization_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  max_users INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

ALTER TABLE public.allowed_domains ENABLE ROW LEVEL SECURITY;

-- Only admins can view domains
CREATE POLICY "Admins can view domains"
ON public.allowed_domains
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Only admins can manage domains
CREATE POLICY "Admins can manage domains"
ON public.allowed_domains
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed with energyforward.com
INSERT INTO public.allowed_domains (domain, organization_name, is_active)
VALUES ('energyforward.com', 'Energy Forward', true);

-- Create a function to check if a domain is allowed (public, no auth needed for signup validation)
CREATE OR REPLACE FUNCTION public.is_domain_allowed(_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_domains
    WHERE domain = split_part(_email, '@', 2)
      AND is_active = true
  )
$$;

-- Create a function to check if an email is the super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(_email) = 'arahimi@energyforward.com'
$$;

-- Add trigger for updated_at
CREATE TRIGGER update_allowed_domains_updated_at
BEFORE UPDATE ON public.allowed_domains
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

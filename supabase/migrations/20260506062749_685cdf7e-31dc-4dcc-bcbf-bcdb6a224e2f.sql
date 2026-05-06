
CREATE TABLE IF NOT EXISTS public.help_articles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'getting-started',
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) = 'arahimi@energyforward.com'
  );
$$;

CREATE POLICY "Anyone signed in can view published help"
  ON public.help_articles FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_super_admin());

CREATE POLICY "Super admin can insert help articles"
  ON public.help_articles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admin can update help articles"
  ON public.help_articles FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admin can delete help articles"
  ON public.help_articles FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.update_help_articles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_help_articles_updated_at ON public.help_articles;
CREATE TRIGGER trg_help_articles_updated_at
  BEFORE UPDATE ON public.help_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_help_articles_updated_at();

CREATE INDEX IF NOT EXISTS idx_help_articles_category ON public.help_articles(category);
CREATE INDEX IF NOT EXISTS idx_help_articles_published ON public.help_articles(is_published);

-- Create email_profiles table to store per-email profile and signature data
CREATE TABLE public.email_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT,
  title TEXT,
  phone TEXT,
  mobile TEXT,
  website TEXT,
  email_signature TEXT,
  signature_logo_url TEXT,
  signature_font TEXT DEFAULT 'Arial, sans-serif',
  signature_color TEXT DEFAULT '#333333',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id)
);

-- Add connection_id to categories table
ALTER TABLE public.categories ADD COLUMN connection_id UUID REFERENCES public.provider_connections(id) ON DELETE CASCADE;

-- Add connection_id to rules table  
ALTER TABLE public.rules ADD COLUMN connection_id UUID REFERENCES public.provider_connections(id) ON DELETE CASCADE;

-- Add connection_id to ai_settings table
ALTER TABLE public.ai_settings ADD COLUMN connection_id UUID REFERENCES public.provider_connections(id) ON DELETE CASCADE;

-- Enable RLS on email_profiles
ALTER TABLE public.email_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for email_profiles
CREATE POLICY "Users can view their own email profiles"
ON public.email_profiles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own email profiles"
ON public.email_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own email profiles"
ON public.email_profiles FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own email profiles"
ON public.email_profiles FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_email_profiles_updated_at
BEFORE UPDATE ON public.email_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_email_profiles_connection_id ON public.email_profiles(connection_id);
CREATE INDEX idx_email_profiles_user_id ON public.email_profiles(user_id);
CREATE INDEX idx_categories_connection_id ON public.categories(connection_id);
CREATE INDEX idx_rules_connection_id ON public.rules(connection_id);
CREATE INDEX idx_ai_settings_connection_id ON public.ai_settings(connection_id);

-- Create function to initialize email profile and default categories when a new connection is made
CREATE OR REPLACE FUNCTION public.initialize_email_connection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_profile RECORD;
  default_cats TEXT[][] := ARRAY[
    ['Urgent', '#EF4444'],
    ['Follow Up', '#F97316'],
    ['Approvals', '#EAB308'],
    ['Meetings', '#22C55E'],
    ['Customers', '#06B6D4'],
    ['Vendors', '#3B82F6'],
    ['Internal', '#8B5CF6'],
    ['Projects', '#EC4899'],
    ['Finance', '#14B8A6'],
    ['FYI', '#6B7280']
  ];
  i INT;
BEGIN
  -- Only run when connection becomes active
  IF NEW.is_connected = true AND (OLD IS NULL OR OLD.is_connected = false) THEN
    -- Get user profile data
    SELECT full_name, title, phone, mobile, website, email_signature, 
           signature_logo_url, signature_font, signature_color
    INTO v_user_profile
    FROM public.user_profiles
    WHERE user_id = NEW.user_id
    LIMIT 1;
    
    -- Create email profile if it doesn't exist
    INSERT INTO public.email_profiles (
      connection_id, user_id, organization_id,
      full_name, title, phone, mobile, website, email_signature,
      signature_logo_url, signature_font, signature_color
    )
    VALUES (
      NEW.id, NEW.user_id, NEW.organization_id,
      COALESCE(v_user_profile.full_name, ''),
      v_user_profile.title,
      v_user_profile.phone,
      v_user_profile.mobile,
      v_user_profile.website,
      v_user_profile.email_signature,
      v_user_profile.signature_logo_url,
      COALESCE(v_user_profile.signature_font, 'Arial, sans-serif'),
      COALESCE(v_user_profile.signature_color, '#333333')
    )
    ON CONFLICT (connection_id) DO NOTHING;
    
    -- Create default categories if none exist for this connection
    IF NOT EXISTS (
      SELECT 1 FROM public.categories 
      WHERE connection_id = NEW.id
    ) THEN
      FOR i IN 1..array_length(default_cats, 1) LOOP
        INSERT INTO public.categories (
          organization_id, connection_id, name, color, sort_order, is_enabled
        )
        VALUES (
          NEW.organization_id, NEW.id, default_cats[i][1], default_cats[i][2], i - 1, true
        );
      END LOOP;
    END IF;
    
    -- Create default AI settings if none exist for this connection
    INSERT INTO public.ai_settings (
      organization_id, connection_id, writing_style
    )
    VALUES (
      NEW.organization_id, NEW.id, 'professional'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on provider_connections
CREATE TRIGGER on_connection_established
AFTER INSERT OR UPDATE ON public.provider_connections
FOR EACH ROW
EXECUTE FUNCTION public.initialize_email_connection();

-- Update get_my_connections to return connection ID for active email selection
CREATE OR REPLACE FUNCTION public.get_my_connections()
RETURNS TABLE(
  connected_at text, 
  id uuid, 
  is_connected boolean, 
  organization_id uuid, 
  provider text, 
  connected_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pc.connected_at::text,
    pc.id,
    pc.is_connected,
    pc.organization_id,
    pc.provider,
    COALESCE(pc.connected_email, up.email) as connected_email
  FROM provider_connections pc
  LEFT JOIN user_profiles up ON pc.user_id = up.user_id
  WHERE pc.user_id = auth.uid();
END;
$$;
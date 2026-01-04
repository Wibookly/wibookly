-- 1) Token Vault (server-only) - stores encrypted tokens
CREATE TABLE IF NOT EXISTS public.oauth_token_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'outlook')),
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE public.oauth_token_vault ENABLE ROW LEVEL SECURITY;

-- Deny ALL client access to token vault
CREATE POLICY "no_client_select" ON public.oauth_token_vault FOR SELECT USING (false);
CREATE POLICY "no_client_insert" ON public.oauth_token_vault FOR INSERT WITH CHECK (false);
CREATE POLICY "no_client_update" ON public.oauth_token_vault FOR UPDATE USING (false);
CREATE POLICY "no_client_delete" ON public.oauth_token_vault FOR DELETE USING (false);

-- 2) Remove token columns from provider_connections
ALTER TABLE public.provider_connections DROP COLUMN IF EXISTS access_token;
ALTER TABLE public.provider_connections DROP COLUMN IF EXISTS refresh_token;
ALTER TABLE public.provider_connections DROP COLUMN IF EXISTS token_expires_at;

-- 3) Organization membership table for explicit authorization
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Members can only read their own membership
CREATE POLICY "members_read_own" ON public.organization_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "members_insert_self" ON public.organization_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "deny_member_update" ON public.organization_members FOR UPDATE USING (false);
CREATE POLICY "deny_member_delete" ON public.organization_members FOR DELETE USING (false);

-- 4) Tighten user_profiles RLS to self-only
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.user_profiles;

CREATE POLICY "users_read_own_profile_only" ON public.user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_update_own_profile_only" ON public.user_profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_insert_own_profile_only" ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 5) Update get_my_connections function (tokens removed from table)
CREATE OR REPLACE FUNCTION public.get_my_connections()
RETURNS TABLE(id uuid, provider text, is_connected boolean, connected_at timestamp with time zone, organization_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    pc.id,
    pc.provider,
    pc.is_connected,
    pc.connected_at,
    pc.organization_id
  FROM public.provider_connections pc
  WHERE pc.user_id = auth.uid()
$$;

-- 6) Update disconnect_provider function (no tokens to clear anymore)
CREATE OR REPLACE FUNCTION public.disconnect_provider(_provider text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Update connection status
  UPDATE public.provider_connections
  SET 
    is_connected = false,
    updated_at = now()
  WHERE user_id = auth.uid() AND provider = _provider;
  
  -- Delete tokens from vault (service role context)
  DELETE FROM public.oauth_token_vault
  WHERE user_id = auth.uid() AND provider = _provider;
  
  RETURN FOUND;
END;
$$;

-- 7) Create helper function to check organization membership
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _organization_id
  )
$$;
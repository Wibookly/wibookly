import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { organizationNameSchema, emailSchema, passwordSchema, validateField } from '@/lib/validation';

interface UserProfile {
  id: string;
  user_id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  title: string | null;
}

interface Organization {
  id: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  organization: Organization | null;
  loading: boolean;
  signUp: (email: string, password: string, organizationName: string, fullName: string, title?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  setSelectedOrganization: (orgId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        setTimeout(() => {
          fetchUserData(session.user.id);
        }, 0);
      } else {
        setProfile(null);
        setOrganization(null);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserData = async (userId: string) => {
    try {
      // Use secure RPC function instead of direct table access
      const { data: profileRows } = await supabase.rpc('get_my_profile');
      const profileData = profileRows?.[0];

      if (profileData) {
        setProfile(profileData as UserProfile);

        const { data: orgData } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profileData.organization_id)
          .maybeSingle();

        if (orgData) {
          setOrganization(orgData as Organization);
        }
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, organizationName: string, fullName: string, title?: string) => {
    try {
      // Validate inputs
      const emailValidation = validateField(emailSchema, email);
      if (!emailValidation.success) {
        return { error: new Error(emailValidation.error) };
      }

      const passwordValidation = validateField(passwordSchema, password);
      if (!passwordValidation.success) {
        return { error: new Error(passwordValidation.error) };
      }

      const orgNameValidation = validateField(organizationNameSchema, organizationName);
      if (!orgNameValidation.success) {
        return { error: new Error(orgNameValidation.error) };
      }

      const redirectUrl = `${window.location.origin}/`;

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: emailValidation.data,
        password: passwordValidation.data,
        options: {
          emailRedirectTo: redirectUrl
        }
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('No user returned from signup');

      // Create organization with validated name
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: orgNameValidation.data })
        .select()
        .single();

      if (orgError) throw orgError;

      // Create user profile with full name and title
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          user_id: authData.user.id,
          organization_id: orgData.id,
          email: email,
          full_name: fullName,
          title: title || null
        });

      if (profileError) throw profileError;

      // Create user role as admin
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: authData.user.id,
          organization_id: orgData.id,
          role: 'admin'
        });

      if (roleError) throw roleError;

      // Create default categories
      const defaultCategories = [
        { name: 'Urgent', color: '#ef4444', sort_order: 0 },
        { name: 'Follow Up', color: '#f97316', sort_order: 1 },
        { name: 'Approvals', color: '#eab308', sort_order: 2 },
        { name: 'Meetings', color: '#22c55e', sort_order: 3 },
        { name: 'Customers', color: '#3b82f6', sort_order: 4 },
        { name: 'Vendors', color: '#8b5cf6', sort_order: 5 },
        { name: 'Internal', color: '#ec4899', sort_order: 6 },
        { name: 'Projects', color: '#06b6d4', sort_order: 7 },
        { name: 'Finance', color: '#84cc16', sort_order: 8 },
        { name: 'FYI', color: '#6b7280', sort_order: 9 }
      ];

      await supabase
        .from('categories')
        .insert(defaultCategories.map(cat => ({ ...cat, organization_id: orgData.id })));

      // Create default AI settings
      await supabase
        .from('ai_settings')
        .insert({
          organization_id: orgData.id,
          writing_style: 'professional'
        });

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setProfile(null);
      setOrganization(null);
      setUser(null);
      setSession(null);
      // Force redirect to auth page
      window.location.href = '/auth';
    } catch (error) {
      console.error('Sign out error:', error);
      // Force redirect even on error
      window.location.href = '/auth';
    }
  };

  const setSelectedOrganization = async (orgId: string) => {
    // Fetch the organization and update profile context
    try {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .maybeSingle();

      if (orgData) {
        setOrganization(orgData as Organization);
      }
    } catch (error) {
      console.error('Error setting organization:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, organization, loading, signUp, signIn, signOut, setSelectedOrganization }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';

export interface UserRoleState {
  loading: boolean;
  roles: string[];
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
}

const SUPER_ADMIN_EMAIL = 'arahimi@energyforward.com';

export function useUserRoles(): UserRoleState {
  const { user, profile } = useAuth();
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setRoles([]);
      setLoading(false);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      if (cancelled) return;
      setRoles((data ?? []).map((r: any) => String(r.role)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const emailIsSuper = profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
  const isSuperAdmin = emailIsSuper || roles.includes('super_admin');
  const isOrgAdmin = isSuperAdmin || roles.includes('org_admin') || roles.includes('admin');

  return { loading, roles, isSuperAdmin, isOrgAdmin };
}

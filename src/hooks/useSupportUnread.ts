import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRoles } from '@/hooks/useUserRoles';

interface UnreadCounts {
  /** Total unread messages across tickets the user can see. */
  total: number;
  /** Unread messages on tickets the user owns (their own conversations). */
  mine: number;
  /** Unread messages on tickets the user can administer (org-wide). */
  all: number;
  loading: boolean;
}

/**
 * Cross-component unread-count source for the Help & Support system.
 *
 * "Unread" = messages on a ticket the current user can see, authored by
 * someone OTHER than the current user, with `created_at` newer than the
 * user's `support_issue_reads.last_read_at` for that ticket.
 *
 * Refreshes every 45s and on auth change.
 */
export function useSupportUnread(): UnreadCounts {
  const { user, profile } = useAuth();
  const { isOrgAdmin, isSuperAdmin } = useUserRoles();
  const [state, setState] = useState<UnreadCounts>({ total: 0, mine: 0, all: 0, loading: true });

  useEffect(() => {
    if (!user?.id) {
      setState({ total: 0, mine: 0, all: 0, loading: false });
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        // Pull tickets I own
        const { data: myTickets } = await supabase
          .from('support_issues')
          .select('id, user_id, organization_id')
          .eq('user_id', user.id);

        // Pull org-wide tickets if admin
        let orgTickets: any[] = [];
        if ((isOrgAdmin || isSuperAdmin) && profile?.organization_id) {
          const q = supabase
            .from('support_issues')
            .select('id, user_id, organization_id');
          const { data } = isSuperAdmin
            ? await q
            : await q.eq('organization_id', profile.organization_id);
          orgTickets = data || [];
        }

        const visibleMap = new Map<string, { id: string; mine: boolean }>();
        (myTickets || []).forEach((t: any) => visibleMap.set(t.id, { id: t.id, mine: true }));
        orgTickets.forEach((t: any) => {
          if (!visibleMap.has(t.id)) visibleMap.set(t.id, { id: t.id, mine: t.user_id === user.id });
        });
        const ids = Array.from(visibleMap.keys());
        if (ids.length === 0) {
          if (!cancelled) setState({ total: 0, mine: 0, all: 0, loading: false });
          return;
        }

        // Read marks
        const { data: reads } = await supabase
          .from('support_issue_reads' as any)
          .select('issue_id, last_read_at')
          .eq('user_id', user.id);
        const readMap = new Map<string, string>();
        (reads || []).forEach((r: any) => readMap.set(r.issue_id, r.last_read_at));

        // Messages on visible tickets from other authors
        const { data: msgs } = await supabase
          .from('support_issue_messages' as any)
          .select('issue_id, author_user_id, created_at')
          .in('issue_id', ids)
          .neq('author_user_id', user.id);

        let mine = 0;
        let all = 0;
        for (const m of (msgs || []) as any[]) {
          const lastRead = readMap.get(m.issue_id);
          if (lastRead && new Date(m.created_at) <= new Date(lastRead)) continue;
          const entry = visibleMap.get(m.issue_id);
          if (!entry) continue;
          if (entry.mine) mine += 1;
          else all += 1;
        }
        if (!cancelled) setState({ total: mine + all, mine, all, loading: false });
      } catch {
        if (!cancelled) setState((p) => ({ ...p, loading: false }));
      }
    };

    load();
    const t = setInterval(load, 45_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [user?.id, profile?.organization_id, isOrgAdmin, isSuperAdmin]);

  return state;
}

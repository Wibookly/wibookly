import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

/**
 * Bell in the app header. Shows a red badge with the count of the user's
 * tickets that have admin replies the user hasn't read yet.
 *
 * Unread = support_issue_messages by another author (admin) more recent than
 * the user's `support_issue_reads.last_read_at` for that issue.
 */
export function SupportBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        // 1) Get my tickets
        const { data: tickets } = await supabase
          .from('support_issues')
          .select('id')
          .eq('user_id', user.id);
        const ids = (tickets ?? []).map((t: any) => t.id);
        if (ids.length === 0) {
          if (!cancelled) setCount(0);
          return;
        }
        // 2) Get my read marks
        const { data: reads } = await supabase
          .from('support_issue_reads' as any)
          .select('issue_id, last_read_at')
          .eq('user_id', user.id);
        const readMap = new Map<string, string>();
        (reads ?? []).forEach((r: any) => readMap.set(r.issue_id, r.last_read_at));
        // 3) Get latest non-self messages per ticket
        const { data: msgs } = await supabase
          .from('support_issue_messages' as any)
          .select('issue_id, author_user_id, created_at')
          .in('issue_id', ids)
          .neq('author_user_id', user.id)
          .order('created_at', { ascending: false });
        const seen = new Set<string>();
        let unread = 0;
        for (const m of (msgs ?? []) as any[]) {
          if (seen.has(m.issue_id)) continue;
          seen.add(m.issue_id);
          const lastRead = readMap.get(m.issue_id);
          if (!lastRead || new Date(m.created_at) > new Date(lastRead)) unread++;
        }
        if (!cancelled) setCount(unread);
      } catch {
        /* silent */
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user?.id]);

  return (
    <button
      type="button"
      onClick={() => navigate('/help')}
      aria-label={count > 0 ? `${count} ticket update${count === 1 ? '' : 's'}` : 'Support'}
      title={count > 0 ? `${count} new ticket update${count === 1 ? '' : 's'}` : 'Help & Support'}
      className="relative inline-flex items-center justify-center w-9 h-9 rounded-full transition-all hover:scale-105"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}
    >
      <Bell className="w-[18px] h-[18px]" />
      {count > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold text-white flex items-center justify-center animate-pulse"
          style={{ background: '#ef4444', boxShadow: '0 0 0 2px var(--surface)' }}
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { CORE_WIDGETS, categoryWidget, HomeWidgetDef } from '@/config/homeWidgetRegistry';

export interface HomePreferenceRow {
  id: string;
  user_id: string;
  org_id: string;
  widget_id: string;
  enabled: boolean;
  sort_order: number;
  item_limit: number;
}

export function useHomePreferences() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  const orgId = profile?.organization_id;

  const prefsQuery = useQuery({
    queryKey: ['home_preferences', userId],
    enabled: !!userId && !!orgId,
    queryFn: async () => {
      const { data: prefs } = await supabase
        .from('home_preferences' as any)
        .select('*')
        .eq('user_id', userId!);
      let rows = (prefs || []) as unknown as HomePreferenceRow[];

      // Seed defaults if user has none
      if (rows.length === 0 && orgId) {
        const seed = CORE_WIDGETS.map((w, i) => ({
          user_id: userId!,
          org_id: orgId,
          widget_id: w.id,
          enabled: w.defaultEnabled,
          sort_order: i,
          item_limit: w.defaultLimit,
        }));
        const { data: inserted } = await supabase
          .from('home_preferences' as any)
          .insert(seed)
          .select('*');
        rows = (inserted || []) as unknown as HomePreferenceRow[];
      }

      // Fetch pinned categories
      const { data: pinnedCats } = await supabase
        .from('categories')
        .select('id, name')
        .eq('show_on_home', true);

      const pinned = (pinnedCats || []).map((c: any) => categoryWidget(c.id, c.name));

      // Ensure a pref row exists for each pinned category
      const existingIds = new Set(rows.map(r => r.widget_id));
      const missing = pinned.filter(p => !existingIds.has(p.id));
      if (missing.length && orgId) {
        const seed = missing.map((w, i) => ({
          user_id: userId!,
          org_id: orgId,
          widget_id: w.id,
          enabled: true,
          sort_order: CORE_WIDGETS.length + i,
          item_limit: w.defaultLimit,
        }));
        const { data: inserted } = await supabase
          .from('home_preferences' as any)
          .insert(seed)
          .select('*');
        rows = [...rows, ...((inserted || []) as unknown as HomePreferenceRow[])];
      }

      const defs: HomeWidgetDef[] = [
        ...CORE_WIDGETS,
        ...pinned,
      ];

      return { prefs: rows, defs };
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ widget_id, enabled }: { widget_id: string; enabled: boolean }) => {
      if (!userId || !orgId) return;
      const existing = prefsQuery.data?.prefs.find(p => p.widget_id === widget_id);
      if (existing) {
        await supabase
          .from('home_preferences' as any)
          .update({ enabled })
          .eq('id', existing.id);
      } else {
        const def = prefsQuery.data?.defs.find(d => d.id === widget_id);
        await supabase.from('home_preferences' as any).insert({
          user_id: userId,
          org_id: orgId,
          widget_id,
          enabled,
          sort_order: 999,
          item_limit: def?.defaultLimit ?? 3,
        });
      }
    },
    onMutate: async ({ widget_id, enabled }) => {
      await qc.cancelQueries({ queryKey: ['home_preferences', userId] });
      const prev = qc.getQueryData(['home_preferences', userId]) as any;
      if (prev) {
        qc.setQueryData(['home_preferences', userId], {
          ...prev,
          prefs: prev.prefs.map((p: HomePreferenceRow) =>
            p.widget_id === widget_id ? { ...p, enabled } : p
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['home_preferences', userId], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['home_preferences', userId] });
    },
  });

  return { ...prefsQuery, toggle: toggleMutation.mutate };
}

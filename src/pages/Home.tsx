import { useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useHomePreferences } from '@/hooks/useHomePreferences';
import { GlanceCard } from '@/components/home/GlanceCard';
import { HomeSection } from '@/components/home/HomeSection';
import { NeedsReplyWidget } from '@/components/home/widgets/NeedsReplyWidget';
import { TodayWidget } from '@/components/home/widgets/TodayWidget';
import { CommitmentsWidget } from '@/components/home/widgets/CommitmentsWidget';
import { WaitingOnWidget } from '@/components/home/widgets/WaitingOnWidget';
import { CategoryWidget } from '@/components/home/widgets/CategoryWidget';
import { CustomizeHomeDialog } from '@/components/home/CustomizeHomeDialog';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const { profile } = useAuth();
  const { data } = useHomePreferences();

  const now = new Date();
  const dateline = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const firstName = (profile?.full_name || '').split(' ')[0] || 'there';

  const ordered = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.prefs.map((p) => [p.widget_id, p]));
    return data.defs
      .map((d) => ({ def: d, pref: map.get(d.id) }))
      .filter((x) => (x.pref ? x.pref.enabled : d => d.def.defaultEnabled))
      .sort((a, b) => (a.pref?.sort_order ?? 0) - (b.pref?.sort_order ?? 0));
  }, [data]);

  const digestEnabled = ordered.find((x) => x.def.id === 'digest');
  const rest = ordered.filter((x) => x.def.id !== 'digest');

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-2">
        <div className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
          {dateline} · {time}
        </div>
        <h1 className="text-4xl font-serif text-foreground">
          {greeting()}, {firstName}.
        </h1>
      </header>

      {digestEnabled && <GlanceCard />}

      {rest.map(({ def, pref }) => {
        const limit = pref?.item_limit ?? def.defaultLimit;
        let dest = 'page';
        if (def.route.includes('flagged')) dest = 'Flagged Emails';
        else if (def.route.includes('helm-calendar')) dest = 'Calendar';
        else if (def.route.includes('follow-up')) dest = 'Follow-ups';
        else if (def.route.includes('brief')) dest = 'Brief';

        let body: JSX.Element | null = null;
        if (def.component === 'NeedsReplyWidget') body = <NeedsReplyWidget limit={limit} />;
        else if (def.component === 'TodayWidget') body = <TodayWidget limit={limit} />;
        else if (def.component === 'CommitmentsWidget') body = <CommitmentsWidget limit={limit} />;
        else if (def.component === 'WaitingOnWidget') body = <WaitingOnWidget limit={limit} />;
        else if (def.component === 'CategoryWidget') {
          const cid = def.id.split(':')[1];
          body = <CategoryWidget categoryId={cid} limit={limit} />;
        }
        if (!body) return null;

        return (
          <HomeSection key={def.id} widget={def} destinationName={dest}>
            {body}
          </HomeSection>
        );
      })}

      <div className="flex justify-center pt-4">
        <CustomizeHomeDialog />
      </div>
    </div>
  );
}

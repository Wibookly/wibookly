import { ReactNode, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { HomeWidgetDef, buildRouteHref } from '@/config/homeWidgetRegistry';

interface Props {
  widget: HomeWidgetDef;
  children: ReactNode;
  onRefresh?: () => void;
  footerLabel?: string;
  destinationName?: string;
}

function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export function HomeSection({ widget, children, onRefresh, footerLabel, destinationName }: Props) {
  const [fetchedAt, setFetchedAt] = useState<Date>(() => new Date());
  useEffect(() => { setFetchedAt(new Date()); }, [children]); // eslint-disable-line

  const label = footerLabel ?? `View all in ${destinationName ?? 'page'}`;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[15px] font-medium text-foreground">{widget.title}</h2>
        <button
          onClick={() => { onRefresh?.(); setFetchedAt(new Date()); }}
          className="text-xs text-muted-foreground hover:text-foreground transition"
          aria-label={`Refresh ${widget.title}`}
        >
          {formatTime(fetchedAt)}
        </button>
      </div>
      <Card className="p-3 divide-y divide-border/60">
        <div className="pb-2">{children}</div>
        <Link
          to={buildRouteHref(widget)}
          className="flex items-center justify-center gap-1.5 pt-2 text-sm text-primary hover:underline"
        >
          {label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Card>
    </section>
  );
}

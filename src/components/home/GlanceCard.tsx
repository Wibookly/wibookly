import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDailyDigest } from '@/hooks/useDailyDigest';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function CountPill({ label, tone }: { label: string; tone?: 'destructive' | 'success' | 'default' }) {
  const cls =
    tone === 'destructive' ? 'border-destructive/40 text-destructive bg-destructive/5' :
    tone === 'success' ? 'border-primary/30 text-primary bg-primary/5' :
    'border-border text-muted-foreground';
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs', cls)}>{label}</span>;
}

function Section({ label, value }: { label: string; value: any }) {
  if (!value) return null;
  const items = Array.isArray(value) ? value : [value];
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm text-foreground/90 space-y-0.5">
        {items.slice(0, 3).map((it: any, i: number) => (
          <div key={i}>{typeof it === 'string' ? it : (it.text || it.title || JSON.stringify(it))}</div>
        ))}
      </div>
    </div>
  );
}

export function GlanceCard() {
  const { data, isLoading, refresh, refreshing, dismiss } = useDailyDigest();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (data?.urgency_level === 'urgent' && !data.dismissed_at) setExpanded(true);
    else setExpanded(false);
  }, [data?.id, data?.urgency_level, data?.dismissed_at]);

  if (isLoading) {
    return <Card className="p-4"><Skeleton className="h-20 w-full" /></Card>;
  }

  const urgency = data?.urgency_level ?? 'calm';
  const borderCls =
    urgency === 'urgent' ? 'border-destructive border-[1.5px]' :
    urgency === 'attention' ? 'border-primary' :
    'border-border';

  const Icon = urgency === 'urgent' ? AlertTriangle : Sparkles;
  const iconTint =
    urgency === 'urgent' ? 'bg-destructive/10 text-destructive' :
    urgency === 'attention' ? 'bg-primary/10 text-primary' :
    'bg-muted text-muted-foreground';

  const counts = (data?.counts || {}) as Record<string, number>;
  const pills = [
    counts.urgent   ? { label: `${counts.urgent} urgent`,     tone: 'destructive' as const } : null,
    counts.replies  ? { label: `${counts.replies} replies`,   tone: 'default'     as const } : null,
    counts.meetings ? { label: `${counts.meetings} meetings`, tone: 'default'     as const } : null,
    counts.handled  ? { label: `${counts.handled} handled`,   tone: 'success'     as const } : null,
  ].filter(Boolean) as { label: string; tone: 'destructive' | 'success' | 'default' }[];

  const headline = data?.headline || 'Your day at a glance';
  const subline = data?.subline || (data ? '' : "Tap refresh to generate today's brief.");

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (!next && urgency === 'urgent' && !data?.dismissed_at) dismiss();
  };

  return (
    <Card className={cn('p-4 space-y-3', borderCls)}>
      <button
        onClick={handleToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 text-left"
      >
        <div className={cn('relative h-10 w-10 rounded-full grid place-items-center', iconTint)}>
          <Icon className="h-5 w-5" />
          {urgency === 'attention' && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium text-foreground truncate">{headline}</div>
          {subline && <div className="text-sm text-muted-foreground truncate">{subline}</div>}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {pills.map((p, i) => <CountPill key={i} label={p.label} tone={p.tone} />)}
          <button
            onClick={() => refresh()}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} /> refresh
          </button>
        </div>
      )}

      {expanded && (
        <div className="space-y-3 pt-1">
          {data?.narrative && (
            <p className="text-[15px] leading-relaxed text-foreground/90 font-serif italic">
              {data.narrative}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Section label="Top priority" value={data?.top_priority} />
            <Section label="Meetings" value={data?.meetings} />
            <Section label="Commitments" value={data?.commitments} />
            <Section label="Client signals" value={data?.client_signals} />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-primary">
          <Link to="/brief">Full brief →</Link>
        </Button>
      </div>
    </Card>
  );
}

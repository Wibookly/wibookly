import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  AlarmClock,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileEdit,
  Inbox,
  Info,
  Mail,
  Printer,
  RefreshCw,
  Send,
  Sparkles,
  AlertTriangle,
  Activity,
  Shield,
  Zap,
  ThumbsUp,
  X,
  Star,
  CalendarClock,
  ArrowUpRight,
  Flame,
  Eye,
  Search,
  ExternalLink,
  Target,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { DailyBriefSchedule } from '@/components/app/DailyBriefSchedule';
import { InlineEmailExpander } from '@/components/helm/InlineEmailExpander';

/* ------------------------------------------------------------------ */
/* Types & data hooks                                                 */
/* ------------------------------------------------------------------ */

type View = 'brief' | 'inbox' | 'detail' | 'calendar';
type InboxScope = 'drafts' | 'big3' | 'decisions';

interface HelmItem {
  id: string;
  title: string;
  context: string;
  sender?: string;
  sender_email?: string;
  created_at?: string | null;
  status?: string | null;
  payload?: any;
  due?: string;
  due_at?: string | null;
  tier?: 'big3' | 'decision' | 'overdue' | 'draft' | 'auto';
  score?: number;
  graph_id?: string;
  conversation_id?: string;
}

interface AutoAction {
  id: string;
  text: string;
  time: string;
  tag: 'Sent' | 'Routed' | 'Filed' | 'Booked' | 'Done';
}

function mapRow(r: any): HelmItem {
  return {
    id: r.id,
    title: r.title ?? '(no subject)',
    context: r.context ?? '',
    sender: r.sender_name ?? r.sender_email ?? undefined,
    sender_email: r.sender_email ?? undefined,
    created_at: r.created_at ?? null,
    status: r.status ?? null,
    payload: r.payload ?? null,
    due_at: r.due_at ?? null,
    due: r.due_at
      ? `due ${formatDistanceToNow(new Date(r.due_at), { addSuffix: true })}`
      : undefined,
    tier: r.tier,
    score: r.score,
    graph_id: r.graph_id,
    conversation_id: r.conversation_id,
  };
}

function useHelmData() {
  return useQuery({
    queryKey: ['helm-items'],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [itemsRes, autoRes] = await Promise.all([
        supabase
          .from('helm_items')
          .select(
            'id,title,context,sender_name,sender_email,due_at,tier,score,graph_id,conversation_id,created_at,status,payload',
          )
          .eq('status', 'open')
          .order('score', { ascending: false })
          .limit(200),
        supabase
          .from('activity_log')
          .select('id,action_type,detail,created_at')
          .in('action_type', [
            'item_filed',
            'email_sent',
            'draft_saved',
            'event_moved',
            'event_created',
            'note_sent',
            'focus_block_created',
            'subscription_renewed',
            'subscription_created',
            'morning_prep',
            'section_emailed',
            'item_completed',
          ])
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(80),
      ]);

      const rows = (itemsRes.data ?? []).map(mapRow);
      const explicitBig3 = rows.filter((r) => r.tier === 'big3');
      const decisionRows = rows.filter((r) => r.tier === 'decision');
      const drafts = rows.filter((r) => r.tier === 'draft');
      const overdue = rows.filter((r) => r.tier === 'overdue');
      const known = new Set(['big3', 'decision', 'draft', 'overdue']);
      const fyi = rows.filter((r) => !r.tier || r.tier === ('fyi' as any) || r.tier === ('info' as any) || !known.has(r.tier as string));

      // --- Today's Big 3: AI-relevant only, pinned for the day ----------
      // 1. Eligible = items that actually ask the user to act / decide today.
      //    We rely on (a) explicit big3 tier from the backend, and
      //    (b) decision-tier items whose AI-written triage context shows a
      //    real ask. We deliberately do NOT pad from drafts / overdue so
      //    the list reflects genuine priorities (could be 0–5, not always 3).
      const ASK_RX = /\b(approve|decide|decision|reply|respond|response|review|sign|signature|confirm|need(ed)?\b|please|asap|by (today|tomorrow|eod|cob)|requires?|action required|awaiting|waiting on you|your input|your call)\b/i;
      const looksActionable = (r: HelmItem) =>
        ASK_RX.test(`${r.context ?? ''} ${r.title ?? ''}`) ||
        (typeof r.score === 'number' && r.score >= 70);
      const eligibleBig3 = [
        ...explicitBig3,
        ...decisionRows.filter(looksActionable),
      ].filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx);

      // 2. Pin today's selection in localStorage so the list does NOT
      //    reshuffle every time the user navigates back to The Helm.
      //    Removals (after Send / Complete) are honoured; we never refill.
      const today = new Date().toISOString().slice(0, 10);
      const PIN_KEY = `helm:big3-pinned:${today}`;
      let pinnedIds: string[] = [];
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(PIN_KEY) : null;
        if (raw) pinnedIds = JSON.parse(raw);
      } catch { /* ignore */ }
      // Keep only pinned IDs that still exist & are still actionable today.
      const eligibleIds = new Set(eligibleBig3.map((r) => r.id));
      pinnedIds = pinnedIds.filter((id) => eligibleIds.has(id));
      // If nothing pinned yet (new day) — pick up to 3 highest-score items.
      if (pinnedIds.length === 0 && eligibleBig3.length > 0) {
        pinnedIds = eligibleBig3
          .slice()
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 3)
          .map((r) => r.id);
        try {
          if (typeof window !== 'undefined') window.localStorage.setItem(PIN_KEY, JSON.stringify(pinnedIds));
        } catch { /* ignore */ }
      }
      const pinnedSet = new Set(pinnedIds);
      const big3 = pinnedIds
        .map((id) => eligibleBig3.find((r) => r.id === id))
        .filter((x): x is HelmItem => !!x);

      const big3Ids = new Set(big3.map((item) => item.id));
      const decisions = decisionRows.filter((item) => !big3Ids.has(item.id));
      // Prettify any inline ISO datetimes (e.g. "→ 2026-07-02T09:30:00") into
      // human-readable "Jul 2, 2026 · 9:30 AM" so activity log entries are readable.
      const prettifyIsoInText = (s: string) =>
        s.replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?/g, (_m, y, mo, d, h, mi) => {
          const yr = Number(y), mn = Number(mo) - 1, dy = Number(d), hr = Number(h), mnt = Number(mi);
          if (mn < 0 || mn > 11 || dy < 1 || dy > 31 || hr < 0 || hr > 23) return _m;
          const dt = new Date(yr, mn, dy, hr, mnt);
          const datePart = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          const timePart = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          return `${datePart} · ${timePart}`;
        });
      const autoActions: AutoAction[] = (autoRes.data ?? []).map((a: any) => {
        const at = String(a.action_type ?? '');
        const tag: AutoAction['tag'] =
          at === 'email_sent' || at === 'note_sent' ? 'Sent'
          : at === 'item_filed' ? 'Filed'
          : at === 'event_moved' || at === 'event_created' || at === 'focus_block_created' ? 'Booked'
          : at === 'draft_saved' ? 'Routed'
          : 'Done';
        return {
          id: a.id,
          text: prettifyIsoInText(a.detail ?? 'Filed'),
          time: new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          tag,
        };
      });


      // --- Today: AI-detected items due today (content-driven, not sender-driven)
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      const TODAY_RX = /\b(today|eod|cob|end of day|by (5|6|noon|tonight)|this afternoon|this morning|by ?eob)\b/i;
      const isDueToday = (r: HelmItem) => {
        if (r.due_at) {
          const d = new Date(r.due_at).getTime();
          if (d >= startOfToday.getTime() && d <= endOfToday.getTime()) return true;
        }
        return TODAY_RX.test(`${r.context ?? ''} ${r.title ?? ''}`);
      };
      const dedupeIds = new Set([...big3Ids]);
      const todayItems = [...decisionRows, ...overdue, ...fyi]
        .filter((r) => !dedupeIds.has(r.id) && isDueToday(r))
        .filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10);
      const todayIds = new Set(todayItems.map((t) => t.id));
      const decisionsFiltered = decisions.filter((d) => !todayIds.has(d.id));

      const totalInbound = rows.length + autoActions.length;
      const needsYouIds = new Set([...big3, ...todayItems, ...decisionsFiltered, ...overdue].map((item) => item.id));
      const needsYou = needsYouIds.size;

      return {
        big3,
        today: todayItems,
        decisions: decisionsFiltered,
        drafts,
        overdue,
        fyi,
        autoActions,
        stats: {
          totalInbound,
          needsYou,
          drafted: drafts.length,
          autoHandled: autoActions.length,
        },
      };
    },
    staleTime: 30_000,
  });
}



/* ------------------------------------------------------------------ */
/* Fallback static data (calendar — wired in Phase 4)                 */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Building blocks                                                    */
/* ------------------------------------------------------------------ */

function SectionHeader({
  title,
  subtitle,
  sectionKey,
  emailSection,
  index,
  count,
  onPrint,
  onEmail,
}: {
  title: string;
  subtitle?: string;
  sectionKey?: string;
  emailSection?: 'brief' | 'inbox' | 'calendar' | 'big3' | 'activity';
  index?: number;
  count?: number;
  onPrint?: () => void;
  onEmail?: () => void;
}) {
  const printSection = (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (sectionKey) {
      const target = (e?.currentTarget as HTMLElement | undefined)
        ?.closest('[data-helm-section]') as HTMLElement | null;
      target?.setAttribute('data-print-target', 'true');
      document.body.setAttribute('data-print-section', sectionKey);
      window.print();
      setTimeout(() => {
        document.body.removeAttribute('data-print-section');
        target?.removeAttribute('data-print-target');
      }, 500);
    } else {
      window.print();
    }
  };
  const emailMe = async () => {
    if (!emailSection) {
      toast.info('Nothing to email here.');
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke('helm-email-section', {
        body: { section: emailSection, title },
      });
      if (error) throw error;
      toast.success(`Emailed to ${(data as any)?.recipient ?? 'your inbox'}.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Email failed.');
    }
  };
  const numLabel =
    typeof index === 'number' ? String(index).padStart(2, '0') : null;
  return (
    <div className="mb-5 pt-5 border-t border-border/50">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-baseline gap-4 min-w-0">
          {numLabel && (
            <span className="font-mono text-[11px] tracking-[0.15em] text-muted-foreground/60 tabular-nums shrink-0 pt-1">
              {numLabel}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-foreground leading-tight flex items-center gap-2">
              {title}
              {typeof count === 'number' && (
                <Badge variant="secondary" className="font-mono tabular-nums text-[10px] px-1.5 py-0">
                  {count}
                </Badge>
              )}
            </h2>
            {subtitle && (
              <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 print:hidden shrink-0">
          <Button variant="ghost" size="sm" className="h-8 text-xs font-mono tracking-wider" onClick={(e) => (onPrint ? onPrint() : printSection(e))}>
            <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs font-mono tracking-wider" onClick={onEmail ?? emailMe}>
            <Send className="w-3.5 h-3.5 mr-1.5" /> Email me
          </Button>
        </div>
      </div>
    </div>
  );
}


function HelmCard({
  item,
  onOpen,
  variant = 'default',
  showCheckbox = false,
  done,
  onToggleDone,
  index,
}: {
  item: HelmItem;
  onOpen: () => void;
  variant?: 'default' | 'warning';
  showCheckbox?: boolean;
  done?: boolean;
  onToggleDone?: (next: boolean) => void;
  index?: number;
}) {
  const numLabel =
    typeof index === 'number' ? String(index).padStart(2, '0') : null;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden transition-all rounded-lg border border-border/60',
        'hover:border-primary hover:ring-2 hover:ring-primary/30 hover:ring-offset-1 hover:ring-offset-background hover:bg-muted/20 hover:shadow-md',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        variant === 'warning' && 'border-destructive/40 bg-destructive/5 hover:border-destructive hover:ring-destructive/30',
        done && 'opacity-60',
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {showCheckbox && (
            <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
              <Checkbox
                checked={done}
                onCheckedChange={(c) => onToggleDone?.(Boolean(c))}
                aria-label={`Mark "${item.title}" done`}
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {numLabel && (
              <div className="font-mono text-[10px] tracking-[0.15em] text-muted-foreground/60 tabular-nums mb-1.5">
                {numLabel}
              </div>
            )}
            <div className="flex items-center gap-2 mb-1">
              {variant === 'warning' && (
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
              )}
              <h3
                className={cn(
                  'text-[15px] font-semibold text-foreground leading-snug truncate',
                  done && 'line-through',
                )}
              >
                {item.title}
              </h3>
            </div>
            {item.context && (
              <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2">
                {item.context}
              </p>
            )}
            {(item.sender || item.due) && (
              <div className="flex items-center gap-3 mt-2.5 text-[11px] font-mono tracking-wide">
                {item.sender && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Mail className="w-3 h-3" />
                    {item.sender}
                  </span>
                )}
                {item.due && (
                  <span className={cn(
                    'inline-flex items-center gap-1.5 uppercase',
                    variant === 'warning' ? 'text-destructive font-semibold' : 'text-muted-foreground',
                  )}>
                    <Clock className="w-3 h-3" />
                    {item.due}
                  </span>
                )}
              </div>
            )}
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}

function BackBar({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-6 print:hidden">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to The Helm
      </Button>
      <Separator orientation="vertical" className="h-5" />
      <span className="text-body-2 text-muted-foreground">{label}</span>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6 text-body-2 text-muted-foreground text-center">
        {children}
      </CardContent>
    </Card>
  );
}

function cleanFirstName(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const first = raw.split(/\s+/)[0]?.replace(/[,.]+$/g, '') ?? '';
  if (!first || /^[A-Z]\.??$/i.test(first)) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function firstNameFromEmail(email?: string | null): string {
  const local = String(email ?? '').split('@')[0] ?? '';
  const token = local.split(/[._-]/)[0] ?? '';
  if (!token || /^[a-z]$/i.test(token)) return '';
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function preferredFirstName(user: any, profile: { full_name?: string | null } | null): string {
  const meta = user?.user_metadata ?? {};
  // Prefer the human-entered profile name ("Ali Rahimi" → "Ali") over the
  // email local part ("arahimi@…" → "Arahimi"), which mangles concatenated names.
  const candidates = [
    meta.first_name,
    meta.given_name,
    meta.preferred_name,
    profile?.full_name,
    meta.full_name,
    meta.name,
    firstNameFromEmail(user?.email),
  ];
  for (const candidate of candidates) {
    const name = cleanFirstName(candidate);
    if (name) return name;
  }
  return firstNameFromEmail(user?.email);
}

function ExpandableSummary({
  icon: Icon,
  title,
  subtitle,
  countLabel,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  countLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={false}>
      <Card className="overflow-hidden border-border/60">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group w-full flex items-center justify-between gap-4 p-5 text-left transition-all hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Icon className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h3 className="text-base md:text-lg font-bold text-foreground leading-tight">{title}</h3>
                  <Badge variant="secondary" className="font-mono tabular-nums">{countLabel}</Badge>
                </div>
                <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
              </div>
            </div>
            <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 shrink-0" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/60 p-4 space-y-3">
            {children}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function InboxLauncherCard({
  icon: Icon,
  count,
  label,
  description,
  onOpen,
}: {
  icon: React.ElementType;
  count: number;
  label: string;
  description: string;
  onOpen: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardContent className="p-6 flex items-center gap-5">
        <div className="w-14 h-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <span className="text-h2 font-bold text-foreground tabular-nums">{count}</span>
            <span className="text-body-1 text-foreground">{label}</span>
          </div>
          <p className="text-body-2 text-muted-foreground mt-1">{description}</p>
        </div>
        <ArrowRight className="w-5 h-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pillar block + Ledger row (inline-expand UX)                        */
/* ------------------------------------------------------------------ */

function PillarBlock({
  number, accentClass, iconBg, numberColor, Icon, label, count, items, expandedId, setExpandedId, emptyText, openReader, accent,
}: {
  number: string;
  accentClass: string;
  iconBg: string;
  numberColor: string;
  Icon: React.ElementType;
  label: string;
  count: number;
  items: HelmItem[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  emptyText: string;
  openReader: () => void;
  accent: 'amber' | 'violet' | 'rose' | 'sky' | 'emerald';
}) {
  const [limit, setLimit] = useState<number>(10);
  const visible = items.slice(0, limit);
  const badgeClass =
    accent === 'amber' ? 'bg-amber-500/15 text-amber-600 border-amber-500/30' :
    accent === 'violet' ? 'bg-violet-500/15 text-violet-600 border-violet-500/30' :
    accent === 'rose' ? 'bg-rose-500/15 text-rose-600 border-rose-500/30' :
    accent === 'sky' ? 'bg-sky-500/15 text-sky-600 border-sky-500/30' :
    'bg-emerald-500/15 text-emerald-600 border-emerald-500/30';
  return (
    <div data-helm-section={accent === 'amber' ? 'big3' : 'decisions'}>
      {/* Header — number lives inline with the topic, same font, same baseline */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[20px] font-semibold tracking-tight text-foreground flex items-center gap-3 min-w-0">
          <span className={cn('tabular-nums select-none', numberColor)}>{number}</span>
          <span className="truncate">{label}</span>
          <Badge variant="outline" className={cn('font-mono tabular-nums text-[11px] shrink-0', badgeClass)}>{count}</Badge>
        </h2>
        <button onClick={openReader} className="hidden md:inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-primary shrink-0">
          Open focused reader <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>


      <div className="relative rounded-xl border-2 border-border bg-card overflow-hidden shadow-sm dark:shadow-none dark:border-border/80">
        {items.length === 0 ? (
          <div className="p-8 text-center">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3', iconBg)}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-[13px] italic text-muted-foreground">{emptyText}</p>
          </div>
        ) : (
          <>
            <ul className="divide-y-2 divide-border/70 dark:divide-border/60">
              {visible.map((it, i) => {
                const isOpen = expandedId === it.id;
                return (
                  <li key={it.id} className={cn(isOpen && 'ring-2 ring-inset ring-primary/40 dark:ring-primary/50 rounded-md')}>
                    <button
                      onClick={() => setExpandedId(isOpen ? null : it.id)}
                      className={cn(
                        'w-full text-left p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isOpen && 'bg-muted/60 dark:bg-muted/30',
                      )}
                    >

                      <div className="flex items-start gap-3">
                        <span className={cn('font-mono text-[11px] tabular-nums shrink-0 mt-1 w-5', numberColor)}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="flex-1 min-w-0">
                          {/* Line 1: subject */}
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-[14px] font-semibold text-foreground truncate flex-1">{it.title}</h3>
                            <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', isOpen && 'rotate-180')} />
                          </div>
                          {/* Line 2: sender + email + due */}
                          <p className="text-[11px] font-mono text-muted-foreground mb-1 flex items-center gap-1.5 flex-wrap">
                            <Mail className="w-3 h-3" />
                            <span className="text-foreground/80">{it.sender ?? 'Unknown sender'}</span>
                            {it.sender_email && it.sender_email !== it.sender && (
                              <span className="text-muted-foreground/70">&lt;{it.sender_email}&gt;</span>
                            )}
                            {it.due && (
                              <>
                                <span className="text-muted-foreground/40">·</span>
                                <Clock className="w-3 h-3" /> {it.due}
                              </>
                            )}
                          </p>
                          {/* Line 3: AI one/two-line summary */}
                          <p className="text-[12.5px] text-foreground/80 leading-relaxed line-clamp-2">
                            {it.context || 'AI summary generating — opens with full thread context.'}
                          </p>
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4">
                        <InlineEmailExpander item={it} onClose={() => setExpandedId(null)} accent={accent} showAiSummary />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {items.length > limit && (
              <div className="border-t border-border/40 p-3 flex items-center justify-between gap-3 bg-muted/10">
                <span className="text-[11px] font-mono text-muted-foreground">
                  Showing {visible.length} of {items.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setLimit((n) => Math.min(items.length, n + 10))}>
                    Show 10 more
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setLimit(items.length)}>
                    Show all
                  </Button>
                </div>
              </div>
            )}
            {visible.length > 5 && items.length <= limit && (
              <div className="border-t border-border/40 p-2 text-center bg-muted/10">
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setLimit(10)}>
                  Collapse
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LedgerRow({ item, variant, expanded, onToggle }: {
  item: HelmItem; variant?: 'warning'; expanded: boolean; onToggle: () => void;
}) {
  const replied = (item as any)?.payload?.recipientReplied === true || (item as any)?.status === 'replied';
  return (
    <button
      onClick={onToggle}
      className={cn(
        // Base: 2px border, themed shadow, smooth hover lift for clear tile separation in both themes.
        'group relative w-full text-left rounded-xl border-2 bg-card p-4 transition-all duration-200',
        'shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_6px_rgba(0,0,0,0.35)]',
        'hover:-translate-y-0.5 hover:shadow-lg hover:bg-muted/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        // Variant tints — stronger borders so the box is visible in dark mode too.
        replied
          ? 'border-emerald-500/50 dark:border-emerald-400/50 bg-emerald-500/[0.06] hover:border-emerald-500 dark:hover:border-emerald-400'
          : variant === 'warning'
            ? 'border-destructive/45 dark:border-destructive/55 bg-destructive/[0.04] hover:border-destructive/75'
            : 'border-border dark:border-border/80 hover:border-primary/60 dark:hover:border-primary/70',
        // Expanded
        expanded && 'border-primary dark:border-primary shadow-lg ring-2 ring-primary/25 -translate-y-0.5',
      )}
    >
      <div className="flex items-start gap-3">
        {replied
          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          : variant === 'warning' && <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          {/* Line 1: subject */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-semibold text-foreground truncate flex-1">{item.title}</h3>
            {replied && (
              <Badge className="text-[10px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/20">
                Recipient replied
              </Badge>
            )}
            <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', expanded && 'rotate-180')} />
          </div>
          {/* Line 2: sender (name + email) + due */}
          <p className="text-[11px] font-mono text-muted-foreground mb-1 flex items-center gap-1.5 flex-wrap">
            <Mail className="w-3 h-3" />
            <span className="text-foreground/80">{item.sender ?? 'Unknown sender'}</span>
            {item.sender_email && item.sender_email !== item.sender && (
              <span className="text-muted-foreground/70">&lt;{item.sender_email}&gt;</span>
            )}
            {item.due && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <Clock className="w-3 h-3" />
                <span className={!replied && variant === 'warning' ? 'text-destructive font-semibold' : ''}>{item.due}</span>
              </>
            )}
          </p>
          {/* Line 3: one-line summary */}
          <p className="text-[12.5px] text-foreground/80 leading-relaxed line-clamp-2">
            {item.context || 'Open to see the original message.'}
          </p>
        </div>
      </div>
    </button>
  );
}

function briefInitials(item: HelmItem): string {
  const source = item.sender || item.sender_email || item.title || 'IQ';
  const parts = String(source).replace(/<.*?>/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return String(parts[0] || 'IQ').slice(0, 2).toUpperCase();
}

function briefTime(item: HelmItem): string {
  const p: any = (item as any)?.payload || {};
  const raw =
    p.receivedDateTime ||
    p.received_at ||
    p.sentDateTime ||
    p.sent_at ||
    item.created_at ||
    item.due_at;
  if (!raw) return item.due || 'Now';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return item.due || 'Now';
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const yesterday = new Date(start); yesterday.setDate(start.getDate() - 1);
  const weekAgo = new Date(start); weekAgo.setDate(start.getDate() - 6);
  if (d >= start) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d >= yesterday) return `Yesterday ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (d >= weekAgo) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function briefTag(item: HelmItem, fallback = 'AI'): string {
  const hay = `${item.title} ${item.context} ${item.tier}`.toLowerCase();
  if ((item as any)?.payload?.recipientReplied === true || item.status === 'replied') return 'Replied';
  if (item.tier === 'overdue') return 'Urgent';
  if (item.tier === 'draft') return 'AI Draft';
  if (item.tier === 'decision' || /approve|approval|sign|decision/.test(hay)) return 'Approvals';
  if (/customer|client|onsite|vendor/.test(hay)) return 'Customers';
  if (/follow|flag|reminder/.test(hay)) return 'Follow Up';
  if (item.tier === ('fyi' as any) || item.tier === ('info' as any)) return 'FYI';
  return fallback;
}

function chipTone(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('urgent')) return 'urgent';
  if (l.includes('follow')) return 'follow';
  if (l.includes('approval')) return 'approval';
  if (l.includes('customer')) return 'customer';
  if (l.includes('draft')) return 'draft';
  if (l.includes('replied')) return 'replied';
  return 'default';
}

function BriefHeroStat({ value, label, tone = 'neutral', icon: Icon }: { value: number | string; label: string; tone?: 'neutral' | 'focus' | 'risk' | 'ok'; icon?: React.ComponentType<{ className?: string }> }) {
  const toneStyle: Record<string, { value: string; label: string; iconBg: string }> = {
    neutral: { value: '#FFFFFF', label: 'rgba(255,255,255,0.88)', iconBg: 'rgba(255,255,255,0.18)' },
    focus:   { value: '#BAE6FD', label: 'rgba(186,230,253,0.95)', iconBg: 'rgba(56,189,248,0.28)' },
    risk:    { value: '#FCA5A5', label: 'rgba(252,165,165,0.95)', iconBg: 'rgba(248,113,113,0.28)' },
    ok:      { value: '#86EFAC', label: 'rgba(134,239,172,0.95)', iconBg: 'rgba(74,222,128,0.28)' },
  };
  const t = toneStyle[tone];
  return (
    <div className="helm-brief-hero-stat">
      {Icon && (
        <span className="helm-brief-hero-stat-icon" style={{ background: t.iconBg }}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      )}
      <div className="text-3xl md:text-[2.75rem] font-black tabular-nums leading-none tracking-tight" style={{ color: t.value, textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>{value}</div>
      <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: t.label }}>{label}</div>
    </div>
  );
}

function BriefHeroStats({ tasks, focusMinutes, atRisk }: { tasks: number; focusMinutes: number; atRisk: number }) {
  return (
    <div className="helm-brief-hero-stats" aria-label="Today summary">
      <BriefHeroStat value={tasks} label="Priority tasks" tone="neutral" icon={Target} />
      <BriefHeroStat value={`${focusMinutes}m`} label="Focus time" tone="focus" icon={Clock} />
      <BriefHeroStat value={atRisk} label="At risk" tone="risk" icon={AlertTriangle} />
    </div>
  );
}

function BriefMetricTile({ icon: Icon, label, value, subLabel, accent, delta, onClick }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subLabel: string;
  accent: string;
  delta?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="helm-brief-metric text-left" data-accent={accent}>
      <div className="flex items-start justify-between gap-3">
        <span className="helm-brief-icon"><Icon className="w-4 h-4" /></span>
        {delta && <span className="text-[10px] font-mono text-success">{delta}</span>}
      </div>
      <div className="mt-4 text-2xl md:text-3xl font-bold text-foreground tabular-nums leading-none">{value}</div>
      <div className="mt-2 text-[12px] font-semibold text-foreground/85">{label}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{subLabel}</div>
    </button>
  );
}

function HelmRowActions({
  outlookHref,
  tagLabel,
  tagTone,
  onPromote,
  onDisregard,
  isPromoted,
  expanded,
}: {
  outlookHref?: string | null;
  tagLabel?: string;
  tagTone?: string;
  onPromote?: () => void;
  onDisregard?: () => void;
  isPromoted?: boolean;
  expanded?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 shrink-0 self-start mt-0.5">
      {tagLabel && <span className="helm-brief-chip hidden sm:inline-flex" data-tone={tagTone || 'default'}>{tagLabel}</span>}
      {outlookHref && (
        <a
          href={outlookHref}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in Outlook"
          title="Open this email in Outlook"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border/60 text-muted-foreground hover:text-sky-600 hover:border-sky-500/60 hover:bg-sky-500/10 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
      {onPromote && (
        <button
          type="button"
          aria-label={isPromoted ? 'Pinned to Top Priorities' : 'Pin to Top Priorities'}
          title={isPromoted ? 'Pinned to Top Priorities' : 'Promote to Top Priorities'}
          onClick={(e) => { e.stopPropagation(); onPromote(); }}
          className={cn(
            'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
            isPromoted
              ? 'border-amber-500/60 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25'
              : 'border-border/60 text-muted-foreground hover:text-amber-600 hover:border-amber-500/60 hover:bg-amber-500/10',
          )}
        >
          <Star className={cn('w-3.5 h-3.5', isPromoted && 'fill-current')} />
        </button>
      )}
      {onDisregard && (
        <button
          type="button"
          aria-label="Disregard"
          title="Disregard — remove from list"
          onClick={(e) => { e.stopPropagation(); onDisregard(); }}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border/60 text-muted-foreground hover:text-rose-600 hover:border-rose-500/60 hover:bg-rose-500/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
    </span>
  );
}

function BriefTaskRow({ item, index, expanded, onToggle, accent = 'violet', onPromote, onDisregard, isPromoted }: {
  item: HelmItem;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  accent?: 'amber' | 'violet' | 'rose' | 'sky' | 'emerald';
  onPromote?: () => void;
  onDisregard?: () => void;
  isPromoted?: boolean;
}) {
  const tag = briefTag(item, index === 0 ? 'Urgent' : 'AI');
  return (
    <div className="helm-brief-row-wrap" data-open={expanded ? 'true' : 'false'}>
      <button type="button" onClick={onToggle} className="helm-brief-task-row">
        <span className="helm-brief-rank">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] md:text-sm font-semibold text-foreground truncate">{item.title}</span>
            <span className="helm-brief-chip shrink-0" data-tone={chipTone(tag)}>{tag}</span>
          </span>
          <span className="mt-1 block text-[12px] text-muted-foreground truncate">{item.context || 'Open for the full thread and AI draft.'}</span>
        </span>
        <HelmRowActions
          outlookHref={helmOutlookLink(item)}
          onPromote={onPromote}
          onDisregard={onDisregard}
          isPromoted={isPromoted}
          expanded={expanded}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <InlineEmailExpander item={item} onClose={onToggle} accent={accent} showAiSummary />
        </div>
      )}
    </div>
  );
}

function BriefSignalCard({ title, subtitle, items, tone, icon: Icon, emptyText, onPromote, onDisregard, promotedIds }: {
  title: string;
  subtitle?: string;
  items: Array<HelmItem | AutoAction>;
  tone: 'risk' | 'win';
  icon: React.ElementType;
  emptyText: string;
  onPromote?: (id: string) => void;
  onDisregard?: (id: string) => void;
  promotedIds?: Set<string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const INITIAL = 5;
  const visible = showAll ? items : items.slice(0, INITIAL);
  const accent = tone === 'risk' ? 'rose' : 'emerald';
  const hasMore = items.length > INITIAL;
  const autoActionMeaning = (tag: string): string => {
    switch (tag) {
      case 'Sent': return 'AI already sent a reply on your behalf. Review to confirm tone.';
      case 'Routed': return 'AI forwarded/routed this to the right teammate.';
      case 'Filed': return 'AI filed this into a folder — no reply needed.';
      case 'Booked': return 'AI booked this as a meeting on your calendar.';
      case 'Done': return 'AI closed this out — nothing else required from you.';
      default: return 'Automated action completed by your AI.';
    }
  };
  return (
    <div className="helm-signal-card" data-tone={tone}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Icon className="w-4 h-4" /> {title}
            <span className={cn(
              'px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold',
              tone === 'risk' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
            )}>{items.length} item{items.length === 1 ? '' : 's'}</span>
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {hasMore && !collapsed && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
              <ChevronDown className={cn('w-3 h-3 transition-transform', showAll && 'rotate-180')} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            aria-label={collapsed ? 'Expand tile' : 'Collapse tile'}
            title={collapsed ? 'Expand tile' : 'Collapse tile'}
          >
            {collapsed ? 'Expand' : 'Collapse'}
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', collapsed && '-rotate-90')} />
          </button>
        </div>
      </div>
      {collapsed ? null : items.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <ul className="mt-3 helm-row-divided">
            {visible.map((raw) => {
              const isAction = 'text' in raw;
              const line = isAction ? raw.text : raw.title;
              const sub = isAction ? autoActionMeaning((raw as AutoAction).tag) : (raw.context || raw.due || 'Open for details');
              const isOpen = openId === raw.id;
              const helmItem = !isAction ? (raw as HelmItem) : null;
              return (
                <li key={raw.id} className="helm-highlight-row-wrap" data-open={isOpen ? 'true' : 'false'}>
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : raw.id)}
                    className="helm-highlight-row items-start"
                  >
                    <span className="helm-avatar mt-0.5" data-accent={tone === 'risk' ? '4' : '1'}>
                      {isAction ? 'AI' : briefInitials(raw as HelmItem)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[13px] font-bold text-foreground truncate">{isAction ? `AI · ${(raw as AutoAction).tag}` : ((raw as HelmItem).sender || 'Unknown sender')}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">· {isAction ? (raw as AutoAction).time : briefTime(raw as HelmItem)}</span>
                      </span>
                      <span className="block text-[13px] font-semibold text-foreground leading-snug truncate">{line}</span>
                      <span className="mt-1 block text-[12px] text-muted-foreground whitespace-normal line-clamp-4 leading-snug">
                        <span className="text-foreground/70 font-semibold">{isAction ? 'What AI did:' : 'AI summary:'}</span> {sub || 'Open for details.'}
                      </span>
                    </span>
                    <HelmRowActions
                      outlookHref={helmItem ? helmOutlookLink(helmItem) : null}
                      tagLabel={tone === 'risk' ? 'At risk' : 'Quick win'}
                      tagTone={tone === 'risk' ? 'urgent' : 'default'}
                      onPromote={helmItem && onPromote ? () => onPromote(helmItem.id) : undefined}
                      onDisregard={helmItem && onDisregard ? () => onDisregard(helmItem.id) : undefined}
                      isPromoted={helmItem ? promotedIds?.has(helmItem.id) : false}
                      expanded={isOpen}
                    />
                  </button>
                  {isOpen && !isAction && (
                    <div className="px-4 pb-4">
                      <InlineEmailExpander item={raw as HelmItem} onClose={() => setOpenId(null)} accent={accent} showAiSummary />
                    </div>
                  )}
                  {isOpen && isAction && (
                    <div className="px-4 pb-4 space-y-2 text-[12px]">
                      <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="helm-brief-chip" data-tone="default">{(raw as AutoAction).tag}</span>
                          <span className="text-muted-foreground">{(raw as AutoAction).time}</span>
                        </div>
                        <p className="text-foreground/90 font-medium">{(raw as AutoAction).text}</p>
                        <p className="mt-2 text-muted-foreground leading-snug">{autoActionMeaning((raw as AutoAction).tag)}</p>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
              <ChevronDown className={cn('w-3 h-3 transition-transform', showAll && 'rotate-180')} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function helmOutlookLink(item: HelmItem): string | null {
  const p = (item as any)?.payload || {};
  const direct = p.webLink || p.web_link;
  if (typeof direct === 'string' && direct.startsWith('http')) return direct;
  const gid = item.graph_id || p.graph_id || p.id;
  if (!gid) return null;
  const folderHint = String(p.folder || p.parentFolderName || '').toLowerCase();
  const seg = folderHint.includes('sent') ? 'sentitems' : 'inbox';
  return `https://outlook.office.com/mail/${seg}/id/${encodeURIComponent(gid)}`;
}

function BriefEmailRow({ item, index, expanded, onToggle, onDisregard, onPromote, isPromoted }: {
  item: HelmItem;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onDisregard?: () => void;
  onPromote?: () => void;
  isPromoted?: boolean;
}) {
  const tag = briefTag(item);
  const summary = (item.context || '').trim() || 'Open to review the message, links, and AI draft.';
  const fullTime = useMemo(() => {
    const t = (item as any)?.payload?.receivedDateTime || (item as any)?.payload?.received_at || (item as any)?.timestamp;
    if (!t) return briefTime(item);
    try {
      const d = new Date(t);
      return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return briefTime(item); }
  }, [item]);
  return (
    <div className="helm-highlight-row-wrap" data-open={expanded ? 'true' : 'false'}>
      <button type="button" onClick={onToggle} className="helm-highlight-row items-start">
        <span className="helm-avatar mt-0.5" data-accent={String(index % 5)}>{briefInitials(item)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[13px] font-bold text-foreground truncate">{item.sender || 'Unknown sender'}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">· {briefTime(item)}</span>
          </span>
          <span className="block text-[13px] font-semibold text-foreground leading-snug truncate">{item.title}</span>
          <span className="mt-1 block text-[12px] text-muted-foreground whitespace-normal line-clamp-4 leading-snug">
            <span className="text-foreground/70 font-semibold">AI summary:</span> {summary}
          </span>
        </span>
        <span className="flex items-center gap-1 shrink-0 self-start mt-0.5">
          <span className="helm-brief-chip hidden sm:inline-flex" data-tone={chipTone(tag)}>{tag}</span>
          {(() => {
            const href = helmOutlookLink(item);
            if (!href) return null;
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in Outlook"
                title="Open this email in Outlook"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border/60 text-muted-foreground hover:text-sky-600 hover:border-sky-500/60 hover:bg-sky-500/10 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            );
          })()}
          {onPromote && (
            <button
              type="button"
              aria-label={isPromoted ? 'Pinned to Top Priorities' : 'Pin to Top Priorities'}
              title={isPromoted ? 'Pinned to Top Priorities' : 'Promote to Top Priorities'}
              onClick={(e) => { e.stopPropagation(); onPromote(); }}
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                isPromoted
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25'
                  : 'border-border/60 text-muted-foreground hover:text-amber-600 hover:border-amber-500/60 hover:bg-amber-500/10',
              )}
            >
              <Star className={cn('w-3.5 h-3.5', isPromoted && 'fill-current')} />
            </button>
          )}
          {onDisregard && (
            <button
              type="button"
              aria-label="Disregard this email"
              title="Disregard — remove from highlights"
              onClick={(e) => { e.stopPropagation(); onDisregard(); }}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border/60 text-muted-foreground hover:text-rose-600 hover:border-rose-500/60 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
            <Clock className="w-3 h-3" /> Received {fullTime}
          </div>
          <InlineEmailExpander item={item} onClose={onToggle} accent={item.tier === 'overdue' ? 'rose' : 'sky'} showAiSummary={false} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Views                                                              */
/* ------------------------------------------------------------------ */



function BriefView({
  go,
  done,
  toggleDone,
}: {
  go: (v: View, item?: HelmItem, scope?: InboxScope) => void;
  done: Record<string, boolean>;
  toggleDone: (id: string, next: boolean) => void;
}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useHelmData();
  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Good morning';
    if (hr < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);
  const name = preferredFirstName(user, profile);

  const sync = useMutation({
    mutationFn: async () => {
      const { data: res, error } = await supabase.functions.invoke('helm-sync-mail', {
        body: {},
      });
      if (error) throw error;
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helm-items'] });
    },
    // Auto-sync runs silently; surface errors only when a manual retry fails.
    onError: () => { /* silent — next interval will retry */ },
  });

  // Auto-sync on mount, then every 5 minutes. No manual button required.
  useEffect(() => {
    sync.mutate();
    const id = setInterval(() => sync.mutate(), 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const stats = data?.stats ?? { totalInbound: 0, needsYou: 0, drafted: 0, autoHandled: 0 };
  const big3 = data?.big3 ?? [];
  const todayItems = (data as any)?.today ?? [];
  const decisions = data?.decisions ?? [];
  const overdue = data?.overdue ?? [];
  const fyi = data?.fyi ?? [];
  const autoActions = data?.autoActions ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ledgerTab, setLedgerTab] = useState<'overdue' | 'fyi' | 'auto'>('overdue');
  const [search, setSearch] = useState('');
  const big3Ids = useMemo(() => new Set(big3.map((b) => b.id)), [big3]);
  const [promotedIds, setPromotedIds] = useState<Set<string>>(new Set());
  const [disregardedIds, setDisregardedIds] = useState<Set<string>>(new Set());
  const promoteToBig3 = async (id: string) => {
    setPromotedIds((s) => { const n = new Set(s); n.add(id); return n; });
    try {
      const today = new Date().toISOString().slice(0, 10);
      const KEY = `helm:big3-pinned:${today}`;
      const raw = window.localStorage.getItem(KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      if (!ids.includes(id)) ids.unshift(id);
      window.localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 10)));
      await supabase.from('helm_items').update({ tier: 'big3' } as any).eq('id', id);
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      toast.success('Pinned to Top Priorities');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not pin');
    }
  };
  const disregardItem = async (id: string) => {
    setDisregardedIds((s) => { const n = new Set(s); n.add(id); return n; });
    if (expandedId === id) setExpandedId(null);
    try {
      await supabase.from('helm_items').update({ status: 'resolved' }).eq('id', id);
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      toast.success('Disregarded');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not disregard');
    }
  };
  const [tileCollapsed, setTileCollapsed] = useState<Record<string, boolean>>({});
  const toggleTile = (key: string) => setTileCollapsed((s) => ({ ...s, [key]: !s[key] }));
  const [showAllHighlights, setShowAllHighlights] = useState(false);
  const expandedItem =
    big3.find((x) => x.id === expandedId) ||
    decisions.find((x) => x.id === expandedId) ||
    overdue.find((x) => x.id === expandedId) ||
    fyi.find((x) => x.id === expandedId) ||
    null;

  // Live week preview for the right rail (returns per-day list of events with times)
  const weekPreview = useQuery({
    queryKey: ['helm-week-preview'],
    queryFn: async () => {
      const ws = new Date();
      const day = ws.getDay();
      const diff = day === 0 ? -6 : 1 - day; // Monday start
      ws.setDate(ws.getDate() + diff);
      ws.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.functions.invoke('helm-sync-calendar', {
        body: { week_start: ws.toISOString() },
      });
      if (error) throw error;
      const events = ((data as any)?.events ?? []) as Array<{ start: string | null; end?: string | null; subject: string }>;
      const byDay: Record<string, Array<{ start: Date; end: Date | null; subject: string }>> = {};
      for (const ev of events) {
        if (!ev.start) continue;
        const sd = new Date(ev.start);
        const k = sd.toDateString();
        (byDay[k] ??= []).push({
          start: sd,
          end: ev.end ? new Date(ev.end) : null,
          subject: ev.subject || '(no subject)',
        });
      }
      const out: { day: string; date: Date; count: number; isToday: boolean; events: Array<{ start: Date; end: Date | null; subject: string }> }[] = [];
      const todayKey = new Date().toDateString();
      for (let i = 0; i < 5; i++) {
        const d = new Date(ws);
        d.setDate(ws.getDate() + i);
        const list = (byDay[d.toDateString()] ?? []).sort((a, b) => a.start.getTime() - b.start.getTime());
        out.push({
          day: d.toLocaleDateString(undefined, { weekday: 'short' }),
          date: d,
          count: list.length,
          isToday: d.toDateString() === todayKey,
          events: list,
        });
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });

  const today = useMemo(
    () =>
      new Date().toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );
  const nowTime = useMemo(
    () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [],
  );

  const focusMinutes = Math.max(10, Math.min(90, stats.needsYou * 8 || 0));
  const allPrimaryTasks = useMemo(() => {
    const seen = new Set<string>();
    return [...big3, ...todayItems, ...decisions]
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
  }, [big3, todayItems, decisions]);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const primaryTasks = showAllTasks ? allPrimaryTasks : allPrimaryTasks.slice(0, 5);
  const emailHighlights = useMemo(() => {
    const q = search.trim().toLowerCase();
    const seen = new Set<string>();
    return [...overdue, ...decisions, ...(data?.drafts ?? []), ...fyi]
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        if (disregardedIds.has(item.id)) return false;
        if (!q) return true;
        return [item.title, item.context, item.sender, item.sender_email, briefTag(item)]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 25);
  }, [overdue, decisions, data?.drafts, fyi, search, disregardedIds]);
  const todayMeetings = weekPreview.data?.find((d) => d.isToday)?.count ?? 0;

  return (
    <div className="helm-brief-page space-y-4 md:space-y-5">
      {error && (
        <Card className="border-destructive/40 print:hidden">
          <CardContent className="p-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-destructive">Couldn't load your brief: {(error as Error).message}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <header className="helm-brief-topbar print:hidden">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reports</p>
          <h1 className="mt-0.5 text-xl md:text-2xl font-bold text-foreground flex items-baseline gap-2 flex-wrap">
            The Helm <span className="text-[12px] md:text-sm font-medium text-primary">{today}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-semibold"
            onClick={() => {
              document.body.removeAttribute('data-print-section');
              window.print();
            }}
          >
            <Printer className="w-3.5 h-3.5 mr-1.5" /> Print All
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', sync.isPending && 'animate-spin')} /> Refresh
          </Button>
          <div className="helm-brief-search">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search anything…" />
          </div>
          <span className="helm-live-pill" title={sync.isPending ? 'Pulling the latest from your inbox…' : 'Live — syncing every 5 minutes'}>
            <span className="relative inline-flex w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
            </span>
            {(sync.isPending || isLoading) ? 'Syncing' : 'Live sync'}
          </span>
        </div>
      </header>

      <section aria-labelledby="helm-hero" data-helm-section="hero" className="helm-brief-hero">
        <div className="min-w-0">
          <div className="helm-brief-hero-kicker">
            <Sparkles className="w-4 h-4" /> AI analysis · generated {nowTime}
          </div>
          <h2 id="helm-hero" className="helm-brief-hero-title">
            {greeting}{name ? `, ${name}` : ''}.
          </h2>
          <p className="helm-brief-hero-copy">
            Executive brief: <strong>{stats.totalInbound}</strong> inbox items reviewed, <strong>{todayMeetings}</strong> meeting{todayMeetings === 1 ? '' : 's'} on the calendar, and <strong>{focusMinutes} minutes</strong> of high-leverage work identified.
          </p>
        </div>
        <BriefHeroStats tasks={allPrimaryTasks.length} focusMinutes={focusMinutes} atRisk={overdue.length} />
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" data-helm-section="metrics">
        <BriefMetricTile icon={Mail} label="New emails" value={stats.totalInbound} subLabel={`${overdue.length} require attention`} accent="blue" delta="+12%" onClick={() => document.querySelector('[data-helm-section="email-highlights"]')?.scrollIntoView({ behavior: 'smooth' })} />
        <BriefMetricTile icon={FileEdit} label="Drafts ready" value={stats.drafted} subLabel="review below" accent="violet" onClick={() => document.querySelector('[data-helm-section="email-highlights"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        <BriefMetricTile icon={AlarmClock} label="Tracked queue" value={overdue.length} subLabel="waiting or overdue" accent="amber" onClick={() => document.querySelector('[data-helm-section="at-risk"]')?.scrollIntoView({ behavior: 'smooth' })} />
        <BriefMetricTile icon={CheckCircle2} label="Auto-categorized" value={stats.autoHandled} subLabel="handled by AI" accent="emerald" onClick={() => setLedgerTab('auto')} />
      </section>

      <section data-helm-section="top-tasks">
        <div className="helm-brief-panel" data-accent="sky">
          <div className="helm-panel-head">
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-sm font-bold text-foreground">Top tasks for this morning</h2>
              <span className="text-[11px] text-muted-foreground">Ordered by AI confidence</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {allPrimaryTasks.length > 5 && !tileCollapsed['top-tasks'] && (
                <button type="button" onClick={() => setShowAllTasks((v) => !v)} className="text-[12px] font-semibold text-primary hover:underline">
                  {showAllTasks ? 'Show fewer' : `View all ${allPrimaryTasks.length}`} <ChevronDown className={cn('inline w-3.5 h-3.5 transition-transform', showAllTasks && 'rotate-180')} />
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleTile('top-tasks')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                title={tileCollapsed['top-tasks'] ? 'Expand tile' : 'Collapse tile'}
              >
                {tileCollapsed['top-tasks'] ? 'Expand' : 'Collapse'}
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', tileCollapsed['top-tasks'] && '-rotate-90')} />
              </button>
            </div>
          </div>
          {!tileCollapsed['top-tasks'] && (
            <div className="mt-3 space-y-2">
              {isLoading ? (
                <Skeleton className="h-36" />
              ) : allPrimaryTasks.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No urgent tasks right now.</div>
              ) : (
                primaryTasks.map((item, index) => (
                  <BriefTaskRow
                    key={item.id}
                    item={item}
                    index={index}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    accent={item.tier === 'overdue' ? 'rose' : item.tier === 'decision' ? 'violet' : 'amber'}
                    onPromote={() => promoteToBig3(item.id)}
                    onDisregard={() => disregardItem(item.id)}
                    isPromoted={big3Ids.has(item.id) || promotedIds.has(item.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4" data-helm-section="at-risk">
        <BriefSignalCard
          title="At Risk"
          subtitle="Threads that need a reply soon — you're on the hook and the clock is ticking."
          items={overdue}
          tone="risk"
          icon={AlertTriangle}
          emptyText="No overdue reply risk detected."
          onPromote={promoteToBig3}
          onDisregard={disregardItem}
          promotedIds={new Set([...big3Ids, ...promotedIds])}
        />
        <BriefSignalCard
          title="Quick Wins"
          subtitle="Low-effort items you can knock out in under 2 minutes — short replies, FYIs, and actions your AI already handled."
          items={fyi.length ? fyi : autoActions}
          tone="win"
          icon={Zap}
          emptyText="No quick wins yet."
          onPromote={promoteToBig3}
          onDisregard={disregardItem}
          promotedIds={new Set([...big3Ids, ...promotedIds])}
        />
      </section>

      <section className="helm-brief-panel" data-accent="violet" data-helm-section="email-highlights">
        <div className="helm-panel-head">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-sm font-bold text-foreground">Email highlights</h2>
            <span className="text-[11px] text-muted-foreground">
              Showing {Math.min(showAllHighlights ? emailHighlights.length : 5, emailHighlights.length)} of {emailHighlights.length} · scored by AI
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {emailHighlights.length > 5 && !tileCollapsed['highlights'] && (
              <button type="button" onClick={() => setShowAllHighlights((v) => !v)} className="text-[12px] font-semibold text-primary hover:underline">
                {showAllHighlights ? 'Show fewer' : `View all ${emailHighlights.length}`}
                <ChevronDown className={cn('inline w-3.5 h-3.5 ml-1 transition-transform', showAllHighlights && 'rotate-180')} />
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleTile('highlights')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              title={tileCollapsed['highlights'] ? 'Expand tile' : 'Collapse tile'}
            >
              {tileCollapsed['highlights'] ? 'Expand' : 'Collapse'}
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', tileCollapsed['highlights'] && '-rotate-90')} />
            </button>
          </div>
        </div>
        {!tileCollapsed['highlights'] && (
          <div className="mt-3 helm-row-divided">
            {isLoading ? (
              <Skeleton className="h-56" />
            ) : emailHighlights.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {search ? `No email highlights match “${search}”.` : 'No email highlights to review.'}
              </div>
            ) : (
              (showAllHighlights ? emailHighlights : emailHighlights.slice(0, 5)).map((item, index) => (
                <BriefEmailRow
                  key={item.id}
                  item={item}
                  index={index}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onDisregard={() => disregardItem(item.id)}
                  onPromote={() => promoteToBig3(item.id)}
                  isPromoted={big3Ids.has(item.id) || promotedIds.has(item.id)}
                />
              ))
            )}
          </div>
        )}
      </section>


      <section className="print:hidden">
        <Popover>
          <PopoverTrigger asChild>
            <button className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-dashed border-border/70 hover:border-primary/60 hover:bg-muted/30 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-center gap-2.5 min-w-0">
                <CalendarClock className="w-4 h-4 text-primary shrink-0" />
                <span id="schedule" className="text-[13px] font-medium text-foreground">Home email schedule</span>
                <span className="text-[11px] text-muted-foreground hidden sm:inline">· pick days &amp; times this brief lands in your inbox</span>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">configure →</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(640px,90vw)] p-4" align="end" sideOffset={8}>
            <DailyBriefSchedule />
          </PopoverContent>
        </Popover>
      </section>
    </div>
  );
}

function CalendarRail({
  data,
  isLoading,
  onOpen,
}: {
  data: Array<{ day: string; date: Date; count: number; isToday: boolean; events: Array<{ start: Date; end: Date | null; subject: string }> }>;
  isLoading: boolean;
  onOpen: () => void;
}) {
  const [view, setView] = useState<'today' | 'week'>('today');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const todayIndex = Math.max(0, data.findIndex((d) => d.isToday));
  const [dayIdx, setDayIdx] = useState<number>(todayIndex);
  useEffect(() => { setDayIdx(Math.max(0, data.findIndex((d) => d.isToday))); }, [data]);
  const selected = data[dayIdx] ?? data[0];
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const selectedDateLabel = useMemo(() => {
    if (!selected) return '';
    return selected.date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }, [selected]);

  return (
    <Card className="border-border/60 flex-1 flex flex-col">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
            <Calendar className="w-4 h-4 text-primary" />
            {view === 'today' ? (selected?.isToday ? 'Today' : selected?.day ?? 'Day') : 'This week'}
          </CardTitle>
          <button
            onClick={onOpen}
            className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-primary"
          >
            open →
          </button>
        </div>
        <div className="inline-flex rounded-md border border-border/60 p-0.5 bg-muted/30 w-fit">
          <button
            onClick={() => setView('today')}
            className={cn(
              'px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.15em] rounded-sm transition-colors',
              view === 'today' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Day
          </button>
          <button
            onClick={() => setView('week')}
            className={cn(
              'px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.15em] rounded-sm transition-colors',
              view === 'week' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Week
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex-1 flex flex-col">
        {isLoading ? (
          <p className="text-[12px] text-muted-foreground italic py-2">Loading…</p>
        ) : data.length === 0 ? (
          <p className="text-[12px] text-muted-foreground italic py-2">No calendar connected.</p>
        ) : view === 'today' ? (
          <>
            <div className="flex items-center justify-between mb-2 gap-2">
              <button
                onClick={() => setDayIdx((i) => Math.max(0, i - 1))}
                disabled={dayIdx <= 0}
                className="p-1 rounded hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous day"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/80 text-center flex-1">
                {selectedDateLabel}
              </p>
              <button
                onClick={() => setDayIdx((i) => Math.min(data.length - 1, i + 1))}
                disabled={dayIdx >= data.length - 1}
                className="p-1 rounded hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next day"
              >
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            {!selected || selected.events.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[13px] text-muted-foreground italic">No meetings.</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">{selected?.isToday ? 'Your day is clear.' : 'Nothing scheduled.'}</p>
              </div>
            ) : (
              <ul className="space-y-1.5 flex-1">
                {selected.events.slice(0, 8).map((ev, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 py-1.5 border-l-2 border-primary/60 pl-2.5 bg-primary/[0.03] rounded-r"
                  >
                    <div className="font-mono text-[10px] tabular-nums text-primary shrink-0 w-[58px] pt-0.5 whitespace-nowrap">
                      {fmtTime(ev.start)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-foreground leading-snug truncate">{ev.subject}</p>
                      {ev.end && (
                        <p className="text-[10px] text-muted-foreground font-mono">
                          until {fmtTime(ev.end)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
                {selected.events.length > 8 && (
                  <li className="text-[11px] text-muted-foreground italic pt-1">
                    + {selected.events.length - 8} more — open calendar
                  </li>
                )}
              </ul>
            )}
          </>
        ) : (
          <ul className="space-y-0 flex-1">
            {data.map((d) => {
              const isExpanded = expandedDay === d.day;
              return (
                <li key={d.day} className="helm-day-row last:after:hidden">
                  <button
                    onClick={() => d.count > 0 && setExpandedDay(isExpanded ? null : d.day)}
                    disabled={d.count === 0}
                    className={cn(
                      'w-full flex items-center gap-3 text-[13px] py-2 text-left',
                      d.isToday && 'bg-primary/5 -mx-2 px-2 rounded',
                      d.count > 0 && 'hover:bg-muted/30 cursor-pointer',
                      d.count === 0 && 'cursor-default',
                    )}
                  >
                    <span className={cn(
                      'font-mono text-[11px] tracking-wider uppercase w-10 shrink-0',
                      d.isToday ? 'text-primary font-semibold' : 'text-muted-foreground',
                    )}>{d.day}</span>
                    <span className="text-foreground/80 flex-1 leading-snug">
                      {d.count === 0 ? 'No meetings' : `${d.count} meeting${d.count === 1 ? '' : 's'}`}
                    </span>
                    {d.isToday && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-primary">Today</span>
                    )}
                    {d.count > 0 && (
                      <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
                    )}
                  </button>
                  {isExpanded && d.events.length > 0 && (
                    <ul className="pl-12 pr-2 pb-2 space-y-1">
                      {d.events.map((ev, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11.5px] py-1">
                          <span className="font-mono tabular-nums text-primary/80 shrink-0 w-12">
                            {fmtTime(ev.start)}
                          </span>
                          <span className="text-foreground/80 truncate">{ev.subject}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}


function InboxView({ onBack, scope = 'drafts' }: { onBack: () => void; scope?: InboxScope }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useHelmData();
  const allDrafts =
    scope === 'big3' ? (data?.big3 ?? []) :
    scope === 'decisions' ? (data?.decisions ?? []) :
    (data?.drafts ?? []);
  const scopeLabel =
    scope === 'big3' ? "Top Priorities" :
    scope === 'decisions' ? 'Your decisions' :
    'Drafted for you';

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [original, setOriginal] = useState<{
    subject: string;
    from: { name?: string; address?: string } | null;
    body_html: string;
    body_text: string;
  } | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [reshapeBusy, setReshapeBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState<'send' | 'save_draft' | 'schedule' | null>(null);
  const [instruction, setInstruction] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>(''); // yyyy-MM-dd
  const [scheduleTime, setScheduleTime] = useState<string>(''); // HH:mm

  // Snapshot the scope's ids the first time we have data, so the list only
  // shrinks as the user sends. Without this, the backend keeps refilling the
  // scope (Big 3 promotes the next 3 candidates), so the count appears stuck.
  const [scopeIds, setScopeIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (scopeIds === null && allDrafts.length > 0) {
      setScopeIds(allDrafts.map((d) => d.id));
    }
  }, [allDrafts, scopeIds]);
  const lockedIds = scopeIds ?? allDrafts.map((d) => d.id);
  // Sent items disappear from the list and from all counts immediately.
  // Also: only show items that were in the snapshot when the reader opened.
  const drafts = allDrafts.filter((d) => lockedIds.includes(d.id) && !sentIds.has(d.id));

  // Auto-select first unsent draft
  const effectiveId = activeId && drafts.some((d) => d.id === activeId) ? activeId : (drafts[0]?.id ?? null);
  const active = drafts.find((d) => d.id === effectiveId) ?? null;

  // Load original + ensure a draft exists when active item changes
  useEffect(() => {
    if (!active) return;
    setOriginal(null);
    setDraftText('');
    setBodyError(null);
    (async () => {
      try {
        const { data: msg, error } = await supabase.functions.invoke('helm-fetch-message', {
          body: { item_id: active.id },
        });
        if (error) throw error;
        if (!msg?.message) throw new Error('No message returned');
        setOriginal(msg.message);
      } catch (e: any) {
        setBodyError(e?.message ?? 'Failed to load message');
      }
      // Fetch the persisted draft from DB
      const { data: row } = await supabase
        .from('helm_items')
        .select('ai_draft')
        .eq('id', active.id)
        .maybeSingle();
      if (row?.ai_draft) {
        setDraftText(row.ai_draft);
      } else {
        // Generate fresh
        setGenBusy(true);
        try {
          const { data: gen, error: genErr } = await supabase.functions.invoke(
            'helm-draft-reply',
            { body: { item_id: active.id } },
          );
          if (genErr) throw genErr;
          setDraftText(gen?.draft ?? '');
        } catch (e: any) {
          toast.error(e?.message ?? 'Draft generation failed');
        } finally {
          setGenBusy(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId]);

  const reshape = async (instr: string) => {
    if (!active) return;
    setReshapeBusy(true);
    try {
      const { data: gen, error } = await supabase.functions.invoke('helm-draft-reply', {
        body: {
          item_id: active.id,
          instruction: instr,
          // If we have no draft yet, the server will fall back to a fresh draft
          // with the same tone instruction folded in.
          base_draft: draftText || undefined,
        },
      });
      if (error) throw error;
      setDraftText(gen?.draft ?? draftText);
    } catch (e: any) {
      toast.error(e?.message ?? 'Reshape failed');
    } finally {
      setReshapeBusy(false);
    }
  };

  const send = async (mode: 'send' | 'save_draft' | 'schedule', opts?: { scheduled_for?: string }) => {
    if (!active || !draftText.trim()) {
      toast.error('Draft is empty');
      return;
    }
    setSendBusy(mode);
    try {
      const { data: res, error } = await supabase.functions.invoke('helm-send-reply', {
        body: {
          item_id: active.id,
          body: draftText,
          mode,
          ...(mode === 'schedule' && opts?.scheduled_for ? { scheduled_for: opts.scheduled_for } : {}),
        },
      });
      if (error) throw error;
      if (res?.already_sent) {
        toast.info('Already sent — skipped');
      } else if (mode === 'send') {
        toast.success('Reply sent');
      } else if (mode === 'schedule') {
        const when = res?.scheduled_for ? new Date(res.scheduled_for) : null;
        toast.success(
          when ? `Scheduled for ${when.toLocaleString()}` : 'Scheduled',
        );
      } else {
        toast.success('Draft saved in Outlook');
      }
      if (mode === 'send' || mode === 'schedule') {
        setSentIds((prev) => new Set(prev).add(active.id));
        // Drop from today's pinned Big 3 — never refill on next render.
        try {
          const today = new Date().toISOString().slice(0, 10);
          const KEY = `helm:big3-pinned:${today}`;
          const raw = window.localStorage.getItem(KEY);
          if (raw) {
            const ids: string[] = JSON.parse(raw);
            window.localStorage.setItem(KEY, JSON.stringify(ids.filter((id) => id !== active.id)));
          }
        } catch { /* ignore */ }

        // Also prune from the cached helm-items result so every count tile,
        // section and chip in The Helm reflects the new total immediately —
        // before the background refetch finishes.
        qc.setQueryData<any>(['helm-items'], (cur: any) => {
          if (!cur) return cur;
          const prune = (arr: any[] = []) => arr.filter((x) => x.id !== active.id);
          return {
            ...cur,
            big3: prune(cur.big3),
            decisions: prune(cur.decisions),
            drafts: prune(cur.drafts),
            overdue: prune(cur.overdue),
            fyi: prune(cur.fyi),
          };
        });
      }
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      // Auto-advance to next unsent (skip sent ones)
      const remaining = drafts.filter((d) => d.id !== active.id && !sentIds.has(d.id));
      setActiveId(remaining[0]?.id ?? null);
      setDraftText('');
      setOriginal(null);
      setScheduleOpen(false);
      setScheduleDate('');
      setScheduleTime('');
    } catch (e: any) {
      toast.error(e?.message ?? `${mode} failed`);
    } finally {
      setSendBusy(null);
    }
  };

  const submitSchedule = () => {
    if (!scheduleDate || !scheduleTime) {
      toast.error('Pick a date and time');
      return;
    }
    // Build a local-time Date and convert to ISO
    const local = new Date(`${scheduleDate}T${scheduleTime}`);
    if (Number.isNaN(local.getTime())) {
      toast.error('Invalid date/time');
      return;
    }
    if (local.getTime() < Date.now() + 30_000) {
      toast.error('Pick a time at least 1 minute in the future');
      return;
    }
    send('schedule', { scheduled_for: local.toISOString() });
  };

  const skip = () => {
    if (!active) return;
    const remaining = drafts.filter((d) => d.id !== active.id && !sentIds.has(d.id));
    setActiveId(remaining[0]?.id ?? null);
    setDraftText('');
    setOriginal(null);
    setBodyError(null);
  };

  const RESHAPE_CHIPS = ['Shorter', 'More formal', 'Warmer', 'More firm', 'Bullet points'];

  return (
    <div>
      <BackBar onBack={onBack} label={`${scopeLabel} · focused inbox`} />
      <SectionHeader
        title={`${drafts.length} ${scope === 'big3' ? 'priorit' + (drafts.length === 1 ? 'y' : 'ies') : scope === 'decisions' ? 'decision' + (drafts.length === 1 ? '' : 's') : 'draft' + (drafts.length === 1 ? '' : 's')} ready for review`}
        subtitle="Pick one on the left, read the thread on top, edit and send the AI reply at the bottom — same tone as your auto-draft."
        count={drafts.length}
      />

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-destructive">Couldn't load drafts: {(error as Error).message}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-96" />
      ) : drafts.length === 0 ? (
        <EmptyHint>No drafts yet. Sync the inbox to generate fresh drafts.</EmptyHint>
      ) : (
        <div className={cn(
          'grid gap-4 min-h-[70vh]',
          // Mobile: when an item is selected, hide the list and show only the reader.
          active ? 'grid-cols-1 lg:grid-cols-[320px_1fr]' : 'grid-cols-1 lg:grid-cols-[320px_1fr]',
        )}><div className={cn(active && 'hidden lg:block')}>
          {/* Left: list */}
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border max-h-[80vh] overflow-y-auto">
              {drafts.map((d) => {
                const isActive = d.id === effectiveId;
                const isSent = sentIds.has(d.id);
                const category =
                  (d as any).category ??
                  (d.tier === 'decision' ? 'Decision' : d.tier === 'overdue' ? 'Overdue' : 'Reply');
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => setActiveId(d.id)}
                      className={cn(
                        'w-full text-left p-4 transition-colors',
                        isActive ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-muted/40 border-l-2 border-transparent',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            isSent ? 'bg-primary/30' : 'bg-primary',
                          )}
                          aria-label={isSent ? 'sent' : 'unsent'}
                        />
                        <span className="text-body-2 font-semibold text-foreground truncate">
                          {d.sender ?? 'Unknown sender'}
                        </span>
                      </div>
                      <div className="text-body-2 text-foreground truncate">{d.title}</div>
                      {d.context && (
                        <div className="text-caption text-muted-foreground mt-1 line-clamp-2">
                          {d.context}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 mt-2">
                        <Badge variant="outline" className="text-[10px]">
                          {category}
                        </Badge>
                        {isSent && (
                          <Badge variant="secondary" className="text-[10px]">sent</Badge>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          </div>

          {/* Right: reader + composer (on mobile, shown only when an item is active) */}
          <div className={cn(!active && 'hidden lg:block')}>
            {active && (
              <div className="lg:hidden mb-2">
                <Button variant="ghost" size="sm" onClick={() => setActiveId(null)}>
                  <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to list
                </Button>
              </div>
            )}
          <Card className="overflow-hidden">
            {!active ? (
              <CardContent className="p-8 text-body-2 text-muted-foreground">
                Select a draft to review.
              </CardContent>
            ) : (
              <div className="flex flex-col h-full">
                <div className="p-5 border-b border-border">
                  <h3 className="text-h3 text-foreground mb-1">
                    {original?.subject || active.title}
                  </h3>
                  <p className="text-caption text-muted-foreground">
                    From{' '}
                    <span className="font-medium text-foreground">
                      {original?.from?.name ?? active.sender ?? '—'}
                    </span>{' '}
                    {original?.from?.address && (
                      <span className="text-muted-foreground">
                        &lt;{original.from.address}&gt;
                      </span>
                    )}
                  </p>
                </div>

                <div className="p-5 border-b border-border max-h-72 overflow-y-auto bg-card/40">
                  <p className="text-caption uppercase tracking-wider text-muted-foreground mb-2">
                    Original message
                  </p>
                  {bodyError ? (
                    <div className="text-body-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-center justify-between">
                      <span className="text-destructive">Couldn't load this email: {bodyError}</span>
                      <Button size="sm" variant="outline" onClick={() => setActiveId(active.id)}>
                        Retry
                      </Button>
                    </div>
                  ) : original ? (
                    original.body_html ? (
                      <div
                        className="helm-email-body text-[13px] leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: original.body_html }}
                      />
                    ) : (
                      <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">
                        {original.body_text || '(no body)'}
                      </p>
                    )
                  ) : (
                    <Skeleton className="h-20" />
                  )}
                </div>

                <div className="p-5 flex-1 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-caption uppercase tracking-wider text-muted-foreground">
                      AI-drafted reply
                    </p>
                    {(genBusy || reshapeBusy) && (
                      <span className="inline-flex items-center text-caption text-muted-foreground">
                        <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                        {genBusy ? 'Generating…' : 'Reshaping…'}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {RESHAPE_CHIPS.map((c) => (
                      <Button
                        key={c}
                        variant="outline"
                        size="sm"
                        disabled={reshapeBusy || genBusy}
                        onClick={() => reshape(c)}
                      >
                        {c}
                      </Button>
                    ))}
                  </div>

                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder={genBusy ? 'Generating draft…' : 'Your reply…'}
                    className="w-full min-h-[220px] rounded-md border border-input bg-background p-3 text-body-2 text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  />

                  <div className="flex items-center gap-2">
                    <input
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && instruction.trim()) {
                          e.preventDefault();
                          const i = instruction.trim();
                          setInstruction('');
                          reshape(i);
                        }
                      }}
                      placeholder="Tell the AI how to change this reply…"
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-body-2 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!instruction.trim() || reshapeBusy || genBusy}
                      onClick={() => {
                        const i = instruction.trim();
                        setInstruction('');
                        reshape(i);
                      }}
                    >
                      Apply
                    </Button>
                  </div>

                  <Separator className="my-2" />

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={skip}
                      disabled={!!sendBusy}
                    >
                      Skip
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => send('save_draft')}
                      disabled={!!sendBusy || !draftText.trim()}
                    >
                      {sendBusy === 'save_draft' ? 'Saving…' : 'Save draft'}
                    </Button>
                    <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          disabled={!!sendBusy || !draftText.trim()}
                          onClick={() => {
                            // Default to today + 1h, in the user's local timezone
                            if (!scheduleDate || !scheduleTime) {
                              const d = new Date(Date.now() + 60 * 60 * 1000);
                              const pad = (n: number) => String(n).padStart(2, '0');
                              setScheduleDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                              setScheduleTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                            }
                          }}
                        >
                          <CalendarClock className="w-4 h-4 mr-1.5" />
                          {sendBusy === 'schedule' ? 'Scheduling…' : 'Schedule send'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72" align="end">
                        <div className="space-y-3">
                          <p className="text-caption uppercase tracking-wider text-muted-foreground">
                            Send this reply later
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-caption text-muted-foreground">Date</label>
                              <input
                                type="date"
                                value={scheduleDate}
                                onChange={(e) => setScheduleDate(e.target.value)}
                                className="w-full mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-body-2 focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                            <div>
                              <label className="text-caption text-muted-foreground">Time</label>
                              <input
                                type="time"
                                value={scheduleTime}
                                onChange={(e) => setScheduleTime(e.target.value)}
                                className="w-full mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-body-2 focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { label: 'In 1 hour', mins: 60 },
                              { label: 'In 3 hours', mins: 180 },
                              { label: 'Tomorrow 8am', custom: 'tomorrow_8' },
                              { label: 'Monday 8am', custom: 'monday_8' },
                            ].map((p) => (
                              <Button
                                key={p.label}
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-7 text-caption"
                                onClick={() => {
                                  const pad = (n: number) => String(n).padStart(2, '0');
                                  let d: Date;
                                  if (p.custom === 'tomorrow_8') {
                                    d = new Date();
                                    d.setDate(d.getDate() + 1);
                                    d.setHours(8, 0, 0, 0);
                                  } else if (p.custom === 'monday_8') {
                                    d = new Date();
                                    const day = d.getDay();
                                    const add = ((1 - day + 7) % 7) || 7;
                                    d.setDate(d.getDate() + add);
                                    d.setHours(8, 0, 0, 0);
                                  } else {
                                    d = new Date(Date.now() + (p.mins ?? 60) * 60_000);
                                  }
                                  setScheduleDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                                  setScheduleTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                                }}
                              >
                                {p.label}
                              </Button>
                            ))}
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setScheduleOpen(false)}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={submitSchedule} disabled={sendBusy === 'schedule'}>
                              {sendBusy === 'schedule' ? 'Scheduling…' : 'Schedule'}
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Button
                      onClick={() => send('send')}
                      disabled={!!sendBusy || !draftText.trim()}
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      {sendBusy === 'send' ? 'Sending…' : 'Approve & send'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailView({ item, onBack }: { item: HelmItem | null; onBack: () => void }) {
  const qc = useQueryClient();
  const [original, setOriginal] = useState<{
    subject: string;
    from: { name?: string; address?: string } | null;
    body_html: string;
    body_text: string;
    web_link?: string;
  } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'gen' | 'send' | 'save' | 'done' | null>(null);
  const [draftFailed, setDraftFailed] = useState(false);

  useEffect(() => {
    if (!item?.id || !item?.graph_id) return;
    setOriginal(null);
    setDraft('');
    setDraftFailed(false);
    (async () => {
      try {
        const { data: msg, error } = await supabase.functions.invoke('helm-fetch-message', {
          body: { item_id: item.id },
        });
        if (error) throw error;
        setOriginal(msg?.message ?? null);
      } catch (e: any) {
        toast.error(e?.message ?? 'Failed to load thread');
      }
      const { data: row } = await supabase
        .from('helm_items').select('ai_draft').eq('id', item.id).maybeSingle();
      if (row?.ai_draft) {
        setDraft(row.ai_draft);
      } else {
        setBusy('gen');
        try {
          const { data: gen, error: gErr } = await supabase.functions.invoke('helm-draft-reply', {
            body: { item_id: item.id },
          });
          if (gErr) throw gErr;
          setDraft(gen?.draft ?? '');
        } catch {
          setDraftFailed(true);
        } finally {
          setBusy(null);
        }
      }
    })();
  }, [item?.id]);

  if (!item) {
    return (
      <div>
        <BackBar onBack={onBack} label="Detail" />
        <p className="text-body-2 text-muted-foreground">No item selected.</p>
      </div>
    );
  }

  const send = async (mode: 'send' | 'save_draft') => {
    if (!draft.trim()) { toast.error('Draft is empty'); return; }
    setBusy(mode === 'send' ? 'send' : 'save');
    try {
      const { data: res, error } = await supabase.functions.invoke('helm-send-reply', {
        body: { item_id: item.id, body: draft, mode },
      });
      if (error) throw error;
      if (res?.already_sent) toast.info('Already sent — skipped');
      else toast.success(mode === 'send' ? 'Reply sent' : 'Draft saved in Outlook');
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      onBack();
    } catch (e: any) {
      toast.error(e?.message ?? `${mode} failed`);
    } finally {
      setBusy(null);
    }
  };

  const markDone = async () => {
    setBusy('done');
    try {
      await supabase.from('helm_items').update({ status: 'resolved' }).eq('id', item.id);
      await supabase.from('activity_log').insert({
        user_id: (await supabase.auth.getUser()).data.user!.id,
        organization_id: null as any, // RLS default-sets org
        action_type: 'item_completed',
        detail: `Marked done: ${item.title}`,
        action_key: `done:${item.id}`,
      } as any);
      toast.success('Marked done');
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      onBack();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not mark done');
    } finally { setBusy(null); }
  };

  const regenerate = async () => {
    setBusy('gen'); setDraftFailed(false);
    try {
      const { data: gen, error } = await supabase.functions.invoke('helm-draft-reply', {
        body: { item_id: item.id },
      });
      if (error) throw error;
      setDraft(gen?.draft ?? '');
    } catch { setDraftFailed(true); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <BackBar onBack={onBack} label="Item detail" />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6 space-y-3">
            <Badge variant="secondary">{item.tier ?? 'item'}</Badge>
            <h1 className="text-h3 text-foreground">{original?.subject || item.title}</h1>
            <p className="text-caption text-muted-foreground">
              From <span className="font-medium text-foreground">{original?.from?.name ?? item.sender ?? '—'}</span>
              {original?.from?.address && ` <${original.from.address}>`}
            </p>
            {original?.web_link && (
              <a href={original.web_link} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center">
                Open in Outlook <ArrowRight className="w-3 h-3 ml-0.5" />
              </a>
            )}
            <Separator />
            <div className="max-h-[55vh] overflow-y-auto bg-muted/20 -mx-2 px-3 py-2 rounded">
              {!original ? (
                <Skeleton className="h-32" />
              ) : original.body_html ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-body-2"
                  dangerouslySetInnerHTML={{ __html: original.body_html }} />
              ) : (
                <p className="text-body-2 whitespace-pre-wrap">{original.body_text || '(no body)'}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-caption uppercase tracking-wider text-muted-foreground">AI-drafted reply</p>
              {busy === 'gen' && (
                <span className="text-caption text-muted-foreground inline-flex items-center">
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Generating…
                </span>
              )}
            </div>
            {draftFailed ? (
              <div className="text-sm rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-center justify-between">
                <span>Draft failed.</span>
                <Button size="sm" variant="outline" onClick={regenerate}>Retry</Button>
              </div>
            ) : (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={busy === 'gen' ? 'Generating…' : 'Your reply…'}
                className="w-full min-h-[260px] rounded-md border border-input bg-background p-3 text-body-2 font-sans resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
              <Button variant="ghost" onClick={markDone} disabled={!!busy}>
                <ClipboardList className="w-4 h-4 mr-1.5" /> Mark done
              </Button>
              <Button variant="outline" onClick={() => send('save_draft')} disabled={!!busy || !draft.trim()}>
                {busy === 'save' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button onClick={() => send('send')} disabled={!!busy || !draft.trim()}>
                <Send className="w-4 h-4 mr-1.5" /> {busy === 'send' ? 'Sending…' : 'Approve & send'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


interface CalEvent {
  id: string;
  subject: string;
  start: string | null;
  end: string | null;
  time_zone: string;
  organizer: { name: string; email: string };
  attendees: Array<{ name: string; email: string; type: string; response: string }>;
  is_organizer: boolean;
  type: string;
  is_cancelled: boolean;
  web_link: string | null;
  location: string;
  join_url: string | null;
  is_external: boolean;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* ------------------------------------------------------------------ */
/* Focus rules + planning types                                       */
/* ------------------------------------------------------------------ */

type FocusRule = {
  focus_days: string[];
  focus_window: 'morning' | 'afternoon';
  block_minutes: number;
  autonomy: 'ask_all' | 'auto_internal_ask_external' | 'auto_all';
};

type FocusBlock = {
  day_key: string;
  weekday: string;
  start: string;
  end: string;
  state: 'free' | 'needs_move' | 'blocked';
  conflicts: string[];
};

type Proposal = {
  id: string;
  event_id: string;
  subject: string;
  day_key: string;
  old_start: string;
  old_end: string;
  new_start: string;
  new_end: string;
  is_external: boolean;
  is_organizer: boolean;
  attendees: Array<{ name: string; email: string }>;
  organizer: { name: string; email: string };
  classification: 'internal' | 'external';
  reason: string;
  note?: string;
};

type PlanResult = {
  rule: FocusRule;
  focus_blocks: FocusBlock[];
  applied: Proposal[];
  pending_external: Proposal[];
};

const DAY_CHIPS: { id: string; label: string }[] = [
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
];

const DEFAULT_RULE: FocusRule = {
  focus_days: ['tue', 'thu'],
  focus_window: 'morning',
  block_minutes: 90,
  autonomy: 'auto_internal_ask_external',
};

const AUTONOMY_LABEL: Record<FocusRule['autonomy'], string> = {
  ask_all: 'Ask me before moving anything',
  auto_internal_ask_external: 'Auto-move internal · ask me for external',
  auto_all: 'Auto-move both (use with care)',
};

function FocusRulesCard({
  rule,
  saving,
  onChange,
}: {
  rule: FocusRule;
  saving: boolean;
  onChange: (next: FocusRule) => void;
}) {
  const toggleDay = (d: string) => {
    const has = rule.focus_days.includes(d);
    onChange({
      ...rule,
      focus_days: has ? rule.focus_days.filter((x) => x !== d) : [...rule.focus_days, d],
    });
  };
  return (
    <Card className="mb-4 border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" /> My focus rules
          {saving && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" /> recalculating…
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Days</p>
          <div className="flex flex-wrap gap-2">
            {DAY_CHIPS.map((d) => {
              const on = rule.focus_days.includes(d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => toggleDay(d.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs border transition-colors',
                    on
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted',
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Block length</p>
            <div className="flex gap-2">
              {[60, 90, 120].map((m) => (
                <button
                  key={m}
                  onClick={() => onChange({ ...rule, block_minutes: m })}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs border',
                    rule.block_minutes === m
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted',
                  )}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Time of day</p>
            <div className="flex gap-2">
              {(['morning', 'afternoon'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => onChange({ ...rule, focus_window: w })}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs border capitalize',
                    rule.focus_window === w
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted',
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Autonomy</p>
            <select
              value={rule.autonomy}
              onChange={(e) => onChange({ ...rule, autonomy: e.target.value as FocusRule['autonomy'] })}
              className="w-full text-xs bg-background border border-border rounded-md px-2 py-2"
            >
              {(Object.keys(AUTONOMY_LABEL) as Array<FocusRule['autonomy']>).map((k) => (
                <option key={k} value={k}>{AUTONOMY_LABEL[k]}</option>
              ))}
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FocusRulesCompact({
  rule,
  saving,
  onChange,
}: {
  rule: FocusRule;
  saving: boolean;
  onChange: (next: FocusRule) => void;
}) {
  const toggleDay = (d: string) => {
    const has = rule.focus_days.includes(d);
    onChange({
      ...rule,
      focus_days: has ? rule.focus_days.filter((x) => x !== d) : [...rule.focus_days, d],
    });
  };
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">My focus rules</p>
        {saving && (
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" /> recalculating…
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {DAY_CHIPS.map((d) => {
          const on = rule.focus_days.includes(d.id);
          return (
            <button
              key={d.id}
              onClick={() => toggleDay(d.id)}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] border transition-colors',
                on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted',
              )}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Length</span>
          <select
            value={rule.block_minutes}
            onChange={(e) => onChange({ ...rule, block_minutes: Number(e.target.value) })}
            className="text-[11px] bg-background border border-border rounded px-1.5 py-0.5"
          >
            {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}m</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">When</span>
          <select
            value={rule.focus_window}
            onChange={(e) => onChange({ ...rule, focus_window: e.target.value as 'morning' | 'afternoon' })}
            className="text-[11px] bg-background border border-border rounded px-1.5 py-0.5 capitalize"
          >
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
          </select>
        </div>
      </div>
    </div>
  );
}



function fmtTimeShort(iso: string | null) {
  if (!iso) return '';
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const h = Number(m[1]); const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
}

const CAL_START_HOUR = 0;
const CAL_END_HOUR = 24;
const CAL_BUSINESS_START = 8;
const CAL_BUSINESS_END = 18;
const CAL_SLOT_MINUTES = 30;
const CAL_PX_PER_MINUTE = 1.25;
const CAL_TOTAL_MINUTES = (CAL_END_HOUR - CAL_START_HOUR) * 60;
const CAL_GRID_HEIGHT = CAL_TOTAL_MINUTES * CAL_PX_PER_MINUTE;
const CAL_OFFHOURS_TOP_HEIGHT = (CAL_BUSINESS_START - CAL_START_HOUR) * 60 * CAL_PX_PER_MINUTE;
const CAL_OFFHOURS_BOTTOM_TOP = (CAL_BUSINESS_END - CAL_START_HOUR) * 60 * CAL_PX_PER_MINUTE;
const CAL_OFFHOURS_BOTTOM_HEIGHT = (CAL_END_HOUR - CAL_BUSINESS_END) * 60 * CAL_PX_PER_MINUTE;

function minutesFromLocalIso(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function localIsoFromDayMinutes(dayKey: string, minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${dayKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function eventDurationMinutes(start: string | null, end: string | null): number {
  const s = minutesFromLocalIso(start);
  const e = minutesFromLocalIso(end);
  if (s == null || e == null || e <= s) return 30;
  return Math.max(15, Math.min(240, e - s));
}

function roundToSlot(minutes: number): number {
  return Math.round(minutes / CAL_SLOT_MINUTES) * CAL_SLOT_MINUTES;
}

type CalendarMove = { start: string; end: string };
type CalendarGridEvent = CalEvent & {
  displayStart?: string | null;
  displayEnd?: string | null;
  proposal?: Proposal;
  kind?: 'applied' | 'pending' | 'none';
  dismissed?: boolean;
};

function CalendarWeekGrid({
  days,
  eventsByDay,
  variant = 'current',
  focusByDay,
  focusEnabled,
  dismissedFocus,
  appliedFocus,
  onFocusApprove,
  onFocusDismiss,
  focusBusyDay,
  onMoveEvent,
  onResizeEvent,
  movingEventId,
  renderEventFooter,
  onOpenDetails,
  emptyText = 'No meetings',
}: {
  days: { date: Date; label: string; weekday: string; key: string }[];
  eventsByDay: Record<string, CalendarGridEvent[]>;
  variant?: 'current' | 'proposed';
  focusByDay?: Record<string, FocusBlock>;
  focusEnabled?: boolean;
  dismissedFocus?: Record<string, boolean>;
  appliedFocus?: Record<string, boolean>;
  onFocusApprove?: (focus: FocusBlock) => void;
  onFocusDismiss?: (focus: FocusBlock) => void;
  focusBusyDay?: string | null;
  onMoveEvent?: (ev: CalendarGridEvent, dayKey: string, startMinutes: number) => void;
  onResizeEvent?: (ev: CalendarGridEvent, dayKey: string, durationMinutes: number) => void;
  movingEventId?: string | null;
  renderEventFooter?: (ev: CalendarGridEvent) => React.ReactNode;
  onOpenDetails?: (ev: CalendarGridEvent) => void;
  emptyText?: string;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ dayKey: string; minutes: number } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const scroller = gridRef.current?.closest('.helm-calendar-scroll') as HTMLElement | null;
    if (scroller) {
      scroller.scrollTop = Math.max(0, CAL_OFFHOURS_TOP_HEIGHT - 12);
    }
  }, []);
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) out.push(h);
    return out;
  }, []);
  const fmtHour = (h: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12} ${ampm}`;
  };
  const yToMinutes = (e: React.DragEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    return Math.max(CAL_START_HOUR * 60, Math.min(CAL_END_HOUR * 60 - CAL_SLOT_MINUTES, roundToSlot(CAL_START_HOUR * 60 + y / CAL_PX_PER_MINUTE)));
  };
  return (
    <div ref={gridRef} className={cn('helm-calendar-grid', variant === 'proposed' && 'helm-calendar-grid-proposed')} style={{ ['--helm-cal-height' as any]: `${CAL_GRID_HEIGHT}px` }}>
      <div className="helm-calendar-time-head" />
      {days.map((d) => {
        const isToday = d.date.toDateString() === new Date().toDateString();
        return (
          <div key={`head-${d.key}`} className={cn('helm-calendar-day-head', isToday && 'is-today')}>
            <span>{d.weekday}</span>
            <strong>{d.label}</strong>
          </div>
        );
      })}
      <div className="helm-calendar-time-gutter" aria-label="Time of day">
        <div className="helm-calendar-offhours-band" style={{ top: 0, height: `${CAL_OFFHOURS_TOP_HEIGHT}px` }} aria-hidden />
        <div className="helm-calendar-offhours-band" style={{ top: `${CAL_OFFHOURS_BOTTOM_TOP}px`, height: `${CAL_OFFHOURS_BOTTOM_HEIGHT}px` }} aria-hidden />
        {hours.map((h) => {
          const offHours = h < CAL_BUSINESS_START || h >= CAL_BUSINESS_END;
          return (
            <div key={h} className={cn('helm-calendar-time-label', offHours && 'is-offhours')} style={{ top: `${(h - CAL_START_HOUR) * 60 * CAL_PX_PER_MINUTE}px` }}>{fmtHour(h)}</div>
          );
        })}
      </div>
      {days.map((d) => {
        const events = eventsByDay[d.key] ?? [];
        const overlappingIds = new Set<string>();
        for (let i = 0; i < events.length; i++) {
          const a = events[i];
          if (a.is_cancelled || a.dismissed) continue;
          const aStart = minutesFromLocalIso(a.displayStart ?? a.start);
          const aDur = eventDurationMinutes(a.displayStart ?? a.start, a.displayEnd ?? a.end);
          if (aStart == null) continue;
          const aEnd = aStart + aDur;
          for (let j = i + 1; j < events.length; j++) {
            const b = events[j];
            if (b.is_cancelled || b.dismissed) continue;
            const bStart = minutesFromLocalIso(b.displayStart ?? b.start);
            const bDur = eventDurationMinutes(b.displayStart ?? b.start, b.displayEnd ?? b.end);
            if (bStart == null) continue;
            const bEnd = bStart + bDur;
            if (aStart < bEnd && bStart < aEnd) {
              overlappingIds.add(a.id);
              overlappingIds.add(b.id);
            }
          }
        }
        const focus = focusByDay?.[d.key];
        const showFocus = variant === 'proposed' && focusEnabled && focus && !dismissedFocus?.[focus.day_key] && !appliedFocus?.[focus.day_key];
        const isToday = d.date.toDateString() === new Date().toDateString();
        return (
          <div
            key={d.key}
            className={cn('helm-calendar-day-column', isToday && 'is-today', hover?.dayKey === d.key && 'is-drop-target')}
            onDragOver={(e) => {
              if (!onMoveEvent) return;
              e.preventDefault();
              setHover({ dayKey: d.key, minutes: yToMinutes(e) });
            }}
            onDragLeave={() => setHover((cur) => cur?.dayKey === d.key ? null : cur)}
            onDrop={(e) => {
              if (!onMoveEvent) return;
              e.preventDefault();
              const id = e.dataTransfer.getData('text/calendar-event-id') || dragId;
              const all = Object.values(eventsByDay).flat();
              const ev = all.find((x) => x.id === id);
              if (ev) onMoveEvent(ev, d.key, yToMinutes(e));
              setDragId(null);
              setHover(null);
            }}
          >
            <div className="helm-calendar-offhours-band" style={{ top: 0, height: `${CAL_OFFHOURS_TOP_HEIGHT}px` }} aria-hidden />
            <div className="helm-calendar-offhours-band" style={{ top: `${CAL_OFFHOURS_BOTTOM_TOP}px`, height: `${CAL_OFFHOURS_BOTTOM_HEIGHT}px` }} aria-hidden />
            {hours.slice(0, -1).map((h) => <div key={h} className="helm-calendar-hour-line" style={{ top: `${(h - CAL_START_HOUR) * 60 * CAL_PX_PER_MINUTE}px` }} />)}
            {hover?.dayKey === d.key && (
              <div className="helm-calendar-drop-line" style={{ top: `${(hover.minutes - CAL_START_HOUR * 60) * CAL_PX_PER_MINUTE}px` }}>
                <span>{fmtTimeShort(localIsoFromDayMinutes(d.key, hover.minutes))}</span>
              </div>
            )}
            {events.length === 0 && !showFocus && <p className="helm-calendar-empty">{emptyText}</p>}
            {showFocus && focus && (() => {
              const start = minutesFromLocalIso(focus.start) ?? CAL_START_HOUR * 60;
              const duration = eventDurationMinutes(focus.start, focus.end);
              return (
                <div
                  className={cn('helm-calendar-event-card helm-calendar-focus-card', focus.state)}
                  style={{ top: `${Math.max(0, start - CAL_START_HOUR * 60) * CAL_PX_PER_MINUTE}px`, height: `${Math.max(15 * CAL_PX_PER_MINUTE, duration * CAL_PX_PER_MINUTE)}px` }}
                >
                  <div className="flex items-center gap-1 font-semibold text-foreground"><Zap className="w-3 h-3" /> Focus block</div>
                  <p className="font-mono text-[11px] text-foreground">{fmtTimeShort(focus.start)} – {fmtTimeShort(focus.end)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {focus.state === 'free' && 'Approve to push to your calendar.'}
                    {focus.state === 'needs_move' && 'Needs to move a meeting.'}
                    {focus.state === 'blocked' && 'No space — try a different day.'}
                  </p>
                  {focus.state === 'free' && (
                    <div className="flex gap-1.5 mt-1.5">
                      <button disabled={focusBusyDay === focus.day_key} onClick={() => onFocusApprove?.(focus)} className="helm-focus-approve-btn">
                        {focusBusyDay === focus.day_key ? 'Adding…' : 'Approve'}
                      </button>
                      <button onClick={() => onFocusDismiss?.(focus)} className="helm-focus-cancel-btn">Cancel</button>
                    </div>
                  )}
                </div>
              );
            })()}
            {events.map((ev) => {
              const startIso = ev.displayStart ?? ev.start;
              const endIso = ev.displayEnd ?? ev.end;
              const start = minutesFromLocalIso(startIso) ?? CAL_START_HOUR * 60;
              const duration = eventDurationMinutes(startIso, endIso);
              const top = Math.max(0, start - CAL_START_HOUR * 60) * CAL_PX_PER_MINUTE;
              const height = Math.max(30 * CAL_PX_PER_MINUTE, duration * CAL_PX_PER_MINUTE);
              const isMoving = movingEventId === ev.id;
              const isPending = ev.kind === 'pending' && !ev.dismissed;
              const isApplied = ev.kind === 'applied';
              const isOverlap = overlappingIds.has(ev.id);
              const isNew = isPending || isApplied;
              const handleResizeStart = (e: React.MouseEvent) => {
                if (!onResizeEvent) return;
                e.stopPropagation();
                e.preventDefault();
                const startY = e.clientY;
                const startDur = duration;
                let liveDur = startDur;
                const card = (e.currentTarget as HTMLElement).parentElement as HTMLElement | null;
                const onMove = (mv: MouseEvent) => {
                  const deltaMin = (mv.clientY - startY) / CAL_PX_PER_MINUTE;
                  const raw = startDur + deltaMin;
                  liveDur = Math.max(30, Math.round(raw / CAL_SLOT_MINUTES) * CAL_SLOT_MINUTES);
                  if (card) card.style.height = `${liveDur * CAL_PX_PER_MINUTE}px`;
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                  if (liveDur !== startDur) onResizeEvent(ev, d.key, liveDur);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              };
              return (
                <div
                  key={ev.id}
                  draggable={!!onMoveEvent}
                  onDragStart={(e) => {
                    setDragId(ev.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/calendar-event-id', ev.id);
                  }}
                  onDragEnd={() => { setDragId(null); setHover(null); }}
                  data-external={ev.is_external ? 'true' : 'false'}
                  data-short={height < 60 ? 'true' : 'false'}
                  data-tiny={height < 42 ? 'true' : 'false'}
                  className={cn(
                    'helm-calendar-event-card',
                    variant === 'proposed' && 'is-proposed',
                    ev.is_cancelled && 'opacity-60 line-through',
                    isMoving && 'is-saving',
                    isApplied && 'is-applied',
                    isPending && 'is-pending',
                    isNew && 'is-new',
                    isOverlap && 'is-overlap',
                    ev.dismissed && 'opacity-70',
                  )}
                  style={{ top: `${top}px`, height: `${height}px`, cursor: ev.web_link ? 'pointer' : undefined }}
                  onClick={(e) => {
                    // Ignore clicks on inner action buttons (they call stopPropagation)
                    if (ev.web_link) window.open(ev.web_link, '_blank', 'noopener,noreferrer');
                  }}
                  title={`${fmtTimeShort(startIso)}–${fmtTimeShort(endIso)} · ${ev.subject}${ev.location ? ' · 📍 ' + ev.location : ''}${isOverlap ? ' · ⚠ Overlap' : ''} · Click to open in Outlook`}
                >
                  <div className="helm-calendar-event-head">
                    <span className="helm-calendar-event-time">{fmtTimeShort(startIso)}</span>
                    <span className="helm-calendar-event-title" title={ev.subject}>{ev.subject}</span>
                    <div className="helm-calendar-event-badges">
                      {isOverlap && <Badge variant="outline" className="text-[9px] px-1 py-0 leading-tight border-orange-500/60 text-orange-700 bg-orange-500/15">⚠</Badge>}
                      {isApplied && <Badge variant="outline" className="text-[9px] px-1 py-0 leading-tight border-emerald-500/50 text-emerald-700 bg-emerald-500/10">AI</Badge>}
                      {isPending && <Badge variant="outline" className="text-[9px] px-1 py-0 leading-tight border-amber-500/50 text-amber-700 bg-amber-500/10">OK?</Badge>}
                      {variant === 'current' && ev.is_external && <Badge variant="outline" className="text-[9px] px-1 py-0 leading-tight border-accent text-foreground bg-accent/20">Ext</Badge>}
                    </div>
                  </div>
                  <p className="helm-calendar-event-until">until {fmtTimeShort(endIso)}</p>
                  {ev.location && <p className="helm-calendar-event-loc">📍 {ev.location}</p>}
                  {isMoving && <p className="text-[10px] text-primary">Updating…</p>}
                  {renderEventFooter?.(ev)}
                  {onResizeEvent && (
                    <div
                      className="helm-calendar-resize-handle"
                      onMouseDown={handleResizeStart}
                      title="Drag to resize (30-min steps)"
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function CalendarView({ onBack }: { onBack?: () => void }) {
  const [detailsEvent, setDetailsEvent] = useState<CalendarGridEvent | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [rule, setRule] = useState<FocusRule>(DEFAULT_RULE);
  const [ruleLoaded, setRuleLoaded] = useState(false);
  const [focusEnabled, setFocusEnabled] = useState<boolean>(() => {
    try { return window.localStorage.getItem('helm:focus-enabled') !== 'off'; } catch { return true; }
  });
  const [reorganizeEnabled, setReorganizeEnabled] = useState<boolean>(() => {
    try { return window.localStorage.getItem('helm:reorganize-enabled') === 'on'; } catch { return false; }
  });
  const autoFocusOn = focusEnabled || reorganizeEnabled;
  const strategy: 'focus' | 'reorganize' = reorganizeEnabled ? 'reorganize' : 'focus';
  useEffect(() => { try { window.localStorage.setItem('helm:focus-enabled', focusEnabled ? 'on' : 'off'); } catch {} }, [focusEnabled]);
  useEffect(() => { try { window.localStorage.setItem('helm:reorganize-enabled', reorganizeEnabled ? 'on' : 'off'); } catch {} }, [reorganizeEnabled]);
  const qc = useQueryClient();

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['helm-calendar', weekStart.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('helm-sync-calendar', {
        body: { week_start: weekStart.toISOString() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as {
        timezone: string;
        events: CalEvent[];
        week_start: string;
        week_end: string;
      };
    },
  });

  // Load rule from DB once
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) return;
      const { data: r } = await supabase
        .from('helm_focus_rules')
        .select('focus_days, focus_window, block_minutes, autonomy')
        .eq('user_id', u.user.id)
        .maybeSingle();
      if (r) setRule(r as FocusRule);
      setRuleLoaded(true);
    })();
  }, []);

  // Plan query — debounced via key
  const [debouncedRule, setDebouncedRule] = useState(rule);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedRule(rule), 600);
    return () => clearTimeout(t);
  }, [rule]);

  const planQuery = useQuery({
    enabled: ruleLoaded && autoFocusOn,
    queryKey: ['helm-plan', weekStart.toISOString(), strategy, JSON.stringify(debouncedRule)],
    queryFn: async () => {
      // Save the rule first
      const { data: u } = await supabase.auth.getUser();
      if (u?.user) {
        const { data: conn } = await supabase
          .from('provider_connections')
          .select('organization_id')
          .eq('user_id', u.user.id)
          .eq('provider', 'outlook')
          .eq('is_connected', true)
          .order('connected_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (conn?.organization_id) {
          await supabase.from('helm_focus_rules').upsert({
            user_id: u.user.id,
            organization_id: conn.organization_id,
            ...debouncedRule,
          });
        }
      }
      const { data, error } = await supabase.functions.invoke('helm-plan-week', {
        body: { mode: 'analyze', week_start: weekStart.toISOString(), strategy },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as PlanResult;
    },
  });

  // Per-proposal editable note state + dismissed list
  const [draftByProp, setDraftByProp] = useState<Record<string, { note: string; loading: boolean; revealed: boolean }>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [dismissedFocus, setDismissedFocus] = useState<Record<string, boolean>>({});
  const [appliedFocus, setAppliedFocus] = useState<Record<string, boolean>>({});

  const createFocusMutation = useMutation({
    mutationFn: async ({ day_key, start, end }: { day_key: string; start: string; end: string }) => {
      const { data, error } = await supabase.functions.invoke('helm-plan-week', {
        body: { mode: 'create_focus_block', day_key, start, end, block_minutes: rule.block_minutes },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      setAppliedFocus((s) => ({ ...s, [vars.day_key]: true }));
      toast.success('Focus block added to your calendar.');
      refetch();
    },
    onError: (e: any) => toast.error(e.message || 'Could not create focus block.'),
  });

  const revealApproval = async (p: Proposal) => {
    setDraftByProp((s) => ({ ...s, [p.id]: { note: s[p.id]?.note ?? '', loading: true, revealed: true } }));
    try {
      const { data, error } = await supabase.functions.invoke('helm-plan-week', {
        body: { mode: 'preview_note', proposal: p },
      });
      if (error) throw error;
      setDraftByProp((s) => ({ ...s, [p.id]: { note: (data as any)?.note ?? '', loading: false, revealed: true } }));
    } catch (e: any) {
      setDraftByProp((s) => ({ ...s, [p.id]: { note: s[p.id]?.note ?? '', loading: false, revealed: true } }));
      toast.error(e.message || 'Could not draft note.');
    }
  };

  const approveMutation = useMutation({
    mutationFn: async ({ proposal, note }: { proposal: Proposal; note: string }) => {
      const { data, error } = await supabase.functions.invoke('helm-plan-week', {
        body: { mode: 'approve_external', proposal, custom_note: note },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success('Moved and notified attendees.');
      setDraftByProp((s) => { const n = { ...s }; delete n[vars.proposal.id]; return n; });
      qc.invalidateQueries({ queryKey: ['helm-plan'] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message || 'Could not move event.'),
  });

  const [manualMoves, setManualMoves] = useState<Record<string, CalendarMove>>({});

  const rescheduleMutation = useMutation({
    mutationFn: async ({ ev, dayKey, startMinutes, durationMinutes }: { ev: CalendarGridEvent; dayKey: string; startMinutes: number; durationMinutes?: number }) => {
      const currentDur = eventDurationMinutes(ev.displayStart ?? ev.start, ev.displayEnd ?? ev.end);
      const dur = Math.max(30, durationMinutes ?? currentDur);
      const nextStart = localIsoFromDayMinutes(dayKey, startMinutes);
      const nextEnd = localIsoFromDayMinutes(dayKey, startMinutes + dur);
      setManualMoves((s) => ({ ...s, [ev.id]: { start: nextStart, end: nextEnd } }));
      const { data, error } = await supabase.functions.invoke('helm-plan-week', {
        body: { mode: 'reschedule_event', event_id: ev.id, start: nextStart, end: nextEnd, subject: ev.subject },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return { eventId: ev.id, start: nextStart, end: nextEnd };
    },
    onSuccess: () => {
      toast.success('Calendar updated.');
      refetch();
      qc.invalidateQueries({ queryKey: ['helm-week-preview'] });
    },
    onError: (e: any, vars) => {
      setManualMoves((s) => { const n = { ...s }; delete n[vars.ev.id]; return n; });
      toast.error(e.message || 'Could not reschedule event.');
    },
  });

  const days = useMemo(() => {
    const out: { date: Date; label: string; weekday: string; key: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      out.push({
        date: d,
        weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
      });
    }
    return out;
  }, [weekStart]);

  const focusByDay = useMemo(() => {
    const map: Record<string, FocusBlock> = {};
    for (const b of planQuery.data?.focus_blocks ?? []) map[b.day_key] = b;
    return map;
  }, [planQuery.data]);

  const currentGridByDay = useMemo(() => {
    const map: Record<string, CalendarGridEvent[]> = {};
    for (const d of days) map[d.key] = [];
    for (const ev of data?.events ?? []) {
      const move = manualMoves[ev.id];
      const displayStart = move?.start ?? ev.start;
      const displayEnd = move?.end ?? ev.end;
      const key = (displayStart ?? '').slice(0, 10);
      if (!map[key]) continue;
      map[key].push({ ...ev, displayStart, displayEnd, kind: 'none' });
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (minutesFromLocalIso(a.displayStart ?? a.start) ?? 0) - (minutesFromLocalIso(b.displayStart ?? b.start) ?? 0));
    }
    return map;
  }, [data?.events, days, manualMoves]);

  const proposedGridByDay = useMemo(() => {
    const map: Record<string, CalendarGridEvent[]> = {};
    for (const d of days) map[d.key] = [];
    const appliedByEv: Record<string, Proposal> = {};
    const pendingByEv: Record<string, Proposal> = {};
    for (const p of planQuery.data?.applied ?? []) appliedByEv[p.event_id] = p;
    for (const p of planQuery.data?.pending_external ?? []) pendingByEv[p.event_id] = p;
    for (const ev of data?.events ?? []) {
      const ap = appliedByEv[ev.id];
      const pd = pendingByEv[ev.id];
      const proposal = ap || pd;
      const displayStart = proposal ? proposal.new_start : ev.start;
      const displayEnd = proposal ? proposal.new_end : ev.end;
      const key = (displayStart ?? '').slice(0, 10);
      if (!map[key]) continue;
      map[key].push({
        ...ev,
        displayStart,
        displayEnd,
        proposal,
        kind: ap ? 'applied' : pd ? 'pending' : 'none',
        dismissed: proposal ? dismissed[proposal.id] : false,
      });
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (minutesFromLocalIso(a.displayStart ?? a.start) ?? 0) - (minutesFromLocalIso(b.displayStart ?? b.start) ?? 0));
    }
    return map;
  }, [data?.events, days, planQuery.data, dismissed]);

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div>
      {onBack && <BackBar onBack={onBack} label="This week" />}

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <SectionHeader
          title="Your week at a glance"
          subtitle={data?.timezone ? `Times shown in ${data.timezone}` : 'Loading your calendar…'}
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}>← Prev</Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => shiftWeek(1)}>Next →</Button>
          <Button variant="default" size="sm" onClick={() => { refetch(); planQuery.refetch(); }} disabled={isFetching}>
            <RefreshCw className={cn('w-4 h-4 mr-1', isFetching && 'animate-spin')} />
            Sync
          </Button>
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            Couldn't load calendar: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* AI intelligence — two independent strategies (moved to top) */}
      <Card className="overflow-hidden border-primary/30 mb-4">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            <p className="text-sm font-semibold text-foreground truncate">AI intelligence · calendar</p>
            {autoFocusOn && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-600">ON</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Internal moves auto-apply · external always asks you</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            {/* Add focus times card */}
            <div className={cn(
              'rounded-lg border p-3 transition-colors',
              focusEnabled ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card',
            )}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Add focus times</p>
                </div>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={focusEnabled}
                    onChange={(e) => setFocusEnabled(e.target.checked)}
                    className="h-4 w-7 appearance-none rounded-full bg-red-500 relative cursor-pointer transition-colors checked:bg-blue-600 before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:h-3 before:w-3 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-3"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">AI finds an open gap on your chosen days and proposes a focus block — you approve before it lands on your calendar.</p>
              {focusEnabled && (
                <div className="mt-3 pt-3 border-t border-border/40">
                  <FocusRulesCompact rule={rule} saving={planQuery.isFetching} onChange={setRule} />
                </div>
              )}
            </div>

            {/* Reorganize my week card */}
            <div className={cn(
              'rounded-lg border p-3 transition-colors',
              reorganizeEnabled ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card',
            )}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Reorganize my week</p>
                </div>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={reorganizeEnabled}
                    onChange={(e) => setReorganizeEnabled(e.target.checked)}
                    className="h-4 w-7 appearance-none rounded-full bg-red-500 relative cursor-pointer transition-colors checked:bg-blue-600 before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:h-3 before:w-3 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-3"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">AI restructures the week — auto-moves internal meetings to consolidate free time, and asks you before touching anything external.</p>
              {reorganizeEnabled && (
                <p className="text-[10px] text-muted-foreground italic mt-2">All proposed shifts appear in the AI proposed calendar below with check-boxes to approve.</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/30 rounded-md p-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> Free slot found
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 ml-3" /> Needs to move a meeting
            <span className="inline-block w-2 h-2 rounded-full bg-destructive ml-3" /> No space — blocked
          </div>
        </div>
      </Card>

      {/* Current calendar — collapsible */}

      <Collapsible defaultOpen={true}>
        <Card className="mb-4 overflow-hidden border-border/60">
          <CollapsibleTrigger asChild>
            <button className="group w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Your current calendar</p>
                  <p className="text-[12px] text-muted-foreground">Live view of meetings already on your Outlook for this week.</p>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border/60 p-3">
              {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {days.map((d) => <Skeleton key={d.key} className="h-72 rounded-xl" />)}
                </div>
              ) : (
                <div className="helm-calendar-scroll">
                  <CalendarWeekGrid
                    days={days}
                    eventsByDay={currentGridByDay}
                    variant="current"
                    onMoveEvent={(ev, dayKey, startMinutes) => rescheduleMutation.mutate({ ev, dayKey, startMinutes })}
                    onResizeEvent={(ev, dayKey, durationMinutes) => {
                      const startMin = minutesFromLocalIso(ev.displayStart ?? ev.start) ?? CAL_START_HOUR * 60;
                      rescheduleMutation.mutate({ ev, dayKey, startMinutes: startMin, durationMinutes });
                    }}
                    movingEventId={rescheduleMutation.isPending ? rescheduleMutation.variables?.ev.id ?? null : null}
                    renderEventFooter={(ev) => (
                      <>
                        {ev.attendees.length > 0 && <p className="text-muted-foreground text-[10px]">{ev.attendees.length} attendee{ev.attendees.length === 1 ? '' : 's'}</p>}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDetailsEvent(ev); }}
                            className="text-[10px] font-semibold text-primary hover:underline inline-flex items-center"
                            title="Open details — view, add notes, edit"
                          >
                            Open <Eye className="w-3 h-3 ml-0.5" />
                          </button>
                          {ev.web_link && (
                            <a href={ev.web_link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-sky-600 text-[10px] inline-flex items-center" title="Open in Outlook">
                              Outlook <ExternalLink className="w-3 h-3 ml-0.5" />
                            </a>
                          )}
                        </div>
                      </>
                    )}
                  />
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>




      {/* AI proposed calendar — mirror of week with highlighted moves + checkbox approvals */}
      {autoFocusOn && (
        <Collapsible defaultOpen={true}>
          <Card className="mb-4 overflow-hidden border-primary/40">
            <CollapsibleTrigger asChild>
              <button className="group w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-center gap-3 min-w-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">AI proposed calendar</p>
                    <p className="text-[12px] text-muted-foreground truncate">
                      Mirror of your week with AI's changes — green = moved by AI, amber = awaiting your approval. Check ☑ to confirm and notify attendees.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); planQuery.refetch(); }}
                    disabled={planQuery.isFetching}
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5 mr-1', planQuery.isFetching && 'animate-spin')} />
                    {planQuery.isFetching ? 'Syncing…' : 'Sync'}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {planQuery.isFetching
                      ? 'Analyzing your week…'
                      : `${(planQuery.data?.applied?.length ?? 0)} auto · ${(planQuery.data?.pending_external?.length ?? 0)} need OK`}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {!planQuery.isFetching && (planQuery.data?.applied?.length ?? 0) + (planQuery.data?.pending_external?.length ?? 0) === 0 && (
                <div className="border-t border-border/60 p-3 text-xs text-muted-foreground italic">
                  {strategy === 'reorganize'
                    ? 'No meetings need to move this week — your schedule already has consolidated free time.'
                    : 'No moves proposed — focus blocks fit existing open gaps (see your current calendar above).'}
                </div>
              )}
              <div className="border-t border-border/60 p-3">
                <div className="helm-calendar-scroll">
                  <CalendarWeekGrid
                    days={days}
                    eventsByDay={proposedGridByDay}
                    variant="proposed"
                    focusByDay={focusByDay}
                    focusEnabled={focusEnabled}
                    dismissedFocus={dismissedFocus}
                    appliedFocus={appliedFocus}
                    focusBusyDay={createFocusMutation.isPending ? createFocusMutation.variables?.day_key ?? null : null}
                    onFocusApprove={(focus) => createFocusMutation.mutate({ day_key: focus.day_key, start: focus.start, end: focus.end })}
                    onFocusDismiss={(focus) => setDismissedFocus((s) => ({ ...s, [focus.day_key]: true }))}
                    renderEventFooter={(ev) => {
                      const proposal = ev.proposal;
                      const isPending = ev.kind === 'pending' && !ev.dismissed && !!proposal;
                      const isApproving = approveMutation.isPending && approveMutation.variables?.proposal?.id === proposal?.id;
                      return (
                        <>
                          {proposal && (
                            <p className="text-[10px] text-muted-foreground">
                              was {fmtTimeShort(proposal.old_start)} → <span className="text-foreground font-medium">{fmtTimeShort(proposal.new_start)}</span>
                            </p>
                          )}
                          {isPending && proposal && (
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  disabled={isApproving}
                                  onChange={(e) => {
                                    if (!e.target.checked) return;
                                    approveMutation.mutate({ proposal, note: '' });
                                  }}
                                  className="h-3.5 w-3.5 rounded border-amber-500/60 accent-emerald-600"
                                />
                                <span className="text-[10px] text-foreground">
                                  {isApproving ? 'Sending…' : proposal.is_organizer ? 'Approve' : 'Email organizer'}
                                </span>
                              </label>
                              <button onClick={() => { setDismissed((s) => ({ ...s, [proposal.id]: true })); toast('Kept as-is.'); }} className="text-[10px] text-muted-foreground hover:text-foreground">
                                Disregard
                              </button>
                            </div>
                          )}
                        </>
                      );
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground italic mt-3">
                  Tip: checking a card ☑ sends the update in the background — Outlook invites for meetings you host, or a polite reschedule email to the organizer otherwise.
                </p>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}


      {/* ============== Planning panels ============== */}
      {autoFocusOn && (
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {/* Already done — internal */}
        <Card className="border-secondary/40 bg-secondary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-foreground">
              <CheckCircle2 className="w-4 h-4 text-secondary-foreground" />
              Already done — internal meetings moved for you
            </CardTitle>
          </CardHeader>
          <CardContent>
            {planQuery.isLoading ? (
              <Skeleton className="h-16" />
            ) : (planQuery.data?.applied?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground italic">No automatic moves needed this week.</p>
            ) : (
              <ul className="space-y-2">
                {planQuery.data!.applied.map((p) => (
                  <li key={p.id} className="text-xs border border-secondary/30 rounded-md p-2 bg-background/50">
                    <p className="font-semibold text-foreground">{p.subject}</p>
                    <p className="text-muted-foreground">
                      {fmtTimeShort(p.old_start)} → <span className="text-foreground font-medium">{fmtTimeShort(p.new_start)}</span>
                    </p>
                    {p.note && (
                      <Collapsible>
                        <CollapsibleTrigger className="text-[11px] text-primary hover:underline mt-1 inline-flex items-center gap-1">
                          View note sent <ChevronDown className="w-3 h-3" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="mt-1 p-2 rounded bg-muted/50 text-[11px] whitespace-pre-wrap text-foreground">{p.note}</p>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Needs your OK — external */}
        <Card className="border-accent/50 bg-accent/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-foreground">
              <AlertTriangle className="w-4 h-4 text-accent-foreground" />
              Needs your OK — external meetings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {planQuery.isLoading ? (
              <Skeleton className="h-16" />
            ) : (planQuery.data?.pending_external?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nothing waiting on you. ✨</p>
            ) : (
              <ul className="space-y-2">
                {planQuery.data!.pending_external.filter((p) => !dismissed[p.id]).map((p) => {
                  const d = draftByProp[p.id];
                  const revealed = !!d?.revealed;
                  return (
                    <li key={p.id} className="text-xs border border-accent/40 rounded-md p-2 bg-background/50 space-y-1">
                      <p className="font-semibold text-foreground">{p.subject}</p>
                      <div className="grid grid-cols-2 gap-2 my-1">
                        <div className="rounded-md border border-border bg-muted/30 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Current</p>
                          <p className="text-foreground font-medium">{fmtTimeShort(p.old_start)}</p>
                        </div>
                        <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-primary mb-0.5">AI proposed</p>
                          <p className="text-foreground font-medium">{fmtTimeShort(p.new_start)}</p>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground italic">{p.reason}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {p.is_organizer ? 'You host this meeting.' : `Hosted by ${p.organizer.name || p.organizer.email}.`}
                      </p>
                      {!revealed ? (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="default" onClick={() => revealApproval(p)}>
                            <ThumbsUp className="w-3 h-3 mr-1" />
                            {p.is_organizer ? 'Approve move' : 'Propose new time'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setDismissed((s) => ({ ...s, [p.id]: true }));
                              toast('Kept as-is.');
                            }}
                          >
                            <X className="w-3 h-3 mr-1" />Keep it
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2 pt-1">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Note to {p.is_organizer ? 'attendees' : 'organizer'} — edit before sending
                          </p>
                          {d?.loading ? (
                            <Skeleton className="h-20 w-full" />
                          ) : (
                            <textarea
                              className="w-full text-xs bg-background border border-border rounded-md p-2 min-h-[96px]"
                              value={d?.note ?? ''}
                              onChange={(e) =>
                                setDraftByProp((s) => ({
                                  ...s,
                                  [p.id]: { note: e.target.value, loading: false, revealed: true },
                                }))
                              }
                            />
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              disabled={approveMutation.isPending || d?.loading || !(d?.note ?? '').trim()}
                              onClick={() => approveMutation.mutate({ proposal: p, note: d?.note ?? '' })}
                            >
                              <ThumbsUp className="w-3 h-3 mr-1" />Send note
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDraftByProp((s) => ({ ...s, [p.id]: { ...(s[p.id] ?? { note: '', loading: false }), revealed: false } }))
                              }
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      )}
      <EventDetailsDialog event={detailsEvent} onClose={() => setDetailsEvent(null)} />
    </div>
  );
}

function EventDetailsDialog({ event, onClose }: { event: CalendarGridEvent | null; onClose: () => void }) {
  const noteKey = event ? `helm:event-note:${event.id}` : '';
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!event) return;
    try { setNote(window.localStorage.getItem(`helm:event-note:${event.id}`) || ''); } catch { setNote(''); }
  }, [event?.id]);
  const saveNote = () => {
    if (!event) return;
    try { window.localStorage.setItem(noteKey, note); toast.success('Note saved'); } catch { toast.error('Could not save note'); }
  };
  if (!event) return null;
  const startIso = event.displayStart ?? event.start;
  const endIso = event.displayEnd ?? event.end;
  const startLbl = startIso ? new Date(startIso).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const endLbl = endIso ? new Date(endIso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <Dialog open={!!event} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-8">{event.subject || '(no subject)'}</DialogTitle>
          <DialogDescription>{startLbl}{endLbl ? ` – ${endLbl}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {event.location && (
            <div><span className="font-semibold text-foreground">Location:</span> <span className="text-muted-foreground">{event.location}</span></div>
          )}
          {event.attendees?.length > 0 && (
            <div>
              <span className="font-semibold text-foreground">Attendees ({event.attendees.length}):</span>
              <ul className="mt-1 text-muted-foreground text-[13px] max-h-32 overflow-auto space-y-0.5">
                {event.attendees.slice(0, 20).map((a: any, i: number) => (
                  <li key={i} className="truncate">{a?.emailAddress?.name || a?.name || a?.emailAddress?.address || a?.address || String(a)}</li>
                ))}
              </ul>
            </div>
          )}
          {event.is_cancelled && (
            <div className="text-xs font-semibold text-rose-600">This meeting was cancelled.</div>
          )}
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <FileEdit className="w-3.5 h-3.5" /> Your notes
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add prep notes, questions, follow-ups… (saved locally)"
              className="mt-1 min-h-[100px] text-sm"
            />
          </div>
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          {event.web_link && (
            <Button variant="outline" size="sm" asChild>
              <a href={event.web_link} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Edit in Outlook
              </a>
            </Button>
          )}
          <Button size="sm" onClick={saveNote}>Save note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/* ------------------------------------------------------------------ */
/* Page shell                                                         */
/* ------------------------------------------------------------------ */

export default function TheHelm() {
  const [view, setView] = useState<View>('brief');
  const [activeItem, setActiveItem] = useState<HelmItem | null>(null);
  const [inboxScope, setInboxScope] = useState<InboxScope>('drafts');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();

  const scrollTop = () => {
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch { window.scrollTo(0, 0); }
  };
  const go = (v: View, item?: HelmItem, scope?: InboxScope) => {
    if (item) setActiveItem(item);
    if (v === 'inbox') setInboxScope(scope ?? 'drafts');
    setView(v);
    scrollTop();
  };
  const back = () => { setView('brief'); scrollTop(); };

  const toggleDone = async (id: string, next: boolean) => {
    setDone((d) => ({ ...d, [id]: next }));
    if (!next) return;
    try {
      await supabase.from('helm_items').update({ status: 'resolved' }).eq('id', id);
      // Drop from today's pinned Big 3 — never refill on next render.
      try {
        const today = new Date().toISOString().slice(0, 10);
        const KEY = `helm:big3-pinned:${today}`;
        const raw = window.localStorage.getItem(KEY);
        if (raw) {
          const ids: string[] = JSON.parse(raw);
          window.localStorage.setItem(KEY, JSON.stringify(ids.filter((x) => x !== id)));
        }
      } catch { /* ignore */ }

      const u = (await supabase.auth.getUser()).data.user;
      if (u) {
        await supabase.from('activity_log').insert({
          user_id: u.id,
          action_type: 'item_completed',
          detail: `Completed Big 3 item`,
          action_key: `big3_done:${id}:${Date.now()}`,
        } as any);
      }
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      toast.success('Marked done');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not mark done');
    }
  };

  // Ensure Graph subscriptions exist on first mount (idempotent)
  useEffect(() => {
    supabase.functions
      .invoke('helm-subscribe', { body: { mode: 'create' } })
      .catch(() => { /* swallow — surfaced later via Sync errors */ });
  }, []);

  return (
    <>
      <style>{`
        @media print {
          /* Always hide chrome that shouldn't appear on print */
          [data-sonner-toaster], [data-sidebar], nav[role="navigation"],
          .print\\:hidden { display: none !important; }
          /* Section-scoped printing */
          body[data-print-section] aside,
          body[data-print-section] nav,
          body[data-print-section] header,
          body[data-print-section] [data-helm-section]:not([data-print-target]) {
            display: none !important;
          }
          body[data-print-section] [data-helm-section][data-print-target] {
            break-inside: avoid;
          }
          /* Force a clean light look on paper */
          html, body { background: #ffffff !important; color: #000 !important; }
        }
      `}</style>
      <div className="container mx-auto px-4 py-6 max-w-[1600px] w-[95vw] max-w-full">
        {view === 'brief' && <BriefView go={go} done={done} toggleDone={toggleDone} />}
        {view === 'inbox' && <InboxView onBack={back} scope={inboxScope} />}
        {view === 'detail' && <DetailView item={activeItem} onBack={back} />}
        {view === 'calendar' && <CalendarView onBack={back} />}
      </div>
    </>
  );
}

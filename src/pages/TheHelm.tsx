import { useEffect, useMemo, useState } from 'react';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
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
  CalendarClock,
  ArrowUpRight,
  Flame,
  Eye,
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
            'id,title,context,sender_name,sender_email,due_at,tier,score,graph_id,conversation_id,created_at,status',
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
          text: a.detail ?? 'Filed',
          time: new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          tag,
        };
      });

      const totalInbound = rows.length + autoActions.length;
      const needsYouIds = new Set([...big3, ...decisions, ...overdue].map((item) => item.id));
      const needsYou = needsYouIds.size;

      return {
        big3,
        decisions,
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
  return (
    <div data-helm-section={accent === 'amber' ? 'big3' : 'decisions'}>
      {/* Header — unified styling with "03 Operations ledger" */}
      <div className="flex items-end gap-4 mb-4">
        <span className={cn('font-mono text-[32px] md:text-[40px] font-bold leading-none tabular-nums select-none', numberColor)}>
          {number}
        </span>
        <div className="pb-2 flex-1 min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-1">Act now</p>
          <h2 className="text-[20px] font-semibold tracking-tight text-foreground flex items-center gap-3">
            {label}
            <Badge variant="secondary" className="font-mono tabular-nums text-[11px]">{count}</Badge>
          </h2>
        </div>
        <button onClick={openReader} className="hidden md:inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-primary pb-2">
          Open focused reader <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="relative rounded-xl border border-border/60 bg-card overflow-hidden">
        {items.length === 0 ? (
          <div className="p-8 text-center">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3', iconBg)}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-[13px] italic text-muted-foreground">{emptyText}</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border/40">
              {visible.map((it, i) => {
                const isOpen = expandedId === it.id;
                return (
                  <li key={it.id}>
                    <button
                      onClick={() => setExpandedId(isOpen ? null : it.id)}
                      className={cn(
                        'w-full text-left p-4 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isOpen && 'bg-muted/40',
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
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full text-left rounded-lg border bg-card p-4 transition-all hover:border-primary/50 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        variant === 'warning' ? 'border-destructive/30 bg-destructive/5' : 'border-border/60',
        expanded && 'border-primary/50 shadow-sm',
      )}
    >
      <div className="flex items-start gap-3">
        {variant === 'warning' && <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          {/* Line 1: subject */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-semibold text-foreground truncate flex-1">{item.title}</h3>
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
                <span className={variant === 'warning' ? 'text-destructive font-semibold' : ''}>{item.due}</span>
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
  const decisions = data?.decisions ?? [];
  const overdue = data?.overdue ?? [];
  const fyi = data?.fyi ?? [];
  const autoActions = data?.autoActions ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedItem =
    big3.find((x) => x.id === expandedId) ||
    decisions.find((x) => x.id === expandedId) ||
    overdue.find((x) => x.id === expandedId) ||
    fyi.find((x) => x.id === expandedId) ||
    null;

  // Live week preview for the right rail
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
      const events = ((data as any)?.events ?? []) as Array<{ start: string | null; subject: string }>;
      const byDay: Record<string, number> = {};
      for (const ev of events) {
        if (!ev.start) continue;
        const k = new Date(ev.start).toDateString();
        byDay[k] = (byDay[k] ?? 0) + 1;
      }
      const out: { day: string; date: Date; count: number; isToday: boolean }[] = [];
      const todayKey = new Date().toDateString();
      for (let i = 0; i < 5; i++) {
        const d = new Date(ws);
        d.setDate(ws.getDate() + i);
        out.push({
          day: d.toLocaleDateString(undefined, { weekday: 'short' }),
          date: d,
          count: byDay[d.toDateString()] ?? 0,
          isToday: d.toDateString() === todayKey,
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 lg:gap-10">
      <div className="space-y-12">
        {error && (
          <Card className="border-destructive/40 print:hidden">
            <CardContent className="p-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-destructive">Couldn't load your brief: {(error as Error).message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </CardContent>
          </Card>
        )}
        {/* Hero — borderless, demo-v4 style */}
        <section aria-labelledby="helm-hero" className="pt-2">
          <div className="flex items-center justify-between gap-4 mb-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
              {today} · {nowTime} brief
            </p>
            <div className="flex items-center gap-2 print:hidden">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] font-mono tracking-[0.15em] uppercase"
                onClick={() => {
                  document.body.removeAttribute('data-print-section');
                  window.print();
                }}
                title="Print today's full brief — meetings, Big 3, decisions, drafts, overdue, FYI."
              >
                <Printer className="w-3 h-3 mr-1.5" /> Print today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] font-mono tracking-[0.15em] uppercase"
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke('helm-email-section', {
                      body: { section: 'brief', title: "Today's full brief" },
                    });
                    if (error) throw error;
                    toast.success(`Emailed to ${(data as any)?.recipient ?? 'your inbox'}.`);
                  } catch (e: any) {
                    toast.error(e?.message ?? 'Email failed.');
                  }
                }}
              >
                <Send className="w-3 h-3 mr-1.5" /> Email today
              </Button>
              <span
                className={cn(
                  'inline-flex items-center gap-2 text-[10px] font-mono tracking-[0.15em] uppercase px-2.5 py-1 rounded-full border',
                  (sync.isPending || isLoading)
                    ? 'border-primary/40 text-primary bg-primary/5'
                    : 'border-border/60 text-muted-foreground bg-transparent',
                )}
                title={sync.isPending ? 'Pulling the latest from your inbox…' : 'Auto-syncs every 5 minutes'}
              >
                <RefreshCw className={cn('w-3 h-3', (sync.isPending || isLoading) && 'animate-spin')} />
                {(sync.isPending || isLoading) ? 'Syncing' : 'Live · auto-sync'}
              </span>
            </div>
          </div>

          <h1
            id="helm-hero"
            className="text-[26px] md:text-[32px] leading-tight tracking-tight font-semibold text-foreground"
          >
            {greeting}
            {name ? `, ${name}` : ''}.{' '}
            <span className="text-primary">
              {stats.needsYou === 0 ? 'You are clear.' : `${stats.needsYou} thing${stats.needsYou === 1 ? '' : 's'} need you today.`}
            </span>
          </h1>
          <p className="text-[13px] md:text-sm text-muted-foreground max-w-2xl mt-2 leading-relaxed">
            Everything else has been triaged, drafted, or scheduled. Clear your queue in under ten minutes, then the day is yours.
          </p>

          {/* Hero KPI tiles — bordered, accent-edged, always visible on dark mode */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="helm-tile" data-accent="slate">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-bold">Total inbound</p>
              <p className="text-[40px] md:text-[44px] font-extrabold text-foreground tabular-nums leading-none mt-1">{stats.totalInbound}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">emails & items received in the last 24h</p>
            </div>
            <div className="helm-tile" data-accent="amber">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-bold">Needs you</p>
              <p className="text-[40px] md:text-[44px] font-extrabold text-primary tabular-nums leading-none mt-1">{stats.needsYou}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">decisions, approvals & overdue replies</p>
            </div>
            <div className="helm-tile" data-accent="emerald">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-bold">Handled for you</p>
              <p className="text-[40px] md:text-[44px] font-extrabold text-foreground tabular-nums leading-none mt-1">{Math.max(0, stats.totalInbound - stats.needsYou)}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">filed, drafted or auto-replied overnight</p>
            </div>
          </div>

          {/* Executive breakdown — click to open that scope's focused reader */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {([
              { key: 'big3', label: 'Big 3', count: big3.length, accent: 'sky',     onClick: () => go('inbox', undefined, 'big3') },
              { key: 'decisions', label: 'Decisions', count: decisions.length, accent: 'violet', onClick: () => go('inbox', undefined, 'decisions') },
              { key: 'overdue', label: 'Overdue', count: overdue.length, accent: 'red', onClick: () => document.querySelector('[data-helm-section="overdue"]')?.scrollIntoView({ behavior: 'smooth' }) },
              { key: 'drafted', label: 'AI-drafted', count: (data?.drafts?.length ?? 0), accent: 'cyan', onClick: () => go('inbox', undefined, 'drafts') },
              { key: 'auto', label: 'Auto-handled', count: autoActions.length, accent: 'emerald', onClick: () => document.getElementById('auto')?.scrollIntoView({ behavior: 'smooth' }) },
              { key: 'fyi', label: 'FYI', count: fyi.length, accent: 'muted', onClick: () => document.querySelector('[data-helm-section="fyi"]')?.scrollIntoView({ behavior: 'smooth' }) },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={t.onClick}
                className="helm-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-accent={t.accent}
                style={{ padding: '0.65rem 0.85rem' }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold">{t.label}</p>
                <p className="text-[26px] font-extrabold text-foreground tabular-nums leading-none mt-1">{t.count}</p>
              </button>
            ))}
          </div>
        </section>



        {/* ════════════════════════════════════════════════════════════════
            COMMAND DECK — redesigned executive workspace
            Pillars (Big 3 + Decisions) → Ledger (Overdue / FYI / Done) → Footer
            ════════════════════════════════════════════════════════════════ */}

        {/* ── 01 · Action Pillars — stacked vertically, inline-expand ── */}
        <section aria-labelledby="pillars" data-helm-section="pillars" className="space-y-8">
          <PillarBlock
            number="01"
            accentClass="from-amber-400 via-orange-500 to-rose-500"
            iconBg="bg-amber-500/10 text-amber-500"
            numberColor="text-amber-500/90"
            Icon={Flame}
            label="Pillar A · Today's Big 3"
            count={big3.length}
            items={big3}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            emptyText="Nothing urgent. Your day is yours."
            openReader={() => go('inbox', undefined, 'big3')}
            accent="amber"
          />
          <PillarBlock
            number="02"
            accentClass="from-violet-400 via-indigo-500 to-blue-500"
            iconBg="bg-violet-500/10 text-violet-500"
            numberColor="text-violet-500/90"
            Icon={ThumbsUp}
            label="Pillar B · Your decisions"
            count={decisions.length}
            items={decisions}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            emptyText="No approvals waiting on you."
            openReader={() => go('inbox', undefined, 'decisions')}
            accent="violet"
          />
        </section>


        {/* ── 03 · Operations Ledger — Overdue / FYI / Auto-handled ─── */}
        <section aria-labelledby="ledger" data-helm-section="ledger">
          <div className="flex items-end gap-4 mb-4">
            <span className="font-mono text-[32px] md:text-[40px] font-bold leading-none tabular-nums text-emerald-500/90 select-none">03</span>
            <div className="pb-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-1">Sweep</p>
              <h2 id="ledger" className="text-[20px] font-semibold tracking-tight text-foreground">Operations ledger</h2>
            </div>
          </div>

          <Card className="border-border/60 overflow-hidden">
            <Tabs defaultValue={overdue.length > 0 ? 'overdue' : 'auto'} className="w-full">
              <TabsList className="w-full justify-start h-auto p-0 bg-muted/30 border-b border-border/60 rounded-none">
                <TabsTrigger value="overdue" data-helm-section="overdue"
                  className="data-[state=active]:bg-card data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-rose-500 rounded-none px-5 py-3 gap-2 text-[12px] font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  Overdue
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] tabular-nums">{overdue.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="fyi" data-helm-section="fyi"
                  className="data-[state=active]:bg-card data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-sky-500 rounded-none px-5 py-3 gap-2 text-[12px] font-medium">
                  <Eye className="w-3.5 h-3.5 text-sky-500" />
                  FYI
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] tabular-nums">{fyi.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="auto" data-helm-section="activity"
                  className="data-[state=active]:bg-card data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 rounded-none px-5 py-3 gap-2 text-[12px] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Handled by AI
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] tabular-nums">{autoActions.length}</Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overdue" className="m-0 p-5">
                <p className="text-[12px] text-muted-foreground mb-3">Threads where you owe a reply and the clock has run out.</p>
                {isLoading ? (
                  <Skeleton className="h-20" />
                ) : overdue.length === 0 ? (
                  <div className="py-10 text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-[13px] text-muted-foreground">You're caught up on overdue threads.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {overdue.map((item) => (
                      <div key={item.id}>
                        <LedgerRow item={item} variant="warning" expanded={expandedId === item.id} onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)} />
                        {expandedId === item.id && expandedItem && (
                          <div className="mt-2"><InlineEmailExpander item={expandedItem} onClose={() => setExpandedId(null)} accent="rose" showAiSummary={false} /></div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="fyi" className="m-0 p-5">
                <p className="text-[12px] text-muted-foreground mb-3">Newsletters, marketing, automated notices and external announcements — skim only if you want to.</p>
                {fyi.length === 0 ? (
                  <div className="py-10 text-center">
                    <Info className="w-8 h-8 text-muted-foreground/60 mx-auto mb-2" />
                    <p className="text-[13px] text-muted-foreground">Nothing informational waiting.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {fyi.slice(0, 25).map((item) => (
                      <div key={item.id}>
                        <LedgerRow item={item} expanded={expandedId === item.id} onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)} />
                        {expandedId === item.id && expandedItem && (
                          <div className="mt-2"><InlineEmailExpander item={expandedItem} onClose={() => setExpandedId(null)} accent="sky" /></div>
                        )}
                      </div>
                    ))}
                    {fyi.length > 25 && (
                      <p className="text-[11px] text-muted-foreground text-center italic pt-2">+ {fyi.length - 25} more filed in your inbox.</p>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="auto" className="m-0 p-5">
                <p className="text-[12px] text-muted-foreground mb-3">Emails, meetings and tasks the agent filed, drafted, booked or replied to in the last 24 hours.</p>
                {autoActions.length === 0 ? (
                  <div className="py-10 text-center">
                    <Activity className="w-8 h-8 text-muted-foreground/60 mx-auto mb-2" />
                    <p className="text-[13px] text-muted-foreground">Nothing auto-filed yet. Run a sync to see the agent work.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border/40">
                    {autoActions.map((a) => (
                      <li key={a.id} className="flex items-start gap-3 py-2.5 text-[13px]">
                        <Activity className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />
                        <span className="flex-1 text-foreground/90 leading-snug">{a.text}</span>
                        <Badge variant="outline" className={cn('text-[10px] font-mono uppercase tracking-wider shrink-0',
                          a.tag === 'Sent' && 'border-primary/40 text-primary bg-primary/5',
                          a.tag === 'Filed' && 'border-success/40 text-success bg-success/5',
                          a.tag === 'Routed' && 'border-accent/40 text-accent-foreground bg-accent/10',
                          a.tag === 'Booked' && 'border-warning/40 text-warning bg-warning/5')}>
                          {a.tag}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0 mt-0.5">{a.time}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </section>



        {/* ── Briefing Controls — slim footer chip ─────────────────────── */}
        <section aria-labelledby="schedule" data-helm-section="schedule" className="print:hidden">
          <Popover>
            <PopoverTrigger asChild>
              <button className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-dashed border-border/60 hover:border-primary/50 hover:bg-muted/30 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CalendarClock className="w-4 h-4 text-primary shrink-0" />
                  <span id="schedule" className="text-[13px] font-medium text-foreground">
                    Home email schedule
                  </span>
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">
                    · pick days &amp; times this brief lands in your inbox
                  </span>
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


      {/* Right rail */}
      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => go('calendar')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              go('calendar');
            }
          }}
          className="cursor-pointer transition-all hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring border-border/60"
        >
          <CardHeader className="pb-3 flex flex-row items-baseline justify-between space-y-0">
            <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
              <Calendar className="w-4 h-4 text-primary" /> This week
            </CardTitle>
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted-foreground">open →</span>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-[11px] text-muted-foreground mb-3">Tap to see the full week + AI time analysis</p>
            <ul className="space-y-0">
              {(weekPreview.data ?? []).map((d) => (
                <li
                  key={d.day}
                  className={cn(
                    'flex items-center gap-3 text-[13px] py-2 border-b border-border/40 last:border-0',
                    d.isToday && 'bg-primary/5 -mx-2 px-2 rounded',
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
                </li>
              ))}
              {weekPreview.isLoading && (
                <li className="text-[12px] text-muted-foreground italic py-2">Loading your week…</li>
              )}
              {!weekPreview.isLoading && (weekPreview.data?.length ?? 0) === 0 && (
                <li className="text-[12px] text-muted-foreground italic py-2">No calendar connected.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
              <Sparkles className="w-4 h-4 text-primary" /> Inbox health
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">Inbound</dt>
                <dd className="text-3xl font-light text-foreground tabular-nums">
                  {stats.totalInbound}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">Needs you</dt>
                <dd className="text-3xl font-light text-primary tabular-nums">
                  {stats.needsYou}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">Drafted</dt>
                <dd className="text-3xl font-light text-foreground tabular-nums">
                  {stats.drafted}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">Auto</dt>
                <dd className="text-3xl font-light text-foreground tabular-nums">
                  {stats.autoHandled}
                </dd>

              </div>
            </dl>
          </CardContent>
        </Card>
      </aside>
    </div>
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
    scope === 'big3' ? "Today's Big 3" :
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

function fmtTimeShort(iso: string | null) {
  if (!iso) return '';
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const h = Number(m[1]); const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
}

function CalendarView({ onBack }: { onBack: () => void }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [rule, setRule] = useState<FocusRule>(DEFAULT_RULE);
  const [ruleLoaded, setRuleLoaded] = useState(false);
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
    enabled: ruleLoaded,
    queryKey: ['helm-plan', weekStart.toISOString(), JSON.stringify(debouncedRule)],
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
        body: { mode: 'analyze', week_start: weekStart.toISOString() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as PlanResult;
    },
  });

  // Per-proposal editable note state + dismissed list
  const [draftByProp, setDraftByProp] = useState<Record<string, { note: string; loading: boolean; revealed: boolean }>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

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

  const grouped = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const d of days) map[d.date.toDateString()] = [];
    for (const ev of data?.events ?? []) {
      if (!ev.start) continue;
      const key = new Date(ev.start).toDateString();
      if (map[key]) map[key].push(ev);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime());
    }
    return map;
  }, [data, days]);

  const focusByDay = useMemo(() => {
    const map: Record<string, FocusBlock> = {};
    for (const b of planQuery.data?.focus_blocks ?? []) map[b.day_key] = b;
    return map;
  }, [planQuery.data]);

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
      <BackBar onBack={onBack} label="This week" />

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
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 overflow-x-auto">
                {days.map((d) => {
                  const evs = grouped[d.date.toDateString()] ?? [];
                  const isToday = d.date.toDateString() === new Date().toDateString();
                  const focus = focusByDay[d.key];
                  return (
                    <Card key={d.date.toISOString()} className={cn('min-w-[200px]', isToday && 'border-primary/60 shadow-sm')}>
                      <CardHeader className="pb-2">
                        <div className="flex items-baseline justify-between">
                          <CardTitle className="text-sm uppercase text-muted-foreground tracking-wide">{d.weekday}</CardTitle>
                          <span className={cn('text-xs font-medium', isToday ? 'text-primary' : 'text-muted-foreground')}>
                            {d.label}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {focus && (
                          <div
                            className={cn(
                              'rounded-md border-2 border-dashed p-2 text-xs',
                              focus.state === 'free' && 'border-secondary bg-secondary/10',
                              focus.state === 'needs_move' && 'border-accent bg-accent/10',
                              focus.state === 'blocked' && 'border-destructive/50 bg-destructive/5',
                            )}
                          >
                            <div className="flex items-center gap-1 font-semibold text-foreground">
                              <Zap className="w-3 h-3" /> Focus block (proposed)
                            </div>
                            <p className="text-foreground">{fmtTimeShort(focus.start)} – {fmtTimeShort(focus.end)}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">{focus.state.replace('_', ' ')}</p>
                          </div>
                        )}
                        {isLoading && (<><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></>)}
                        {!isLoading && evs.length === 0 && !focus && (
                          <p className="text-xs text-muted-foreground italic py-4 text-center">No meetings</p>
                        )}
                        {evs.map((ev) => (
                          <div
                            key={ev.id}
                            className={cn(
                              'rounded-md border p-2 text-xs space-y-1 transition-colors',
                              ev.is_cancelled && 'opacity-60 line-through',
                              ev.is_external ? 'border-accent bg-accent/10' : 'border-border bg-card',
                            )}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium text-foreground">{fmtTime(ev.start)}</span>
                              <div className="flex gap-1 flex-wrap justify-end">
                                {ev.is_external && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-accent text-foreground bg-accent/20">External</Badge>
                                )}
                                <Badge variant="outline" className="text-[10px] px-1 py-0">{ev.is_organizer ? 'Host' : 'Guest'}</Badge>
                              </div>
                            </div>
                            <p className="font-semibold text-foreground leading-snug line-clamp-2" title={ev.subject}>{ev.subject}</p>
                            {ev.location && <p className="text-muted-foreground text-[11px] line-clamp-1">📍 {ev.location}</p>}
                            {ev.attendees.length > 0 && (
                              <p className="text-muted-foreground text-[11px]">{ev.attendees.length} attendee{ev.attendees.length === 1 ? '' : 's'}</p>
                            )}
                            {ev.web_link && (
                              <a href={ev.web_link} target="_blank" rel="noreferrer" className="text-primary hover:underline text-[11px] inline-flex items-center">
                                Open <ArrowRight className="w-3 h-3 ml-0.5" />
                              </a>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* AI intelligence preview — compact, collapsed by default */}
      <Collapsible defaultOpen={false}>
        <Card className="overflow-hidden border-primary/30">
          <CollapsibleTrigger asChild>
            <button className="group w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-[12px] font-medium text-foreground truncate">AI intelligence · proposed calendar changes</p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform shrink-0" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border/60 p-3 space-y-3">
              <FocusRulesCard rule={rule} saving={planQuery.isFetching} onChange={setRule} />
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>


      {/* ============== Planning panels ============== */}
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
    </div>
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
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {view === 'brief' && <BriefView go={go} done={done} toggleDone={toggleDone} />}
        {view === 'inbox' && <InboxView onBack={back} scope={inboxScope} />}
        {view === 'detail' && <DetailView item={activeItem} onBack={back} />}
        {view === 'calendar' && <CalendarView onBack={back} />}
      </div>
    </>
  );
}

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
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/* Types & data hooks                                                 */
/* ------------------------------------------------------------------ */

type View = 'brief' | 'inbox' | 'detail' | 'calendar';

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
          ])
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(80),
      ]);

      const rows = (itemsRes.data ?? []).map(mapRow);
      const decisions = rows.filter((r) => r.tier === 'decision');
      const drafts = rows.filter((r) => r.tier === 'draft');
      const overdue = rows.filter((r) => r.tier === 'overdue');
      const big3 = decisions.slice(0, 3);
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
      const needsYou = big3.length + decisions.length + overdue.length;

      return {
        big3,
        decisions: decisions.slice(big3.length),
        drafts,
        overdue,
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

const WEEK_PREVIEW = [
  { day: 'Mon', summary: '5 meetings · 2 focus blocks' },
  { day: 'Tue', summary: '3 meetings · board prep' },
  { day: 'Wed', summary: '7 meetings · all-hands' },
  { day: 'Thu', summary: '4 meetings · investor dinner' },
  { day: 'Fri', summary: '2 meetings · open afternoon' },
];

/* ------------------------------------------------------------------ */
/* Building blocks                                                    */
/* ------------------------------------------------------------------ */

function SectionHeader({
  title,
  subtitle,
  sectionKey,
  emailSection,
  index,
  onPrint,
  onEmail,
}: {
  title: string;
  subtitle?: string;
  sectionKey?: string;
  emailSection?: 'brief' | 'inbox' | 'calendar' | 'big3' | 'activity';
  index?: number;
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
            <h2 className="text-lg font-semibold tracking-tight text-foreground leading-tight">{title}</h2>
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
        'group relative cursor-pointer overflow-hidden transition-all rounded-lg border-border/60',
        'before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:bg-primary',
        'before:scale-y-0 before:origin-top hover:before:scale-y-100 before:transition-transform before:duration-300',
        'hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        variant === 'warning' && 'border-destructive/40 bg-destructive/5',
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

/* ------------------------------------------------------------------ */
/* Views                                                              */
/* ------------------------------------------------------------------ */

function BriefView({
  go,
  done,
  toggleDone,
}: {
  go: (v: View, item?: HelmItem) => void;
  done: Record<string, boolean>;
  toggleDone: (id: string, next: boolean) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useHelmData();
  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Good morning';
    if (hr < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);
  const name =
    (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    '';

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
  const autoActions = data?.autoActions ?? [];

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
        {/* Hero — borderless, demo-v4 style */}
        <section aria-labelledby="helm-hero" className="pt-2">
          <div className="flex items-center justify-between gap-4 mb-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
              {today} · {nowTime} brief
            </p>
            <span
              className={cn(
                'inline-flex items-center gap-2 text-[10px] font-mono tracking-[0.15em] uppercase px-2.5 py-1 rounded-full border print:hidden',
                (sync.isPending || isLoading)
                  ? 'border-primary/40 text-primary bg-primary/5'
                  : 'border-border/60 text-muted-foreground bg-transparent',
              )}
              title={sync.isPending ? 'Pulling the latest from your inbox…' : 'Auto-syncs every 5 minutes'}
            >
              <RefreshCw
                className={cn('w-3 h-3', (sync.isPending || isLoading) && 'animate-spin')}
              />
              {(sync.isPending || isLoading) ? 'Syncing' : 'Live · auto-sync'}
            </span>
          </div>

          <h1
            id="helm-hero"
            className="text-[44px] md:text-[56px] leading-[1.05] tracking-tight font-semibold text-foreground"
          >
            {greeting}
            {name ? `, ${name}` : ''}.{' '}
            <span className="text-primary">
              {stats.needsYou === 0 ? 'You are clear.' : `${stats.needsYou} thing${stats.needsYou === 1 ? '' : 's'} need you today.`}
            </span>
          </h1>
          <p className="text-[15px] md:text-base text-muted-foreground max-w-2xl mt-4 leading-relaxed">
            Everything else has been triaged, drafted, or scheduled. Clear your queue in under ten minutes, then the day is yours.
          </p>

          <div className="mt-10 flex items-baseline gap-5 flex-wrap">
            <span className="text-[72px] md:text-[96px] leading-none font-light text-muted-foreground/40 tabular-nums">
              {stats.totalInbound}
            </span>
            <ArrowRight className="w-7 h-7 text-muted-foreground/60" />
            <span className="text-[72px] md:text-[96px] leading-none font-light text-primary tabular-nums">
              {stats.needsYou}
            </span>
            <div className="ml-2 pb-2">
              <p className="text-[15px] text-foreground">items came in overnight</p>
              <p className="text-[13px] text-muted-foreground mt-1">
                surfaced to you · the rest handled or held
              </p>
            </div>
          </div>
        </section>


        {/* Big 3 */}
        <section aria-labelledby="big3" data-helm-section="big3">
          <SectionHeader index={0} title="Today's Big 3" subtitle="If you do nothing else, do these." sectionKey="big3" emailSection="big3" />
          <div className="grid gap-3">
            {isLoading ? (
              <Skeleton className="h-24" />
            ) : big3.length === 0 ? (
              <EmptyHint>
                No must-do items right now. Hit <strong>Sync inbox</strong> to pull the
                latest, or enjoy the calm.
              </EmptyHint>
            ) : (
              big3.map((item, i) => (
                <div key={item.id} className="space-y-2">
                  <HelmCard
                    item={item}
                    index={i + 1}
                    onOpen={() => go('detail', item)}
                    showCheckbox
                    done={done[item.id]}
                    onToggleDone={(n) => toggleDone(item.id, n)}
                  />

                  <div className="flex gap-2 print:hidden pl-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const { data, error } = await supabase.functions.invoke('helm-big3', {
                            body: { action: 'block_focus', item_id: item.id, title: item.title },
                          });
                          if (error) throw error;
                          toast.success(data?.web_link ? 'Focus block created in Outlook' : 'Focus block created');
                        } catch (e: any) {
                          toast.error(e?.message ?? 'Could not block focus time');
                        }
                      }}
                    >
                      <Clock className="w-3 h-3 mr-1" /> Block focus time
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>


        {/* Decisions */}
        <section aria-labelledby="decisions" data-helm-section="decisions">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <SectionHeader
                index={1}
                title="Your decisions"
                subtitle="Only you can decide or approve these."
                sectionKey="decisions"
                emailSection="brief"
              />
            </div>
            {decisions.length > 0 && (
              <Badge variant="secondary" className="font-mono tabular-nums">
                {decisions.length}
              </Badge>
            )}
          </div>
          <div className="grid gap-3">
            {isLoading ? (
              <Skeleton className="h-20" />
            ) : decisions.length === 0 ? (
              <EmptyHint>No open decisions waiting on you.</EmptyHint>
            ) : (
              decisions.map((item) => (
                <HelmCard key={item.id} item={item} onOpen={() => go('detail', item)} />
              ))
            )}
          </div>
        </section>


        {/* Drafted for you */}
        <section aria-labelledby="drafted" data-helm-section="drafted">
          <SectionHeader
            index={2}
            title="Drafted for you"
            subtitle="Replies ready for a quick read and send."
            sectionKey="drafted"
            emailSection="inbox"
          />
          <Card
            role="button"
            tabIndex={0}
            onClick={() => go('inbox')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                go('inbox');
              }
            }}
            className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CardContent className="p-6 flex items-center gap-5">
              <div className="w-14 h-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <FileEdit className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-3">
                  <span className="text-h2 font-bold text-foreground tabular-nums">
                    {stats.drafted}
                  </span>
                  <span className="text-body-1 text-foreground">
                    draft{stats.drafted === 1 ? '' : 's'} ready
                  </span>
                </div>
                <p className="text-body-2 text-muted-foreground mt-1">
                  Open the focused inbox to skim, edit, and send.
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </section>

        {/* Overdue */}
        <section aria-labelledby="overdue" data-helm-section="overdue">
          <SectionHeader
            index={3}
            title="Overdue — waiting on your reply"
            subtitle="These threads have been sitting too long."
            sectionKey="overdue"
            emailSection="brief"
          />
          <div className="grid gap-3">
            {isLoading ? (
              <Skeleton className="h-20" />
            ) : overdue.length === 0 ? (
              <EmptyHint>You're caught up on overdue threads.</EmptyHint>
            ) : (
              overdue.map((item) => (
                <HelmCard
                  key={item.id}
                  item={item}
                  variant="warning"
                  onOpen={() => go('detail', item)}
                />
              ))
            )}
          </div>
        </section>

        {/* Done automatically overnight */}
        <section aria-labelledby="auto" data-helm-section="activity">
          <Collapsible defaultOpen={false}>
            <Card>
              <CollapsibleTrigger asChild>
                <button
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/40 transition-colors rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Toggle overnight auto-actions"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-success/10 text-success flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 id="auto" className="text-h3 text-foreground">
                        Done automatically overnight
                      </h2>
                      <p className="text-body-2 text-muted-foreground">
                        {autoActions.length} action{autoActions.length === 1 ? '' : 's'}{' '}
                        handled while you slept.
                      </p>
                    </div>
                  </div>
                  <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-5 pb-5">
                  <Separator className="mb-4" />
                  {autoActions.length === 0 ? (
                    <p className="text-body-2 text-muted-foreground">
                      Nothing auto-filed yet. Run a sync to see the agent work.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {autoActions.map((a) => (
                        <li key={a.id} className="flex items-start gap-3 text-body-2">
                          <Activity className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <span className="flex-1 text-foreground">{a.text}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] font-mono uppercase tracking-wider shrink-0',
                              a.tag === 'Sent' && 'border-primary/40 text-primary bg-primary/5',
                              a.tag === 'Filed' && 'border-success/40 text-success bg-success/5',
                              a.tag === 'Routed' && 'border-accent/40 text-accent-foreground bg-accent/10',
                              a.tag === 'Booked' && 'border-warning/40 text-warning bg-warning/5',
                            )}
                          >
                            {a.tag}
                          </Badge>
                          <span className="text-caption text-muted-foreground tabular-nums shrink-0">
                            {a.time}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
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
              {WEEK_PREVIEW.map((d) => (
                <li
                  key={d.day}
                  className="flex items-center gap-3 text-[13px] py-2 border-b border-border/40 last:border-0"
                >
                  <span className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground w-10 shrink-0">{d.day}</span>
                  <span className="text-foreground/80 flex-1 leading-snug">
                    {d.summary}
                  </span>
                </li>
              ))}
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

function InboxView({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useHelmData();
  const drafts = data?.drafts ?? [];

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
  const [sendBusy, setSendBusy] = useState<'send' | 'save_draft' | null>(null);
  const [instruction, setInstruction] = useState('');

  // Auto-select first draft
  const effectiveId = activeId ?? drafts[0]?.id ?? null;
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
    if (!active || !draftText) return;
    setReshapeBusy(true);
    try {
      const { data: gen, error } = await supabase.functions.invoke('helm-draft-reply', {
        body: { item_id: active.id, instruction: instr, base_draft: draftText },
      });
      if (error) throw error;
      setDraftText(gen?.draft ?? draftText);
    } catch (e: any) {
      toast.error(e?.message ?? 'Reshape failed');
    } finally {
      setReshapeBusy(false);
    }
  };

  const send = async (mode: 'send' | 'save_draft') => {
    if (!active || !draftText.trim()) {
      toast.error('Draft is empty');
      return;
    }
    setSendBusy(mode);
    try {
      const { data: res, error } = await supabase.functions.invoke('helm-send-reply', {
        body: { item_id: active.id, body: draftText, mode },
      });
      if (error) throw error;
      if (res?.already_sent) {
        toast.info('Already sent — skipped');
      } else if (mode === 'send') {
        toast.success('Reply sent');
      } else {
        toast.success('Draft saved in Outlook');
      }
      if (mode === 'send') {
        setSentIds((prev) => new Set(prev).add(active.id));
      }
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      // Auto-advance to next unsent (skip sent ones)
      const remaining = drafts.filter((d) => d.id !== active.id && !sentIds.has(d.id));
      setActiveId(remaining[0]?.id ?? null);
      setDraftText('');
      setOriginal(null);
    } catch (e: any) {
      toast.error(e?.message ?? `${mode} failed`);
    } finally {
      setSendBusy(null);
    }
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
      <BackBar onBack={onBack} label="Drafted for you · focused inbox" />
      <SectionHeader
        title={`${drafts.length} draft${drafts.length === 1 ? '' : 's'} waiting for your review`}
        subtitle="Skim, edit, send — replies thread into the original Outlook conversation."
      />

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : drafts.length === 0 ? (
        <EmptyHint>No drafts yet. Sync the inbox to generate fresh drafts.</EmptyHint>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[70vh]">
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

          {/* Right: reader + composer */}
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

                <div className="p-5 border-b border-border max-h-64 overflow-y-auto bg-muted/20">
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
                        className="prose prose-sm dark:prose-invert max-w-none text-body-2"
                        dangerouslySetInnerHTML={{ __html: original.body_html }}
                      />
                    ) : (
                      <p className="text-body-2 text-foreground whitespace-pre-wrap">
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
                        disabled={reshapeBusy || genBusy || !draftText}
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

  const approveMutation = useMutation({
    mutationFn: async (proposal: Proposal) => {
      const { data, error } = await supabase.functions.invoke('helm-plan-week', {
        body: { mode: 'approve_external', proposal },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success('Moved and notified attendees.');
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

      <FocusRulesCard rule={rule} saving={planQuery.isFetching} onChange={setRule} />

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

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 overflow-x-auto">
        {days.map((d) => {
          const evs = grouped[d.date.toDateString()] ?? [];
          const isToday = d.date.toDateString() === new Date().toDateString();
          const focus = focusByDay[d.key];
          return (
            <Card key={d.date.toISOString()} className={cn('min-w-[220px]', isToday && 'border-primary/60 shadow-sm')}>
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
                      <Zap className="w-3 h-3" /> Focus block
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
                {planQuery.data!.pending_external.map((p) => (
                  <li key={p.id} className="text-xs border border-accent/40 rounded-md p-2 bg-background/50 space-y-1">
                    <p className="font-semibold text-foreground">{p.subject}</p>
                    <p className="text-muted-foreground">
                      {fmtTimeShort(p.old_start)} → <span className="text-foreground font-medium">{fmtTimeShort(p.new_start)}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground italic">{p.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {p.is_organizer ? 'You host this meeting.' : `Hosted by ${p.organizer.name || p.organizer.email}.`}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(p)}
                      >
                        <ThumbsUp className="w-3 h-3 mr-1" />
                        {p.is_organizer ? 'Approve & move' : 'Propose new time'}
                      </Button>
                      <Button size="sm" variant="ghost"><X className="w-3 h-3 mr-1" />Keep it</Button>
                    </div>
                  </li>
                ))}
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
  const [done, setDone] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();

  const scrollTop = () => {
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch { window.scrollTo(0, 0); }
  };
  const go = (v: View, item?: HelmItem) => {
    if (item) setActiveItem(item);
    setView(v);
    scrollTop();
  };
  const back = () => { setView('brief'); scrollTop(); };

  const toggleDone = async (id: string, next: boolean) => {
    setDone((d) => ({ ...d, [id]: next }));
    if (!next) return;
    try {
      await supabase.from('helm_items').update({ status: 'resolved' }).eq('id', id);
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
          body[data-print-section] aside,
          body[data-print-section] nav,
          body[data-print-section] header,
          body[data-print-section] [data-helm-section]:not([data-print-target]),
          body[data-print-section] .print\\:hidden { display: none !important; }
          body[data-print-section] [data-helm-section][data-print-target] {
            break-inside: avoid;
          }
        }
      `}</style>
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {view === 'brief' && <BriefView go={go} done={done} toggleDone={toggleDone} />}
        {view === 'inbox' && <InboxView onBack={back} />}
        {view === 'detail' && <DetailView item={activeItem} onBack={back} />}
        {view === 'calendar' && <CalendarView onBack={back} />}
      </div>
    </>
  );
}

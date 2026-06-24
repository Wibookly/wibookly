import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CheckCircle2, Mail, Calendar, ListChecks, ChevronDown, ChevronRight,
  BellPlus, CalendarPlus, Check, Clock, Printer,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ReminderDialog } from '@/components/chat/ReminderDialog';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';

export interface ActionItem {
  taskId?: string;
  status?: 'open' | 'done' | 'snoozed' | 'scheduled';
  carriedFromDate?: string;
  carryCount?: number;
  priority?: number;
  urgency?: 'high' | 'medium' | 'low';
  title: string;
  source?: 'email' | 'meeting' | 'task';
  from?: string;
  subject?: string;
  receivedAt?: string;
  context?: string;
  action: string;
  why?: string;
  estimatedMinutes?: number;
}

interface Props {
  items: ActionItem[];
  priorityColors: { high: string; medium: string; low: string };
  onChanged?: () => void;
  onPrint?: () => void;
}

function urgencyHex(u: ActionItem['urgency'], colors: Props['priorityColors']) {
  if (u === 'high') return colors.high;
  if (u === 'low') return colors.low;
  return colors.medium;
}

async function updateTask(taskId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('daily_brief_tasks').update(patch).eq('id', taskId);
  if (error) throw error;
}

function ItemRow({
  it,
  colors,
  onChanged,
  index,
}: {
  it: ActionItem;
  colors: Props['priorityColors'];
  onChanged?: () => void;
  index: number;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const { activeConnection } = useActiveEmail();
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderMode, setReminderMode] = useState<'remind' | 'schedule'>('remind');
  const urg = urgencyHex(it.urgency, colors);
  const done = it.status === 'done';
  const snoozed = it.status === 'snoozed';

  const handle = async (label: string, fn: () => Promise<void>) => {
    if (!it.taskId) {
      toast.error('This item has not been saved yet — refresh the brief and try again.');
      return;
    }
    setBusy(label);
    try {
      await fn();
      toast.success(label);
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || `Failed to ${label.toLowerCase()}`);
    } finally {
      setBusy(null);
    }
  };

  const markDone = () =>
    handle('Marked done', () => updateTask(it.taskId!, { status: 'done', completed_at: new Date().toISOString() }));

  const snooze = () =>
    handle('Snoozed to tomorrow', () => {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return updateTask(it.taskId!, { status: 'snoozed', snoozed_until: t.toISOString().slice(0, 10) });
    });

  const openReminder = () => {
    if (!activeConnection?.id) {
      toast.error('Connect Microsoft 365 first to add a reminder to your calendar.');
      return;
    }
    setReminderMode('remind');
    setReminderOpen(true);
  };

  const openSchedule = () => {
    if (!activeConnection?.id) {
      toast.error('Connect Microsoft 365 first to schedule this on your calendar.');
      return;
    }
    setReminderMode('schedule');
    setReminderOpen(true);
  };

  const reminderTitle = (() => {
    const base = it.title || it.action || it.subject || 'Reminder';
    return reminderMode === 'schedule' ? base : `Follow up: ${base}`;
  })();

  return (
    <li
      data-tour={index === 0 ? 'brief-action-item' : undefined}
      className={cn(
        'p-4 rounded-xl bg-card border shadow-sm transition-opacity',
        done && 'opacity-50',
      )}
      style={{ borderLeftWidth: '5px', borderLeftColor: urg }}
    >
      <div className="flex gap-3 items-start">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full text-white text-sm font-bold grid place-items-center"
          style={{ background: urg }}
        >
          {it.priority ?? '•'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className={cn('font-semibold text-sm', done && 'line-through')}>{it.title}</span>
            <div data-tour={index === 0 ? 'brief-item-badges' : undefined} className="flex items-center gap-1.5">
              {it.carriedFromDate && (
                <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
                  ↻ Carried over{it.carryCount && it.carryCount > 1 ? ` ×${it.carryCount}` : ''}
                </Badge>
              )}
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide"
                style={{ background: `${urg}15`, color: urg, borderColor: `${urg}40` }}
              >
                {it.urgency || 'medium'}
              </Badge>
              {done && <Badge className="text-[10px] bg-emerald-600">Done</Badge>}
              {snoozed && <Badge variant="secondary" className="text-[10px]">Snoozed</Badge>}
            </div>
          </div>

          {(it.from || it.subject || it.receivedAt) && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {it.from && <>From <strong>{it.from}</strong></>}
              {it.subject && <> · {it.subject}</>}
              {it.receivedAt && <> · {it.receivedAt}</>}
            </p>
          )}

          {it.context && (
            <div className="mt-2 p-2.5 rounded-md bg-muted/40 text-sm leading-snug">
              <span className="font-semibold text-foreground">Context: </span>
              <span className="text-muted-foreground">{it.context}</span>
            </div>
          )}
          {it.action && (
            <p className="mt-1.5 text-sm leading-snug">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">Do: </span>
              <span>{it.action}</span>
            </p>
          )}
          {it.why && (
            <p className="mt-1 text-xs italic text-muted-foreground">Why: {it.why}</p>
          )}
          {it.estimatedMinutes && (
            <p className="mt-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">⏱ ~{it.estimatedMinutes} min</p>
          )}

          {/* Per-item action toolbar */}
          {it.taskId && !done && (
            <div data-tour={index === 0 ? 'brief-item-actions' : undefined} className="mt-3 flex flex-wrap gap-1.5">
              <Button data-tour={index === 0 ? 'brief-mark-done' : undefined} size="sm" variant="outline" className="h-7 text-xs" onClick={markDone} disabled={!!busy}>
                <Check className="w-3 h-3 mr-1" /> Mark done
              </Button>
              <Button data-tour={index === 0 ? 'brief-snooze' : undefined} size="sm" variant="outline" className="h-7 text-xs" onClick={snooze} disabled={!!busy}>
                <Clock className="w-3 h-3 mr-1" /> Snooze
              </Button>
              <Button data-tour={index === 0 ? 'brief-remind' : undefined} size="sm" variant="outline" className="h-7 text-xs" onClick={openReminder} disabled={!!busy}>
                <BellPlus className="w-3 h-3 mr-1" /> Remind me
              </Button>
              <Button data-tour={index === 0 ? 'brief-schedule-action' : undefined} size="sm" variant="outline" className="h-7 text-xs" onClick={openSchedule} disabled={!!busy}>
                <CalendarPlus className="w-3 h-3 mr-1" /> Schedule
              </Button>
            </div>
          )}
        </div>
      </div>
      <ReminderDialog
        open={reminderOpen}
        onOpenChange={setReminderOpen}
        connectionId={activeConnection?.id ?? null}
        initialTitle={reminderTitle}
        onCreated={() => {
          // Mark the task as scheduled in the brief so the UI reflects the booking.
          if (it.taskId) {
            updateTask(it.taskId, { status: 'scheduled' }).then(() => onChanged?.()).catch(() => null);
          }
        }}
      />
    </li>
  );
}

function Group({
  title, icon: Icon, items, emptyText, colors, onChanged, defaultOpen, tourKey,
}: {
  title: string;
  icon: typeof Mail;
  items: ActionItem[];
  emptyText: string;
  colors: Props['priorityColors'];
  onChanged?: () => void;
  defaultOpen: boolean;
  tourKey: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const count = items.length;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger data-tour={tourKey} className="w-full flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Icon className="w-4 h-4" />
          {title}
          <Badge variant="secondary" className="text-xs">{count}</Badge>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {count === 0 ? (
          <p className="text-xs text-muted-foreground italic px-3 py-4">{emptyText}</p>
        ) : (
          <ol className="space-y-3 mt-3">
            {items.map((it, i) => (
              <ItemRow key={it.taskId || `${it.source}-${i}`} it={it} colors={colors} onChanged={onChanged} index={i} />
            ))}
          </ol>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ActionItemsPanel({ items, priorityColors, onChanged, onPrint }: Props) {
  const open = items.filter((i) => i.status !== 'done');
  const emails = open.filter((i) => (i.source || 'email') === 'email');
  const meetings = open.filter((i) => i.source === 'meeting');
  const tasks = open.filter((i) => i.source === 'task');

  return (
    <Card data-tour="brief-action-plan" className="border-0 shadow-lg overflow-hidden ring-1 ring-indigo-200/60 dark:ring-indigo-900/40 mb-6">
      <div className="h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500" />
      <CardHeader className="pb-3 flex flex-row items-center justify-between bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/20 dark:to-violet-950/20">
        <div>
          <CardTitle className="text-lg flex items-center gap-3">
            <span className="p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
              <CheckCircle2 className="w-4 h-4" />
            </span>
            Your Action Items
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1.5 ml-11">
            Email and calendar items that need your attention. Mark them done as you finish — anything open carries to tomorrow.
          </p>
        </div>
        {onPrint && (
          <Button variant="ghost" size="sm" onClick={onPrint}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-5 space-y-3">
        <Group
          title="Emails"
          icon={Mail}
          items={emails}
          emptyText="No email action items today. Inbox is clear. 🎉"
          colors={priorityColors}
          onChanged={onChanged}
          defaultOpen={emails.length > 0}
          tourKey="brief-emails-group"
        />
        <Group
          title="Calendar"
          icon={Calendar}
          items={meetings}
          emptyText="No calendar items today."
          colors={priorityColors}
          onChanged={onChanged}
          defaultOpen={meetings.length > 0}
          tourKey="brief-calendar-group"
        />
        {tasks.length > 0 && (
          <Group
            title="Tasks"
            icon={ListChecks}
            items={tasks}
            emptyText="No to-do tasks today."
            colors={priorityColors}
            onChanged={onChanged}
            defaultOpen
            tourKey="brief-tasks-group"
          />
        )}
      </CardContent>
    </Card>
  );
}

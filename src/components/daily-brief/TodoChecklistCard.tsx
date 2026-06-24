import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckSquare, Printer, Mail, Calendar, ListChecks, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { ActionItem } from './ActionItemsPanel';

interface Props {
  items: ActionItem[];
  onChanged?: () => void;
}

function srcIcon(s?: string) {
  if (s === 'meeting') return <Calendar className="w-3.5 h-3.5 text-violet-500" />;
  if (s === 'task') return <ListChecks className="w-3.5 h-3.5 text-emerald-500" />;
  return <Mail className="w-3.5 h-3.5 text-sky-500" />;
}

function srcLabel(s?: string) {
  return s === 'meeting' ? 'Meeting' : s === 'task' ? 'Task' : 'Email';
}

export function TodoChecklistCard({ items, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  // Stable order: open first (by priority), then done items at the bottom.
  const ordered = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const ad = a.status === 'done' ? 1 : 0;
      const bd = b.status === 'done' ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return (a.priority ?? 99) - (b.priority ?? 99);
    });
    return arr;
  }, [items]);

  const toggle = async (it: ActionItem, checked: boolean) => {
    if (!it.taskId) {
      toast.error('Not synced yet — refresh the brief.');
      return;
    }
    setBusy(it.taskId);
    try {
      const patch = checked
        ? { status: 'done', completed_at: new Date().toISOString() }
        : { status: 'open', completed_at: null };
      const { error } = await supabase.from('daily_brief_tasks').update(patch).eq('id', it.taskId);
      if (error) throw error;
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update');
    } finally {
      setBusy(null);
    }
  };

  const handlePrintChecklist = () => {
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return;
    const esc = (v: unknown) =>
      String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const today = format(new Date(), 'EEEE, MMMM d, yyyy');
    const rows = ordered.map((it, i) => {
      const done = it.status === 'done';
      const src = srcLabel(it.source);
      return `<li class="${done ? 'done' : ''}">
        <span class="box">${done ? '☑' : '☐'}</span>
        <span class="num">${i + 1}.</span>
        <span class="src">${src}</span>
        <span class="title">${esc(it.title)}</span>
        ${it.estimatedMinutes ? `<span class="min">⏱ ${it.estimatedMinutes}m</span>` : ''}
        ${it.action ? `<div class="do">${esc(it.action)}</div>` : ''}
      </li>`;
    }).join('');
    w.document.write(`<!doctype html><html><head><title>InboxIQ — Today's Checklist</title>
      <style>
        body{font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a;margin:32px;}
        h1{font-size:20px;margin:0;} .sub{color:#64748b;font-size:12px;margin:4px 0 18px;}
        ul{list-style:none;padding:0;margin:0;} li{padding:10px 12px;border-bottom:1px dashed #cbd5e1;display:flex;flex-wrap:wrap;gap:8px;align-items:center;break-inside:avoid;}
        li.done .title{text-decoration:line-through;color:#94a3b8;}
        .box{font-size:18px;color:#0ea5e9;width:22px;}
        .num{font-weight:700;color:#475569;min-width:24px;}
        .src{font-size:10px;background:#e2e8f0;color:#475569;padding:2px 6px;border-radius:4px;font-weight:600;text-transform:uppercase;}
        .title{flex:1;font-size:13px;}
        .min{font-size:11px;font-weight:700;color:#4338ca;}
        .do{flex-basis:100%;margin:6px 0 0 54px;font-size:12px;color:#334155;}
        .do::before{content:'Do: ';color:#047857;font-weight:700;}
        @page{size:Letter;margin:0.5in;}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #0ea5e9;padding-bottom:8px;margin-bottom:12px;">
        <div><h1>Today's Checklist</h1><div class="sub">${esc(today)} · ${ordered.length} item${ordered.length === 1 ? '' : 's'}</div></div>
        <div style="color:#0ea5e9;font-weight:700;">InboxIQ</div>
      </div>
      <ul>${rows || '<li><span class="title" style="color:#94a3b8;font-style:italic;">No tasks for today.</span></li>'}</ul>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 200);
  };

  if (!ordered.length) return null;

  const openCount = ordered.filter((i) => i.status !== 'done').length;
  const doneCount = ordered.length - openCount;
  const pct = ordered.length ? Math.round((doneCount / ordered.length) * 100) : 0;

  return (
    <Card className="border-0 shadow-lg overflow-hidden ring-1 ring-sky-200/60 dark:ring-sky-900/40 mb-6">
      <div className="h-1 bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500" />
      <CardHeader className="pb-3 flex flex-row items-center justify-between bg-gradient-to-br from-sky-50 to-cyan-50 dark:from-sky-950/20 dark:to-cyan-950/20">
        <div>
          <CardTitle className="text-lg flex items-center gap-3">
            <span className="p-2 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 text-white shadow-md">
              <CheckSquare className="w-4 h-4" />
            </span>
            Today's Checklist
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1.5 ml-11">
            Tick items off as you finish them. {doneCount}/{ordered.length} done · {pct}%
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handlePrintChecklist}>
          <Printer className="w-4 h-4 mr-1" /> Print checklist
        </Button>
      </CardHeader>
      <CardContent className="pt-4">
        {/* progress bar */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="divide-y">
          {ordered.map((it, i) => {
            const done = it.status === 'done';
            return (
              <li key={it.taskId || `${it.source}-${i}`} className={cn('py-2.5 flex items-start gap-3', done && 'opacity-60')}>
                <Checkbox
                  checked={done}
                  disabled={busy === it.taskId}
                  onCheckedChange={(c) => toggle(it, !!c)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground w-5 text-right">{i + 1}.</span>
                    {srcIcon(it.source)}
                    <span className={cn('text-sm font-medium flex-1 min-w-0', done && 'line-through text-muted-foreground')}>
                      {it.title}
                    </span>
                    {it.estimatedMinutes && (
                      <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                        ⏱ {it.estimatedMinutes}m
                      </span>
                    )}
                  </div>
                  {it.action && !done && (
                    <p className="text-xs text-muted-foreground mt-0.5 ml-7">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">Do: </span>
                      {it.action}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

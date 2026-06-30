import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarClock, Mail, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Item {
  id: string;
  title: string;
  context: string;
  sender?: string;
  sender_email?: string;
}

const RESHAPE_CHIPS = ['Shorter', 'More formal', 'Warmer', 'More firm', 'Bullet points'];

export function InlineEmailExpander({ item, onClose, onSent, accent = 'amber' }: {
  item: Item;
  onClose: () => void;
  onSent?: () => void;
  accent?: 'amber' | 'violet' | 'rose' | 'sky' | 'emerald';
}) {
  const qc = useQueryClient();
  const [original, setOriginal] = useState<{ subject: string; from: { name?: string; address?: string } | null; body_html: string; body_text: string } | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [reshapeBusy, setReshapeBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState<'send' | 'save_draft' | 'schedule' | null>(null);
  const [instruction, setInstruction] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOriginal(null);
      setBodyError(null);
      setDraftText('');
      try {
        const { data: msg, error } = await supabase.functions.invoke('helm-fetch-message', { body: { item_id: item.id } });
        if (error) throw error;
        if (cancelled) return;
        if (!msg?.message) throw new Error('No message returned');
        setOriginal(msg.message);
      } catch (e: any) {
        if (!cancelled) setBodyError(e?.message ?? 'Failed to load message');
      }
      const { data: row } = await supabase.from('helm_items').select('ai_draft').eq('id', item.id).maybeSingle();
      if (cancelled) return;
      if (row?.ai_draft) {
        setDraftText(row.ai_draft);
      } else {
        setGenBusy(true);
        try {
          const { data: gen, error: genErr } = await supabase.functions.invoke('helm-draft-reply', { body: { item_id: item.id } });
          if (genErr) throw genErr;
          if (!cancelled) setDraftText(gen?.draft ?? '');
        } catch (e: any) {
          if (!cancelled) toast.error(e?.message ?? 'Draft generation failed');
        } finally {
          if (!cancelled) setGenBusy(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [item.id]);

  const reshape = async (instr: string) => {
    setReshapeBusy(true);
    try {
      const { data: gen, error } = await supabase.functions.invoke('helm-draft-reply', {
        body: { item_id: item.id, instruction: instr, base_draft: draftText || undefined },
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
    if (!draftText.trim()) { toast.error('Draft is empty'); return; }
    setSendBusy(mode);
    try {
      const { data: res, error } = await supabase.functions.invoke('helm-send-reply', {
        body: { item_id: item.id, body: draftText, mode, ...(mode === 'schedule' && opts?.scheduled_for ? { scheduled_for: opts.scheduled_for } : {}) },
      });
      if (error) throw error;
      if (res?.already_sent) toast.info('Already sent — skipped');
      else if (mode === 'send') toast.success('Reply sent');
      else if (mode === 'schedule') toast.success(res?.scheduled_for ? `Scheduled for ${new Date(res.scheduled_for).toLocaleString()}` : 'Scheduled');
      else toast.success('Draft saved in Outlook');

      if (mode === 'send' || mode === 'schedule') {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const KEY = `helm:big3-pinned:${today}`;
          const raw = window.localStorage.getItem(KEY);
          if (raw) {
            const ids: string[] = JSON.parse(raw);
            window.localStorage.setItem(KEY, JSON.stringify(ids.filter((id) => id !== item.id)));
          }
        } catch { /* ignore */ }
        qc.setQueryData<any>(['helm-items'], (cur: any) => {
          if (!cur) return cur;
          const prune = (arr: any[] = []) => arr.filter((x) => x.id !== item.id);
          return { ...cur, big3: prune(cur.big3), decisions: prune(cur.decisions), drafts: prune(cur.drafts), overdue: prune(cur.overdue), fyi: prune(cur.fyi) };
        });
        onSent?.();
      }
      qc.invalidateQueries({ queryKey: ['helm-items'] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? `${mode} failed`);
    } finally {
      setSendBusy(null);
    }
  };

  const submitSchedule = () => {
    if (!scheduleDate || !scheduleTime) { toast.error('Pick a date and time'); return; }
    const local = new Date(`${scheduleDate}T${scheduleTime}`);
    if (Number.isNaN(local.getTime())) { toast.error('Invalid date/time'); return; }
    if (local.getTime() < Date.now() + 30_000) { toast.error('Pick a time at least 1 minute in the future'); return; }
    send('schedule', { scheduled_for: local.toISOString() });
  };

  const accentBar: Record<string, string> = {
    amber: 'from-amber-400 via-orange-500 to-rose-500',
    violet: 'from-violet-400 via-indigo-500 to-blue-500',
    rose: 'from-rose-400 via-red-500 to-rose-600',
    sky: 'from-sky-400 via-cyan-500 to-blue-500',
    emerald: 'from-emerald-400 via-green-500 to-teal-500',
  };

  return (
    <div className="relative rounded-xl border border-border/70 bg-card overflow-hidden shadow-md animate-in fade-in slide-in-from-top-2 duration-200">
      <div className={cn('absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b', accentBar[accent])} />
      <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-border/50">
        <div className="min-w-0">
          <h4 className="text-[14px] font-semibold text-foreground truncate">{original?.subject || item.title}</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Mail className="w-3 h-3" /> From {original?.from?.name ?? item.sender ?? '—'}
            {original?.from?.address && <span className="text-muted-foreground/70">&lt;{original.from.address}&gt;</span>}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* TOP — original email */}
      <section className="px-5 py-4 border-b border-border/40 bg-muted/20">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">Original message</p>
        {bodyError ? (
          <div className="text-[12px] rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">{bodyError}</div>
        ) : original ? (
          original.body_html ? (
            <div className="helm-email-body text-[13px] leading-relaxed max-h-64 overflow-y-auto" dangerouslySetInnerHTML={{ __html: original.body_html }} />
          ) : (
            <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">{original.body_text || '(no body)'}</p>
          )
        ) : (
          <Skeleton className="h-20" />
        )}
      </section>

      {/* MIDDLE — AI summary */}
      <section className="px-5 py-4 border-b border-border/40">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2 flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-primary" /> AI summary
        </p>
        <p className="text-[13px] leading-relaxed text-foreground/90">
          {item.context || 'No summary available yet — sync to refresh.'}
        </p>
      </section>

      {/* BOTTOM — AI draft */}
      <section className="px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-primary" /> AI-drafted reply
          </p>
          {(genBusy || reshapeBusy) && (
            <span className="inline-flex items-center text-[11px] text-muted-foreground">
              <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />{genBusy ? 'Generating…' : 'Reshaping…'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-2">
          {RESHAPE_CHIPS.map((c) => (
            <Button key={c} variant="outline" size="sm" className="h-7 text-[11px]" disabled={reshapeBusy || genBusy} onClick={() => reshape(c)}>
              {c}
            </Button>
          ))}
        </div>

        <textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder={genBusy ? 'Generating draft…' : 'Your reply…'}
          className="w-full min-h-[180px] rounded-md border border-input bg-background p-3 text-[13px] text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex items-center gap-2 mt-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && instruction.trim()) {
                e.preventDefault();
                const i = instruction.trim(); setInstruction(''); reshape(i);
              }
            }}
            placeholder="Tell the AI how to change this reply…"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button variant="secondary" size="sm" disabled={!instruction.trim() || reshapeBusy || genBusy}
            onClick={() => { const i = instruction.trim(); setInstruction(''); reshape(i); }}>
            Apply
          </Button>
        </div>

        <Separator className="my-3" />

        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={!!sendBusy}>Close</Button>
          <Button variant="outline" size="sm" onClick={() => send('save_draft')} disabled={!!sendBusy || !draftText.trim()}>
            {sendBusy === 'save_draft' ? 'Saving…' : 'Save draft'}
          </Button>
          <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" disabled={!!sendBusy || !draftText.trim()}
                onClick={() => {
                  if (!scheduleDate || !scheduleTime) {
                    const d = new Date(Date.now() + 60 * 60 * 1000);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    setScheduleDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                    setScheduleTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }
                }}>
                <CalendarClock className="w-4 h-4 mr-1.5" />
                {sendBusy === 'schedule' ? 'Scheduling…' : 'Schedule send'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="end">
              <div className="space-y-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Send this reply later</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Date</label>
                    <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Time</label>
                    <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </div>
                <Button size="sm" className="w-full" onClick={submitSchedule} disabled={!!sendBusy}>
                  <CalendarClock className="w-4 h-4 mr-1.5" /> Schedule
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" onClick={() => send('send')} disabled={!!sendBusy || !draftText.trim()}>
            <Send className="w-4 h-4 mr-1.5" />
            {sendBusy === 'send' ? 'Sending…' : 'Approve & send'}
          </Button>
        </div>
      </section>
    </div>
  );
}

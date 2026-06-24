import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarClock, Loader2, MapPin, Video, CheckCircle2, AlertTriangle, CalendarIcon, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  initialTitle?: string;
  onCreated?: (event: { title: string; start: string; webLink?: string }) => void;
}

const REMINDER_TRIGGERS = /\b(remind\s+me|set\s+(?:a|an)\s+reminder|schedule\s+(?:a\s+)?(?:reminder|meeting|event|call|follow-?up))\b/i;

export function isReminderTrigger(text: string): boolean {
  return REMINDER_TRIGGERS.test(text || '');
}

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60 - (d.getMinutes() % 15));
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalInput(s: string): Date {
  // "YYYY-MM-DDTHH:mm" parsed as local time
  if (!s) return new Date();
  const [date, time = '09:00'] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function setTimeOn(s: string, hh: number, mm: number): string {
  const d = parseLocalInput(s);
  d.setHours(hh, mm, 0, 0);
  return toLocalInput(d);
}

function setDateOn(s: string, date: Date): string {
  const cur = parseLocalInput(s);
  const d = new Date(date);
  d.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
  return toLocalInput(d);
}

const QUICK_TIMES: Array<{ label: string; hh: number; mm: number }> = [
  { label: '8:00 AM', hh: 8, mm: 0 },
  { label: '9:00 AM', hh: 9, mm: 0 },
  { label: '10:00 AM', hh: 10, mm: 0 },
  { label: '11:00 AM', hh: 11, mm: 0 },
  { label: '1:00 PM', hh: 13, mm: 0 },
  { label: '2:00 PM', hh: 14, mm: 0 },
  { label: '3:00 PM', hh: 15, mm: 0 },
  { label: '4:00 PM', hh: 16, mm: 0 },
];

const DURATIONS: Array<{ label: string; value: string }> = [
  { label: '15m', value: '15' },
  { label: '30m', value: '30' },
  { label: '45m', value: '45' },
  { label: '1h', value: '60' },
  { label: '1.5h', value: '90' },
  { label: '2h', value: '120' },
];

type Conflict = { id: string; subject: string; start: { dateTime: string }; end: { dateTime: string } };
type Availability =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'free' }
  | { status: 'busy'; conflicts: Conflict[] }
  | { status: 'error'; message: string };

export function ReminderDialog({ open, onOpenChange, connectionId, initialTitle = '', onCreated }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [start, setStart] = useState(defaultStart());
  const [durationMin, setDurationMin] = useState('30');
  const [notes, setNotes] = useState('');
  const [attendee, setAttendee] = useState('');
  const [location, setLocation] = useState('');
  const [isTeams, setIsTeams] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ status: 'idle' });
  const checkSeq = useRef(0);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle.slice(0, 200));
      setStart(defaultStart());
      setDurationMin('30');
      setNotes('');
      setAttendee('');
      setLocation('');
      setIsTeams(false);
      setAvailability({ status: 'idle' });
    }
  }, [open, initialTitle]);

  // Check availability whenever start/duration changes
  useEffect(() => {
    if (!open || !connectionId || !start) return;
    const seq = ++checkSeq.current;
    setAvailability({ status: 'checking' });
    const t = setTimeout(async () => {
      try {
        const startDate = new Date(start);
        const endDate = new Date(startDate.getTime() + Number(durationMin) * 60_000);
        const { data, error } = await supabase.functions.invoke('create-reminder', {
          body: {
            action: 'availability',
            connection_id: connectionId,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          },
        });
        if (seq !== checkSeq.current) return;
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        const conflicts = ((data as any)?.conflicts || []) as Conflict[];
        setAvailability(conflicts.length ? { status: 'busy', conflicts } : { status: 'free' });
      } catch (e) {
        if (seq !== checkSeq.current) return;
        setAvailability({ status: 'error', message: (e as Error).message || 'Could not check availability' });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [open, connectionId, start, durationMin]);

  const handleConfirm = async () => {
    if (!connectionId) {
      toast.error('Connect Microsoft 365 first to create reminders.');
      return;
    }
    if (!title.trim() || !start) {
      toast.error('Title and date/time are required.');
      return;
    }
    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + Number(durationMin) * 60_000);

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-reminder', {
        body: {
          connection_id: connectionId,
          title: title.trim(),
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          notes,
          attendee_email: attendee.trim() || undefined,
          location: location.trim() || undefined,
          is_online_meeting: isTeams,
          reminder_minutes_before_start: 15,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(isTeams ? 'Teams meeting added & invite sent' : 'Reminder added to your Outlook calendar');
      onCreated?.({ title, start: startDate.toISOString(), webLink: (data as any)?.event?.webLink });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create reminder');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-sky-500" />
            Set Reminder
          </DialogTitle>
          <DialogDescription>
            Creates an event on your Outlook calendar and adds it to your Daily Brief.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rem-title">Title</Label>
            <Input
              id="rem-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should we remind you about?"
              autoFocus
            />
          </div>

          {/* Date + Time picker — calendar popover and quick-time chips */}
          {(() => {
            const currentDate = parseLocalInput(start);
            const timeStr = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}`;
            const matchedQuick = QUICK_TIMES.find((q) => q.hh === currentDate.getHours() && q.mm === currentDate.getMinutes());
            return (
              <div className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
                <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/70">When</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="justify-start text-left font-normal h-10">
                        <CalendarIcon className="mr-2 h-4 w-4 text-sky-500" />
                        {format(currentDate, 'EEE, MMM d, yyyy')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={currentDate}
                        onSelect={(d) => d && setStart(setDateOn(start, d))}
                        initialFocus
                        className="pointer-events-auto"
                        disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                      />
                    </PopoverContent>
                  </Popover>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sky-500 pointer-events-none" />
                    <Input
                      type="time"
                      value={timeStr}
                      step={900}
                      onChange={(e) => {
                        const [hh, mm] = e.target.value.split(':').map(Number);
                        if (!Number.isNaN(hh)) setStart(setTimeOn(start, hh, mm || 0));
                      }}
                      className="pl-9 h-10"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_TIMES.map((q) => {
                    const active = matchedQuick?.label === q.label;
                    return (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() => setStart(setTimeOn(start, q.hh, q.mm))}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                          active
                            ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                            : 'bg-background hover:bg-muted border-border text-foreground/80',
                        )}
                      >
                        {q.label}
                      </button>
                    );
                  })}
                </div>
                <div className="pt-1">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                    Duration
                  </Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {DURATIONS.map((d) => {
                      const active = durationMin === d.value;
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => setDurationMin(d.value)}
                          className={cn(
                            'px-3 py-1 rounded-md text-xs font-semibold border transition-colors',
                            active
                              ? 'bg-violet-500 text-white border-violet-500 shadow-sm'
                              : 'bg-background hover:bg-muted border-border text-foreground/80',
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Availability indicator */}
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-sm flex items-start gap-2 transition-colors',
              availability.status === 'free' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              availability.status === 'busy' && 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
              availability.status === 'checking' && 'border-muted bg-muted/30 text-muted-foreground',
              availability.status === 'error' && 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
              availability.status === 'idle' && 'hidden',
            )}
          >
            {availability.status === 'checking' && <Loader2 className="w-4 h-4 mt-0.5 animate-spin" />}
            {availability.status === 'free' && <CheckCircle2 className="w-4 h-4 mt-0.5" />}
            {availability.status === 'busy' && <AlertTriangle className="w-4 h-4 mt-0.5" />}
            {availability.status === 'error' && <AlertTriangle className="w-4 h-4 mt-0.5" />}
            <div className="flex-1">
              {availability.status === 'checking' && <span>Checking your calendar…</span>}
              {availability.status === 'free' && <span className="font-medium">You're free at this time</span>}
              {availability.status === 'busy' && (
                <div>
                  <div className="font-medium mb-1">Conflicts with {availability.conflicts.length} event{availability.conflicts.length > 1 ? 's' : ''}:</div>
                  <ul className="text-xs space-y-0.5 list-disc list-inside">
                    {availability.conflicts.slice(0, 3).map((c) => (
                      <li key={c.id} className="truncate">{c.subject || '(untitled)'}</li>
                    ))}
                  </ul>
                </div>
              )}
              {availability.status === 'error' && <span className="text-xs">{availability.message}</span>}
            </div>
          </div>

          {/* Teams meeting toggle */}
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-sky-500" />
              <div>
                <Label htmlFor="rem-teams" className="cursor-pointer text-sm">Teams meeting</Label>
                <p className="text-xs text-muted-foreground">Generates a Teams link and sends invite from Outlook</p>
              </div>
            </div>
            <Switch id="rem-teams" checked={isTeams} onCheckedChange={setIsTeams} />
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="rem-loc" className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Location {isTeams && <span className="text-xs text-muted-foreground">(optional — Teams link is attached automatically)</span>}</Label>
            <Input
              id="rem-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={isTeams ? 'e.g. Microsoft Teams Meeting' : 'e.g. Conference Room 200, or 5872 Engineer Dr'}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rem-att">Attendee email{isTeams ? 's (comma separated)' : ' (optional)'}</Label>
            <Input
              id="rem-att"
              value={attendee}
              onChange={(e) => setAttendee(e.target.value)}
              placeholder="person@example.com, other@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-notes">Notes (optional)</Label>
            <Textarea
              id="rem-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add context for this reminder…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarClock className="w-4 h-4 mr-2" />}
            {isTeams ? 'Create Teams meeting' : 'Add to Calendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

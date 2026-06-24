import { useEffect, useMemo, useRef, useState } from 'react';
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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-sky-500" />
            Set Reminder
          </DialogTitle>
          <DialogDescription>
            Creates an event on your Outlook calendar and adds it to your Daily Brief.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rem-when">When</Label>
              <Input
                id="rem-when"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rem-dur">Duration</Label>
              <Select value={durationMin} onValueChange={setDurationMin}>
                <SelectTrigger id="rem-dur"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="45">45 min</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="90">1.5 hours</SelectItem>
                  <SelectItem value="120">2 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

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

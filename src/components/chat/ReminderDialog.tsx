import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarClock, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

export function ReminderDialog({ open, onOpenChange, connectionId, initialTitle = '', onCreated }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [start, setStart] = useState(defaultStart());
  const [durationMin, setDurationMin] = useState('30');
  const [notes, setNotes] = useState('');
  const [attendee, setAttendee] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle.slice(0, 200));
      setStart(defaultStart());
      setDurationMin('30');
      setNotes('');
      setAttendee('');
    }
  }, [open, initialTitle]);

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
          reminder_minutes_before_start: 15,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Reminder added to your Outlook calendar');
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
      <DialogContent className="sm:max-w-md">
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
          <div className="space-y-1.5">
            <Label htmlFor="rem-att">Attendee email (optional)</Label>
            <Input
              id="rem-att"
              type="email"
              value={attendee}
              onChange={(e) => setAttendee(e.target.value)}
              placeholder="person@example.com"
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
            Add to Calendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

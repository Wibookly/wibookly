import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CalendarClock,
  Calendar as CalendarIcon,
  Printer,
  RefreshCw,
  Video,
  MapPin,
  Users,
  ExternalLink,
} from 'lucide-react';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
} from 'date-fns';

type Range = 'today' | 'week' | 'month';

interface CalendarEvent {
  id: string;
  subject: string;
  preview: string;
  start: string | null;
  end: string | null;
  location: string;
  organizer: string;
  attendeeCount: number;
  isOnlineMeeting: boolean;
  joinUrl: string;
  webLink: string;
  isAllDay: boolean;
  showAs: string;
}

interface Props {
  connectionId: string;
}

function rangeWindow(range: Range): { start: Date; end: Date; label: string } {
  const now = new Date();
  if (range === 'today') {
    return { start: startOfDay(now), end: endOfDay(now), label: format(now, 'EEEE, MMM d') };
  }
  if (range === 'week') {
    const s = startOfWeek(now, { weekStartsOn: 1 });
    const e = endOfWeek(now, { weekStartsOn: 1 });
    return { start: s, end: e, label: `${format(s, 'MMM d')} – ${format(e, 'MMM d')}` };
  }
  const s = startOfMonth(now);
  const e = endOfMonth(now);
  return { start: s, end: e, label: format(now, 'MMMM yyyy') };
}

export function CalendarPanel({ connectionId }: Props) {
  const [range, setRange] = useState<Range>('today');
  const { start, end, label } = useMemo(() => rangeWindow(range), [range]);

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ['calendar-events', connectionId, range],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('calendar-events', {
        body: {
          connection_id: connectionId,
          start: start.toISOString(),
          end: end.toISOString(),
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return ((data as any)?.events ?? []) as CalendarEvent[];
    },
    enabled: !!connectionId,
    staleTime: 60_000,
  });

  const events = data ?? [];

  // Group by day for week/month view
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((e) => {
      const key = e.start ? format(parseISO(e.start), 'yyyy-MM-dd') : 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return;
    const rows = events
      .map((e) => {
        const time = e.isAllDay
          ? 'All day'
          : e.start
          ? `${format(parseISO(e.start), 'EEE MMM d, h:mm a')}${
              e.end ? ` – ${format(parseISO(e.end), 'h:mm a')}` : ''
            }`
          : '';
        return `
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;color:#0369a1;white-space:nowrap;">${time}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">
              <div style="font-weight:600;">${escapeHtml(e.subject)}</div>
              ${e.location ? `<div style="font-size:11px;color:#64748b;">📍 ${escapeHtml(e.location)}</div>` : ''}
              ${e.organizer ? `<div style="font-size:11px;color:#64748b;">Organizer: ${escapeHtml(e.organizer)}</div>` : ''}
              ${e.attendeeCount ? `<div style="font-size:11px;color:#64748b;">${e.attendeeCount} attendee${e.attendeeCount === 1 ? '' : 's'}</div>` : ''}
            </td>
          </tr>`;
      })
      .join('');
    w.document.write(`<!doctype html><html><head><title>Schedule — ${label}</title>
      <style>
        body{font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a;margin:24px;}
        h1{font-size:20px;margin:0 0 4px;}
        .sub{color:#64748b;font-size:12px;margin-bottom:18px;}
        table{width:100%;border-collapse:collapse;}
        .brand{color:#0ea5e9;font-weight:700;}
        @page{size:Letter;margin:0.5in;}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #0ea5e9;padding-bottom:8px;margin-bottom:16px;">
        <div><h1>Schedule — ${label}</h1><div class="sub">${events.length} event${events.length === 1 ? '' : 's'}</div></div>
        <div class="brand">InboxIQ</div>
      </div>
      <table>${rows || '<tr><td style="padding:40px;text-align:center;color:#94a3b8;">No events in this range.</td></tr>'}</table>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 200);
  };

  return (
    <Card className="border-0 shadow-lg overflow-hidden ring-1 ring-blue-200/60 dark:ring-blue-900/40">
      <div className="h-1 bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500" />
      <CardHeader className="pb-3 bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-950/20 dark:to-blue-950/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-3">
            <span className="p-2 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-md">
              <CalendarClock className="w-4 h-4" />
            </span>
            <span>Your Schedule</span>
            <span className="text-xs font-normal text-muted-foreground">· {label}</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              value={range}
              onValueChange={(v) => v && setRange(v as Range)}
            >
              <ToggleGroupItem value="today">Today</ToggleGroupItem>
              <ToggleGroupItem value="week">This Week</ToggleGroupItem>
              <ToggleGroupItem value="month">This Month</ToggleGroupItem>
            </ToggleGroup>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={handlePrint}>
              <Printer className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {error ? (
          <div className="text-center py-8 text-sm text-destructive">
            {(error as Error).message || 'Failed to load calendar.'}
          </div>
        ) : isLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Loading events…</div>
        ) : events.length === 0 ? (
          <div className="text-center py-10">
            <CalendarIcon className="w-12 h-12 text-sky-300 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm font-medium">No events in this range</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[520px]">
            <div className="space-y-4">
              {grouped.map(([day, items]) => (
                <div key={day}>
                  {range !== 'today' && (
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      {format(parseISO(day), 'EEEE, MMM d')}
                      {isSameDay(parseISO(day), new Date()) && (
                        <Badge variant="outline" className="ml-2 text-[10px] border-sky-300 text-sky-700">
                          Today
                        </Badge>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    {items.map((e) => (
                      <EventRow key={e.id} event={e} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const now = new Date();
  const startD = event.start ? parseISO(event.start) : null;
  const endD = event.end ? parseISO(event.end) : null;
  const isPast = endD ? endD < now : false;
  const isNow = startD && endD ? startD <= now && endD >= now : false;
  const timeLabel = event.isAllDay
    ? 'All day'
    : startD
    ? `${format(startD, 'h:mm a')}${endD ? ` – ${format(endD, 'h:mm a')}` : ''}`
    : '';

  return (
    <div
      className={`flex gap-3 p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow ${
        isPast ? 'opacity-60' : ''
      } ${isNow ? 'ring-2 ring-sky-400' : 'border-sky-100 dark:border-sky-900/40'}`}
    >
      <div className="flex-shrink-0 w-24 text-center">
        <div className="text-[11px] font-mono font-bold text-sky-700 dark:text-sky-300">{timeLabel}</div>
        {isNow && (
          <Badge className="mt-1 text-[9px] bg-sky-500 text-white">NOW</Badge>
        )}
      </div>
      <div className="flex-1 min-w-0 border-l border-sky-200 dark:border-sky-800 pl-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-sm break-words">{event.subject}</p>
          {event.webLink && (
            <a
              href={event.webLink}
              target="_blank"
              rel="noreferrer"
              className="text-sky-600 hover:text-sky-800"
              title="Open in Outlook"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
          {event.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {event.location}
            </span>
          )}
          {event.attendeeCount > 0 && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" /> {event.attendeeCount}
            </span>
          )}
          {event.isOnlineMeeting && (
            <span className="flex items-center gap-1 text-sky-600">
              <Video className="w-3 h-3" /> Online
            </span>
          )}
        </div>
        {event.preview && (
          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{event.preview}</p>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

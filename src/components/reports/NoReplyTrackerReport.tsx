import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Printer, CalendarIcon, Loader2, BellRing, Search, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format, subDays, startOfDay, endOfDay, startOfWeek, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';

type RangePreset = 'today' | 'week' | 'month' | '30days' | 'custom';

interface TrackerRow {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  subject: string | null;
  to_recipients: any;
  cc_recipients: any;
  bcc_alias: string | null;
  days_after_send: number | null;
  sent_at: string;
  due_at: string | null;
  status: string;
  reminder_count: number | null;
  replied_at: string | null;
  cancelled_at: string | null;
  drafted_at: string | null;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'missed_1', label: 'Missed 1' },
  { value: 'missed_2', label: 'Missed 2' },
  { value: 'missed_3', label: 'Missed 3+' },
  { value: 'replied', label: 'Replied' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function deriveStatus(r: TrackerRow): { key: string; label: string; tone: 'pending' | 'missed' | 'replied' | 'done' | 'cancel' } {
  if (r.status === 'replied') return { key: 'replied', label: 'Replied', tone: 'replied' };
  if (r.status === 'completed') return { key: 'completed', label: 'Completed', tone: 'done' };
  if (r.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'cancel' };
  if (r.status === 'missed' || (r.reminder_count ?? 0) > 0) {
    const n = Math.min(r.reminder_count ?? 1, 3);
    return { key: `missed_${n}`, label: `Missed ${n}${n === 3 ? '+' : ''}`, tone: 'missed' };
  }
  return { key: 'pending', label: 'Pending', tone: 'pending' };
}

function rangeBounds(preset: RangePreset, custom?: { start?: Date; end?: Date }): { start: Date; end: Date } {
  const now = new Date();
  if (preset === 'today') return { start: startOfDay(now), end: endOfDay(now) };
  if (preset === 'week') return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(now) };
  if (preset === 'month') return { start: startOfMonth(now), end: endOfDay(now) };
  if (preset === '30days') return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
  return {
    start: startOfDay(custom?.start ?? subDays(now, 30)),
    end: endOfDay(custom?.end ?? now),
  };
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function recipientLabel(to: any): string {
  if (!to) return '';
  const arr = Array.isArray(to) ? to : [];
  return arr
    .map((r: any) => r?.email || r?.address || r?.emailAddress?.address || r?.name)
    .filter(Boolean)
    .join(', ');
}

export function NoReplyTrackerReport() {
  const { user, organization } = useAuth();
  const { activeConnection } = useActiveEmail();
  const [preset, setPreset] = useState<RangePreset>('30days');
  const [customStart, setCustomStart] = useState<Date | undefined>(subDays(new Date(), 30));
  const [customEnd, setCustomEnd] = useState<Date | undefined>(new Date());
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [trackingEnabled, setTrackingEnabled] = useState<boolean | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);

  const { start, end } = useMemo(
    () => rangeBounds(preset, { start: customStart, end: customEnd }),
    [preset, customStart, customEnd],
  );

  // Load follow_up_settings for the active connection to surface
  // "tracking disabled" and "last scanned" hints.
  useEffect(() => {
    if (!activeConnection?.id) {
      setTrackingEnabled(null);
      setLastScanAt(null);
      return;
    }
    supabase
      .from('follow_up_settings')
      .select('is_enabled, last_audit_at, updated_at')
      .eq('connection_id', activeConnection.id)
      .maybeSingle()
      .then(({ data }) => {
        setTrackingEnabled(data?.is_enabled ?? null);
        setLastScanAt((data?.last_audit_at as string | null) ?? (data?.updated_at as string | null) ?? null);
      });
  }, [activeConnection?.id, reloadKey]);

  useEffect(() => {
    if (!user?.id || !organization?.id) return;
    setLoading(true);
    let q = supabase
      .from('follow_up_trackers')
      .select('id,message_id,conversation_id,subject,to_recipients,cc_recipients,bcc_alias,days_after_send,sent_at,due_at,status,reminder_count,replied_at,cancelled_at,drafted_at')
      .eq('user_id', user.id)
      .gte('sent_at', start.toISOString())
      .lte('sent_at', end.toISOString())
      .order('sent_at', { ascending: false })
      .limit(500);
    if (activeConnection?.id) q = q.eq('connection_id', activeConnection.id);
    q.then(({ data, error }) => {
      if (error) console.error(error);
      setRows((data as TrackerRow[]) ?? []);
      setLoading(false);
    });
  }, [user?.id, organization?.id, activeConnection?.id, start, end, reloadKey]);

  const handleScanNow = async (silent = false) => {
    if (!activeConnection?.id) {
      if (!silent) toast.error('Pick an active email account first.');
      return;
    }
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('cron-follow-ups', {
        body: { mode: 'manual', connection_id: activeConnection.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const added = Number((data as any)?.added ?? 0);
      if (!silent) {
        toast.success(
          added > 0
            ? `Found ${added} new tracked email${added === 1 ? '' : 's'}.`
            : 'Scan complete — no new BCC-tracked emails found.',
        );
      }
      setReloadKey((k) => k + 1);
    } catch (e) {
      if (!silent) toast.error((e as Error).message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  // Auto-scan on mount and whenever the active range/connection changes.
  // Debounced so rapid filter changes only trigger one scan.
  useEffect(() => {
    if (!activeConnection?.id) return;
    const t = setTimeout(() => { void handleScanNow(true); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id, preset, customStart?.getTime(), customEnd?.getTime()]);

  const handleEnableTracking = async () => {
    if (!activeConnection?.id) return;
    const { error } = await supabase
      .from('follow_up_settings')
      .update({ is_enabled: true })
      .eq('connection_id', activeConnection.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('No-reply tracking enabled for this account.');
    setReloadKey((k) => k + 1);
  };


  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all') {
        const d = deriveStatus(r);
        if (d.key !== statusFilter) return false;
      }
      if (s) {
        const hay = `${r.subject ?? ''} ${recipientLabel(r.to_recipients)} ${r.bcc_alias ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  const handleExport = () => {
    const headers = ['Sent At', 'Recipient', 'Subject', 'BCC Alias', 'Days', 'Expected Reply By', 'Status', 'Reminders Sent', 'Replied At'];
    const lines = [headers.join(',')];
    filtered.forEach((r) => {
      const d = deriveStatus(r);
      lines.push(
        [
          format(new Date(r.sent_at), 'yyyy-MM-dd HH:mm'),
          recipientLabel(r.to_recipients),
          r.subject ?? '',
          r.bcc_alias ?? '',
          r.days_after_send ?? '',
          r.due_at ? format(new Date(r.due_at), 'yyyy-MM-dd HH:mm') : '',
          d.label,
          r.reminder_count ?? 0,
          r.replied_at ? format(new Date(r.replied_at), 'yyyy-MM-dd HH:mm') : '',
        ]
          .map(csvEscape)
          .join(','),
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `no-reply-tracker-${format(start, 'yyyyMMdd')}-${format(end, 'yyyyMMdd')}.csv`;
    a.click();
  };

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=1100,height=1200');
    if (!w) return;
    const tbody = filtered
      .map((r) => {
        const d = deriveStatus(r);
        return `<tr>
          <td>${format(new Date(r.sent_at), 'MMM d, h:mm a')}</td>
          <td>${escapeHtml(recipientLabel(r.to_recipients))}</td>
          <td>${escapeHtml(r.subject ?? '')}</td>
          <td>${escapeHtml(r.bcc_alias ?? '')}</td>
          <td>${r.due_at ? format(new Date(r.due_at), 'MMM d') : ''}</td>
          <td><b>${d.label}</b></td>
          <td>${r.replied_at ? format(new Date(r.replied_at), 'MMM d, h:mm a') : '—'}</td>
        </tr>`;
      })
      .join('');
    w.document.write(`<!doctype html><html><head><title>No-Reply Tracker</title>
      <style>
        body{font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a;margin:24px;}
        h1{font-size:20px;margin:0 0 4px;} .sub{color:#64748b;font-size:12px;margin-bottom:18px;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top;}
        th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:10px;letter-spacing:.05em;}
        @page{size:Letter landscape;margin:0.4in;}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #0ea5e9;padding-bottom:8px;margin-bottom:16px;">
        <div><h1>No-Reply Tracker Report</h1><div class="sub">${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')} · ${filtered.length} record${filtered.length === 1 ? '' : 's'}</div></div>
        <div style="color:#0ea5e9;font-weight:700;">InboxIQ</div>
      </div>
      <table><thead><tr>
        <th>Sent</th><th>Recipient</th><th>Subject</th><th>BCC</th><th>Expected By</th><th>Status</th><th>Replied</th>
      </tr></thead><tbody>${tbody || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px;">No records.</td></tr>`}</tbody></table>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 200);
  };

  return (
    <Card className="border-0 shadow-md">
      <CardHeader>
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="w-5 h-5 text-rose-500" />
              No-Reply Tracker Report
            </CardTitle>
            <CardDescription>
              Every email you BCC'd with a number alias (e.g. <code>3@…</code>) is tracked here. See who hasn't replied, how many reminders went out, and when they finally responded.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={() => handleScanNow(false)} disabled={scanning || !activeConnection?.id}>
              {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              {scanning ? 'Scanning…' : 'Scan now'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!filtered.length}>
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
          </div>
        </div>
        {(trackingEnabled === false || lastScanAt) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {trackingEnabled === false && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>No-reply tracking is OFF for this account — new BCC'd emails won't be picked up.</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleEnableTracking}>
                  Enable
                </Button>
              </div>
            )}
            {lastScanAt && (
              <span className="text-muted-foreground">
                Last scanned {format(new Date(lastScanAt), "MMM d, h:mm a")}
              </span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="30days">Last 30 days</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[140px] justify-start text-left font-normal', !customStart && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customStart ? format(customStart, 'MMM d, yyyy') : 'Start'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customStart} onSelect={setCustomStart} initialFocus />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[140px] justify-start text-left font-normal', !customEnd && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customEnd ? format(customEnd, 'MMM d, yyyy') : 'End'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px] max-w-[320px]">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, recipient, alias…"
              className="pl-8"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No tracker records match these filters.
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Sent</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-[110px]">BCC Alias</TableHead>
                  <TableHead className="w-[140px]">Expected By</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[150px]">Replied At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const d = deriveStatus(r);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-mono">{format(new Date(r.sent_at), 'MMM d, h:mm a')}</TableCell>
                      <TableCell className="text-sm">{recipientLabel(r.to_recipients) || '—'}</TableCell>
                      <TableCell className="text-sm max-w-[300px] truncate" title={r.subject ?? ''}>{r.subject ?? '(no subject)'}</TableCell>
                      <TableCell className="text-xs font-mono">{r.bcc_alias ?? '—'}</TableCell>
                      <TableCell className="text-xs">{r.due_at ? format(new Date(r.due_at), 'MMM d, h:mm a') : '—'}</TableCell>
                      <TableCell>
                        <StatusBadge tone={d.tone} label={d.label} />
                      </TableCell>
                      <TableCell className="text-xs">{r.replied_at ? format(new Date(r.replied_at), 'MMM d, h:mm a') : '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Showing {filtered.length} of {rows.length} records in this range.
        </p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ tone, label }: { tone: 'pending' | 'missed' | 'replied' | 'done' | 'cancel'; label: string }) {
  const styles: Record<typeof tone, string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    missed: 'bg-rose-100 text-rose-800 border-rose-200',
    replied: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    done: 'bg-sky-100 text-sky-800 border-sky-200',
    cancel: 'bg-slate-100 text-slate-700 border-slate-200',
  } as const;
  return <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wide', styles[tone])}>{label}</Badge>;
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

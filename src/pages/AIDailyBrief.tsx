import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  RefreshCw, 
  Sun, 
  AlertTriangle, 
  Calendar, 
  Mail, 
  Lightbulb,
  Clock,
  CheckCircle2,
  Printer,
  Settings2,
  ChevronDown,
  ChevronUp,
  Send,
  CalendarClock,
  History,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DailyBriefSchedule } from '@/components/app/DailyBriefSchedule';
import { HelpDot } from '@/components/help/HelpDot';
import { FeatureCard } from '@/components/ui/feature-card';
import { StatCard } from '@/components/ui/stat-card';
import { useAuth } from '@/lib/auth';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import energyForwardLogo from '@/assets/energyforward-logo.png';
import { ActionItemsPanel } from '@/components/daily-brief/ActionItemsPanel';

import { BellRing, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

interface DailyBrief {
  greeting: string;
  summary: string;
  priorities: Array<{
    title: string;
    description: string;
    urgency: 'high' | 'medium' | 'low';
    type: 'email' | 'meeting' | 'task';
  }>;
  schedule: Array<{
    time: string;
    title: string;
    type: string;
    description?: string;
  }>;
  emailHighlights: Array<{
    from: string;
    subject: string;
    preview?: string;
    action: string;
    urgency?: 'high' | 'medium' | 'low';
  }>;
  suggestions: string[];
  aiAnalysis?: {
    headline?: string;
    whatToDoFirst?: Array<{ step?: number; action: string; why?: string; estimatedMinutes?: number }>;
    risks?: string[];
    wins?: string[];
  };
  actionPlan?: Array<{
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
  }>;
}

const defaultColors = {
  high: { bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/20' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/20' },
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20' },
};

const typeIcons = {
  email: Mail,
  meeting: Calendar,
  task: CheckCircle2,
};

export default function AIDailyBrief() {
  const { activeConnection } = useActiveEmail();
  const { profile } = useAuth();
  const firstName = (profile?.full_name || profile?.email || 'there').split(/[ @]/)[0];
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  
  // Priority color settings
  const [priorityColors, setPriorityColors] = useState({
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#10b981',
  });

  const { data: brief, isLoading, refetch, error } = useQuery({
    queryKey: ['daily-brief', activeConnection?.id],
    queryFn: async (): Promise<DailyBrief> => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-daily-brief`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          connectionId: activeConnection?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Surface backend guidance for re-auth flows
        if (response.status === 401 && typeof errorData?.details === 'string') {
          throw new Error(errorData.details);
        }

        throw new Error(errorData.error || 'Failed to fetch daily brief');
      }

      return response.json();
    },
    enabled: !!activeConnection,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      // Don't retry auth errors
      if (error instanceof Error && error.message === 'Not authenticated') {
        return false;
      }
      return failureCount < 2;
    },
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('Daily brief refreshed');
    } catch (error) {
      toast.error('Failed to refresh daily brief');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleEmailMe = async () => {
    setIsEmailing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-daily-brief`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          force: true,
          userId: user.id,
          briefType: new Date().getHours() < 14 ? 'morning' : 'evening',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || 'Failed to send brief');
      }
      if (json?.sent > 0) {
        toast.success('Daily brief emailed to you (with PDF attached).');
      } else {
        toast.message('No matching schedule was found. Configure one below to enable email delivery.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to email brief');
    } finally {
      setIsEmailing(false);
    }
  };

  const handlePrint = (type: 'all' | 'priorities' | 'calendar' | 'todo') => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !brief) return;

    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      return String(v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const appName = 'InboxIQ';
    const email = activeConnection?.email || profile?.email || 'N/A';
    const fullName = profile?.full_name || firstName || '';

    const ap = (brief.actionPlan || []) as any[];
    const openItems = ap.filter((i) => i.status !== 'done');
    const emailItems = openItems.filter((i) => (i.source || 'email') === 'email');
    const meetingItems = openItems.filter((i) => i.source === 'meeting');
    const taskItems = openItems.filter((i) => i.source === 'task');

    const urgColor = (u?: string) =>
      u === 'high' ? priorityColors.high : u === 'low' ? priorityColors.low : priorityColors.medium;

    const renderItem = (it: any, i: number) => `
      <div class="pi-item">
        <div class="pi-num" style="background:${urgColor(it.urgency)}">${esc(it.priority ?? i + 1)}</div>
        <div class="pi-body">
          <div class="pi-top">
            <strong>${esc(it.title)}</strong>
            <span class="pi-urg" style="background:${urgColor(it.urgency)}">${esc(it.urgency || 'medium')}</span>
          </div>
          ${(it.from || it.subject || it.receivedAt) ? `<div class="pi-meta">${[it.from && `From <strong>${esc(it.from)}</strong>`, it.subject && esc(it.subject), it.receivedAt && esc(it.receivedAt)].filter(Boolean).join(' · ')}</div>` : ''}
          ${it.carriedFromDate ? `<div class="pi-carry">↻ Carried from ${esc(it.carriedFromDate)}${it.carryCount > 1 ? ` (×${esc(it.carryCount)})` : ''}</div>` : ''}
          ${it.context ? `<div class="pi-ctx"><span>Context:</span> ${esc(it.context)}</div>` : ''}
          ${it.action ? `<div class="pi-do"><span>Do:</span> ${esc(it.action)}</div>` : ''}
          ${it.why ? `<div class="pi-why">Why: ${esc(it.why)}</div>` : ''}
          ${it.estimatedMinutes ? `<div class="pi-min">⏱ ~${esc(it.estimatedMinutes)} min</div>` : ''}
        </div>
      </div>`;

    const sectionHeader = (label: string, kind: string) => `
      <header class="page-head">
        <div>
          <div class="ph-title">${esc(appName)} Daily Brief · ${esc(label)}</div>
          <div class="ph-sub">${esc(fullName)} · ${esc(email)} · ${esc(today)} · ${esc(kind)}</div>
        </div>
        <img src="${window.location.origin}${energyForwardLogo}" alt="EnergyForward" class="ph-logo" onerror="this.style.display='none'" />
      </header>`;

    const buildSection = (title: string, kind: string, body: string, emptyMsg?: string) => `
      <section class="page">
        ${sectionHeader(title, kind)}
        <div class="page-body">${body || `<p class="empty">${esc(emptyMsg || 'Nothing here.')}</p>`}</div>
      </section>`;

    let pages = '';

    // Action Items split: Emails, Calendar, Tasks
    if (type === 'all' || type === 'todo' || type === 'priorities') {
      pages += buildSection(
        'Action Items — Emails', 'Email',
        emailItems.length ? emailItems.map(renderItem).join('') : '',
        'No email action items today.',
      );
      pages += buildSection(
        'Action Items — Calendar', 'Calendar',
        meetingItems.length ? meetingItems.map(renderItem).join('') : '',
        'No calendar action items today.',
      );
      if (taskItems.length) {
        pages += buildSection('Action Items — Tasks', 'Tasks', taskItems.map(renderItem).join(''));
      }
    }

    // Today's Schedule
    if (type === 'all' || type === 'calendar') {
      const booked = (brief.schedule || []).filter((s) => {
        const t = (s.type || '').toLowerCase();
        const ti = (s.title || '').toLowerCase();
        if (t === 'focus' || t === 'available' || t === 'free') return false;
        if (ti.includes('available')) return false;
        return true;
      });
      const body = booked.length
        ? booked.map((s) => `
            <div class="sch-row">
              <span class="sch-time">${esc(s.time)}</span>
              <div class="sch-body">
                <strong>${esc(s.title)}</strong>
                ${s.description ? `<p>${esc(s.description)}</p>` : ''}
              </div>
            </div>`).join('')
        : '';
      pages += buildSection("Today's Schedule", 'Calendar', body, 'No meetings scheduled for today.');
    }

    // Final Tasks list — one explicit checkbox task per action item
    // (emails to reply, meetings to attend/prep, follow-ups to do).
    if (type === 'all' || type === 'todo') {
      const srcIcon = (s?: string) => s === 'meeting' ? '📅' : s === 'task' ? '✅' : '📧';
      const srcLabel = (s?: string) => s === 'meeting' ? 'Meeting' : s === 'task' ? 'Task' : 'Email';
      const body = openItems.length
        ? `<ul class="todo">${openItems.map((it, i) => `
            <li>
              <div class="todo-line">
                <span class="todo-box">☐</span>
                <span class="todo-num">${esc(it.priority ?? i + 1)}.</span>
                <span class="todo-src">${srcIcon(it.source)} ${esc(srcLabel(it.source))}</span>
                <strong class="todo-title">${esc(it.title)}</strong>
                <span class="todo-urg" style="background:${urgColor(it.urgency)}">${esc(it.urgency || 'medium')}</span>
                ${it.estimatedMinutes ? `<span class="todo-min">⏱ ${esc(it.estimatedMinutes)}m</span>` : ''}
              </div>
              ${(it.from || it.subject) ? `<div class="todo-meta">${[it.from && `From ${esc(it.from)}`, it.subject && esc(it.subject)].filter(Boolean).join(' · ')}</div>` : ''}
              ${it.action ? `<div class="todo-do"><span>Do:</span> ${esc(it.action)}</div>` : ''}
            </li>`).join('')}</ul>`
        : '';
      pages += buildSection('Tasks — What To Do', 'Tasks', body, 'No open tasks.');
    }


    // Priority Tips / Suggestions
    if (type === 'all') {
      if (brief.suggestions?.length) {
        pages += buildSection(
          'Priority Tips', 'Tips',
          `<ul class="tips">${brief.suggestions.map((s: any) => `<li>${esc(typeof s === 'string' ? s : s?.suggestion || '')}</li>`).join('')}</ul>`,
        );
      }
    }

    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>${esc(appName)} - Daily Brief</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #0f172a; margin: 0; }
  @page { size: Letter; margin: 0.5in; }
  .page { page-break-after: always; padding: 0; }
  .page:last-child { page-break-after: auto; }
  .page-head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; border-bottom: 3px solid #0ea5e9; margin-bottom: 18px; }
  .ph-title { font-size: 18px; font-weight: 700; }
  .ph-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
  .ph-logo { height: 56px; }
  .page-body { font-size: 13px; }
  .empty { color: #94a3b8; font-style: italic; padding: 24px 0; text-align: center; }
  .pi-item { display: flex; gap: 10px; padding: 12px 14px; margin: 8px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; break-inside: avoid; page-break-inside: avoid; }
  .pi-num { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; color: #fff; font-weight: 700; text-align: center; line-height: 28px; font-size: 13px; }
  .pi-body { flex: 1; min-width: 0; }
  .pi-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .pi-top strong { font-size: 14px; }
  .pi-urg { font-size: 9px; text-transform: uppercase; color: #fff; padding: 2px 7px; border-radius: 10px; font-weight: 700; letter-spacing: 0.5px; }
  .pi-meta { font-size: 11px; color: #64748b; margin-top: 4px; }
  .pi-carry { font-size: 10px; color: #b45309; background: #fef3c7; display: inline-block; padding: 2px 6px; border-radius: 4px; margin-top: 4px; font-weight: 600; }
  .pi-ctx { margin-top: 6px; padding: 6px 8px; background: #fff; border-radius: 4px; }
  .pi-ctx span, .pi-do span { font-weight: 600; color: #047857; }
  .pi-ctx span { color: #475569; }
  .pi-do { margin-top: 4px; }
  .pi-why { margin-top: 3px; font-size: 11px; font-style: italic; color: #64748b; }
  .pi-min { margin-top: 4px; font-size: 11px; font-weight: 700; color: #4338ca; }
  .sch-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f1f5f9; break-inside: avoid; }
  .sch-time { width: 110px; font-family: monospace; color: #0ea5e9; font-weight: 600; }
  .sch-body strong { font-size: 13px; }
  .sch-body p { margin: 3px 0 0; color: #64748b; font-size: 12px; }
  .todo, .tips { list-style: none; padding: 0; margin: 0; }
  .todo li, .tips li { padding: 10px 12px; margin: 6px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; break-inside: avoid; }
  .tips li::before { content: "💡 "; }
  .todo-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .todo-box { font-size: 16px; color: #0ea5e9; }
  .todo-num { font-weight: 700; color: #475569; min-width: 22px; }
  .todo-src { font-size: 11px; color: #475569; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
  .todo-title { flex: 1; font-size: 13px; }
  .todo-urg { font-size: 9px; text-transform: uppercase; color: #fff; padding: 2px 7px; border-radius: 10px; font-weight: 700; letter-spacing: 0.5px; }
  .todo-min { font-size: 11px; font-weight: 700; color: #4338ca; }
  .todo-meta { font-size: 11px; color: #64748b; margin: 4px 0 0 30px; }
  .todo-do { font-size: 12px; margin: 4px 0 0 30px; color: #0f172a; }
  .todo-do span { font-weight: 700; color: #047857; margin-right: 4px; }

  @media print { .page { padding: 0; } }
</style></head>
<body>${pages}</body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  const currentHour = new Date().getHours();
  const timeOfDay = currentHour < 12 ? 'morning' : currentHour < 17 ? 'afternoon' : 'evening';

  const getUrgencyStyle = (urgency: 'high' | 'medium' | 'low') => {
    return {
      backgroundColor: urgency === 'high' ? `${priorityColors.high}15` :
                       urgency === 'medium' ? `${priorityColors.medium}15` : `${priorityColors.low}15`,
      borderColor: urgency === 'high' ? `${priorityColors.high}30` :
                   urgency === 'medium' ? `${priorityColors.medium}30` : `${priorityColors.low}30`,
      color: urgency === 'high' ? priorityColors.high :
             urgency === 'medium' ? priorityColors.medium : priorityColors.low,
    };
  };

  if (!activeConnection) {
    return (
      <div className="min-h-full p-4 lg:p-6">
        <div className="flex flex-col items-center justify-center py-20">
          <Sun className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect an Email</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Connect your email account to see your personalized daily brief with priorities, schedule, and action items.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell" style={{ background: 'var(--bg)' }} ref={printRef}>
      <div className="page-shell-sticky space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleEmailMe} disabled={isEmailing}>
          <Send className={cn('w-4 h-4 mr-2', isEmailing && 'animate-pulse')} />
          {isEmailing ? 'Sending…' : 'Email me'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => handlePrint('all')}>
          <Printer className="w-4 h-4 mr-2" /> Print
        </Button>
        <Button size="sm" onClick={handleRefresh} disabled={isLoading || isRefreshing}>
          <RefreshCw className={cn('w-4 h-4 mr-2', (isLoading || isRefreshing) && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Vibrant FeatureCard — AI Analysis hero */}
      {brief?.aiAnalysis ? (
        <div className="mb-6">
          <FeatureCard
            eyebrow="AI Analysis · What to do first"
            title={`Good ${timeOfDay}, ${firstName}`}
          >
            {brief.aiAnalysis.headline || brief.summary || 'Your daily brief is ready below.'}
          </FeatureCard>
        </div>
      ) : (
        <div className="mb-6">
          <FeatureCard eyebrow="Daily Brief" title={`Good ${timeOfDay}, ${firstName}`}>
            {brief?.summary || `Here's a snapshot of your day. Review priorities and email highlights below.`}
          </FeatureCard>
        </div>
      )}
      </div>

      <div className="page-shell-content">
      {/* 4-up StatCard grid */}
      {brief && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Priorities" value={String(brief.priorities?.length ?? 0)} />
          <StatCard label="Meetings Today" value={String((brief.schedule || []).filter(s => {
            const t = (s.type || '').toLowerCase();
            return !(t === 'focus' || t === 'available' || t === 'free');
          }).length)} />
          <StatCard label="Carry-over" value={String((brief.actionPlan || []).filter((i: any) => i.carriedFromDate).length)} />
          <StatCard label="Quick Wins" value={String(brief.aiAnalysis?.wins?.length ?? 0)} />
        </div>
      )}

      {/* Unified Action Items — split into Emails / Calendar / Tasks. */}
      {brief?.actionPlan && brief.actionPlan.length > 0 ? (
        <>
          <ActionItemsPanel
            items={brief.actionPlan as any}
            priorityColors={priorityColors}
            onChanged={() => refetch()}
            onPrint={() => handlePrint('all')}
          />
          {(brief.aiAnalysis?.risks?.length || brief.aiAnalysis?.wins?.length) ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {brief.aiAnalysis?.risks && brief.aiAnalysis.risks.length > 0 && (
                <div className="rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--c-rose) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--c-rose) 30%, transparent)' }}>
                  <p className="text-overline mb-2 flex items-center gap-1.5" style={{ color: 'var(--c-rose)' }}>
                    <AlertTriangle className="w-3.5 h-3.5" /> At Risk
                  </p>
                  <ul className="text-body-2 list-disc pl-5 space-y-1" style={{ color: 'var(--text-body)' }}>
                    {brief.aiAnalysis.risks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {brief.aiAnalysis?.wins && brief.aiAnalysis.wins.length > 0 && (
                <div className="rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--c-green) 12%, var(--surface))', border: '1px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                  <p className="text-overline mb-2 flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Quick Wins
                  </p>
                  <ul className="text-body-2 list-disc pl-5 space-y-1" style={{ color: 'var(--text-body)' }}>
                    {brief.aiAnalysis.wins.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : (
        /* Legacy AI Analysis details (steps + risks/wins) — shown only when no actionPlan */
        brief?.aiAnalysis && (brief.aiAnalysis.whatToDoFirst?.length || brief.aiAnalysis.risks?.length || brief.aiAnalysis.wins?.length) ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {brief.aiAnalysis.whatToDoFirst && brief.aiAnalysis.whatToDoFirst.length > 0 && (
              <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <h3 className="text-h6 mb-3" style={{ color: 'var(--text)' }}>What to do first</h3>
                <ol className="space-y-2">
                  {brief.aiAnalysis.whatToDoFirst.map((item, i) => (
                    <li key={i} className="flex gap-3 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                      <div className="flex-shrink-0 w-7 h-7 rounded-full text-white text-sm font-bold grid place-items-center" style={{ background: 'var(--c-blue)' }}>
                        {item.step ?? i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-button" style={{ color: 'var(--text)' }}>{item.action}</p>
                        {item.why && <p className="text-caption mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.why}</p>}
                        {item.estimatedMinutes && <p className="text-caption font-semibold mt-1" style={{ color: 'var(--c-blue)' }}>~{item.estimatedMinutes} min</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="space-y-4">
              {brief.aiAnalysis.risks && brief.aiAnalysis.risks.length > 0 && (
                <div className="rounded-2xl p-5" style={{ background: 'color-mix(in srgb, var(--c-rose) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--c-rose) 30%, transparent)' }}>
                  <p className="text-overline mb-2 flex items-center gap-1.5" style={{ color: 'var(--c-rose)' }}>
                    <AlertTriangle className="w-3.5 h-3.5" /> At Risk
                  </p>
                  <ul className="text-body-2 list-disc pl-5 space-y-1" style={{ color: 'var(--text-body)' }}>
                    {brief.aiAnalysis.risks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {brief.aiAnalysis.wins && brief.aiAnalysis.wins.length > 0 && (
                <div className="rounded-2xl p-5" style={{ background: 'color-mix(in srgb, var(--c-green) 12%, var(--surface))', border: '1px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                  <p className="text-overline mb-2 flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Quick Wins
                  </p>
                  <ul className="text-body-2 list-disc pl-5 space-y-1" style={{ color: 'var(--text-body)' }}>
                    {brief.aiAnalysis.wins.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : null
      )}

      <PendingFromYesterdaySection connectionId={activeConnection?.id} />


      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Skeleton className="h-[400px] lg:col-span-2" />
            <Skeleton className="h-[400px]" />
          </div>
        </div>
      ) : error ? (
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center justify-center py-10">
            <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
            <p className="text-destructive font-medium">Failed to load daily brief</p>
            <p className="text-sm text-muted-foreground mb-4">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <Button variant="outline" onClick={handleRefresh}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : brief ? (
        <div className="space-y-6">
          {/* SECTION 3 — Today's Priorities (executive top focus). Hidden when Action Plan is present to avoid duplication. */}
          {!(brief.actionPlan && brief.actionPlan.length > 0) && (
          <Card data-tour="brief-priorities" className="border-0 shadow-lg overflow-hidden ring-1 ring-amber-200/60 dark:ring-amber-900/40">
            <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500" />
            <CardHeader className="pb-3 flex flex-row items-center justify-between bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20">
              <CardTitle className="text-lg flex items-center gap-3">
                <span className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md">
                  <AlertTriangle className="w-4 h-4" />
                </span>
                Today's Priorities
              </CardTitle>
              <Button data-tour="brief-print" variant="ghost" size="sm" onClick={() => handlePrint('todo')}>
                <Printer className="w-4 h-4 mr-1" />
                To-Do List
              </Button>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {brief.priorities && brief.priorities.length > 0 ? (
                  brief.priorities.map((priority, index) => {
                    const Icon = typeIcons[priority.type] || CheckCircle2;
                    return (
                      <div
                        key={index}
                        className="p-4 rounded-xl border shadow-sm hover:shadow-md transition-shadow bg-card"
                        style={{
                          borderLeftWidth: '4px',
                          borderLeftColor: priority.urgency === 'high' ? priorityColors.high :
                                          priority.urgency === 'medium' ? priorityColors.medium : priorityColors.low,
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <Icon
                            className="w-5 h-5 mt-0.5 flex-shrink-0"
                            style={{ color: priority.urgency === 'high' ? priorityColors.high :
                                           priority.urgency === 'medium' ? priorityColors.medium : priorityColors.low }}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">{priority.title}</span>
                              <Badge
                                variant="outline"
                                className="text-[10px] uppercase tracking-wide"
                                style={getUrgencyStyle(priority.urgency)}
                              >
                                {priority.urgency}
                              </Badge>
                            </div>
                            <p className="text-sm mt-1.5 text-muted-foreground leading-relaxed">{priority.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground text-center py-4 col-span-full">
                    No priorities identified for today
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          )}

          {/* SECTION 4 — Today's Schedule (full width; Email Highlights merged into Action Items above) */}
          <Card className="border-0 shadow-lg overflow-hidden ring-1 ring-blue-200/60 dark:ring-blue-900/40">
            <div className="h-1 bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500" />
            <CardHeader className="pb-3 flex flex-row items-center justify-between bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-950/20 dark:to-blue-950/20">
              <CardTitle className="text-lg flex items-center gap-3">
                <span className="p-2 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-md">
                  <CalendarClock className="w-4 h-4" />
                </span>
                Today's Schedule
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => handlePrint('calendar')}>
                <Printer className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="pt-5">
              <ScrollArea className="max-h-[420px]">
                <div className="space-y-2">
                  {(() => {
                    const bookedItems = (brief.schedule || []).filter(item => {
                      const type = (item.type || '').toLowerCase();
                      const title = (item.title || '').toLowerCase();
                      if (type === 'focus' || type === 'available' || type === 'free') return false;
                      if (title.includes('available for focus') || title.includes('available')) return false;
                      return true;
                    });
                    return bookedItems.length > 0 ? (
                      bookedItems.map((item, index) => (
                        <div
                          key={index}
                          className="flex gap-3 p-3 rounded-lg bg-card border border-sky-100 dark:border-sky-900/40 hover:shadow-sm transition-shadow"
                        >
                          <div className="flex-shrink-0 w-20 text-center">
                            <div className="text-xs font-mono font-bold text-sky-700 dark:text-sky-300 uppercase">
                              {item.time}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 border-l border-sky-200 dark:border-sky-800 pl-3">
                            <p className="font-medium text-sm break-words">{item.title}</p>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                            <Badge variant="outline" className="text-[10px] mt-1 border-sky-200 text-sky-700 dark:text-sky-300">
                              {item.type}
                            </Badge>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12">
                        <Calendar className="w-12 h-12 text-sky-300 mx-auto mb-3" />
                        <p className="text-muted-foreground text-sm font-medium">No meetings scheduled</p>
                        <p className="text-xs text-muted-foreground mt-1">A clear day for focused work.</p>
                      </div>
                    );
                  })()}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* SECTION 5 — No Reply Tracker (slim if empty) */}
          <PendingFollowUpsSection connectionId={activeConnection?.id} />

          {/* Optional summary line */}
          {((brief.schedule && brief.schedule.length > 0) ||
            (brief.emailHighlights && brief.emailHighlights.length > 0)) &&
            (brief.greeting || brief.summary) && (
            <Card className="border-0 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-900 dark:to-slate-900/60">
              <CardContent className="py-4">
                {brief.greeting && <p className="text-sm font-medium">{brief.greeting}</p>}
                {brief.summary && <p className="text-xs text-muted-foreground mt-1">{brief.summary}</p>}
              </CardContent>
            </Card>
          )}

          {/* SECTION 6 — Productivity Tips */}
          {brief.suggestions && brief.suggestions.length > 0 && (
            <Card className="border-0 shadow-md overflow-hidden ring-1 ring-emerald-200/60 dark:ring-emerald-900/40">
              <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
              <CardHeader className="pb-3 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20">
                <CardTitle className="text-base flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
                    <Lightbulb className="w-4 h-4" />
                  </span>
                  Productivity Tips
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {brief.suggestions.map((suggestion, index) => {
                    const text = typeof suggestion === 'string'
                      ? suggestion
                      : (suggestion as { suggestion?: string })?.suggestion || JSON.stringify(suggestion);
                    return (
                      <div
                        key={index}
                        className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 text-sm text-emerald-900 dark:text-emerald-100"
                      >
                        {text}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Daily Brief Schedule */}
          <div data-tour="brief-schedule">
            <DailyBriefSchedule />
          </div>

          {/* Settings Section */}
          <Card>
            <CardHeader
              className="pb-3 cursor-pointer"
              onClick={() => setShowSettings(!showSettings)}
            >
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-muted-foreground" />
                  Priority Color Settings
                </span>
                {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CardTitle>
            </CardHeader>
            {showSettings && (
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {(['high', 'medium', 'low'] as const).map((level) => (
                    <div key={level} className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-5 h-5 rounded-full border-2"
                          style={{ backgroundColor: priorityColors[level], borderColor: priorityColors[level] }}
                        />
                        <span className="text-sm font-medium capitalize">{level} Priority</span>
                      </div>
                      <label className="relative cursor-pointer">
                        <input
                          type="color"
                          value={priorityColors[level]}
                          onChange={(e) => setPriorityColors(prev => ({ ...prev, [level]: e.target.value }))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div
                          className="w-10 h-8 rounded-md border-2 border-border shadow-sm transition-all hover:scale-105"
                          style={{ backgroundColor: priorityColors[level] }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <Separator className="my-4" />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPriorityColors({ high: '#ef4444', medium: '#f59e0b', low: '#10b981' })}
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      ) : null}
      </div>
    </div>
  );
}

interface PendingFollowUp {
  id: string;
  subject: string | null;
  to_recipients: any;
  sent_at: string | null;
  due_at: string | null;
  reminder_count: number | null;
  status: string;
}

function PendingFollowUpsSection({ connectionId }: { connectionId?: string }) {
  const { hasFeature, loading: featLoading } = useFeatureAccess();

  const { data: items, isLoading } = useQuery({
    queryKey: ['daily-brief-pending-followups', connectionId],
    enabled: !!connectionId && !featLoading && hasFeature('feature.follow_up_reminder'),
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<PendingFollowUp[]> => {
      const { data, error } = await supabase
        .from('follow_up_trackers')
        .select('id, subject, to_recipients, sent_at, due_at, reminder_count, status')
        .eq('connection_id', connectionId!)
        .is('replied_at', null)
        .in('status', ['pending', 'drafted', 'reminded'])
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(25);
      if (error) throw error;
      return (data || []) as PendingFollowUp[];
    },
  });

  if (featLoading || !hasFeature('feature.follow_up_reminder')) return null;

  const formatRecipients = (r: any): string => {
    if (!r) return '';
    const arr = Array.isArray(r) ? r : [];
    const emails = arr
      .map((x: any) => x?.emailAddress?.address || x?.address || x?.email || '')
      .filter(Boolean);
    if (!emails.length) return '';
    return emails.length > 2 ? `${emails.slice(0, 2).join(', ')} +${emails.length - 2}` : emails.join(', ');
  };

  const overdueCount = (items || []).filter(
    (i) => i.due_at && new Date(i.due_at).getTime() < Date.now()
  ).length;

  // Empty → render a slim one-line bar so it doesn't dominate the page.
  if (!isLoading && (!items || items.length === 0)) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 px-3 py-2 rounded-md border bg-muted/30 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <BellRing className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
          <span className="truncate">
            <span className="font-medium text-foreground">No Reply Tracker:</span>{' '}
            All sent emails have replies. 🎉
          </span>
        </div>
        <Link
          to="/follow-up-reminder"
          className="text-primary hover:underline inline-flex items-center gap-1 flex-shrink-0"
        >
          Settings <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  return (
    <Card data-tour="brief-noreply" className="mb-6 border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-primary/10 text-primary mt-0.5">
            <BellRing className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              No Reply Tracker
              {items && items.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {items.length}
                </Badge>
              )}
              {overdueCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {overdueCount} overdue
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sent emails (BCC'd to a tracker alias) that haven't received a reply yet.
            </p>
          </div>
        </div>
        <Link
          to="/follow-up-reminder"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          Settings <ExternalLink className="w-3 h-3" />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-2">
            {(items || []).map((item) => {
              const overdue = item.due_at && new Date(item.due_at).getTime() < Date.now();
              const recipients = formatRecipients(item.to_recipients);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border transition-colors hover:bg-secondary/30',
                    overdue ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-amber-500'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm truncate">
                        {item.subject || '(no subject)'}
                      </p>
                      {(item.reminder_count ?? 0) > 0 && (
                        <Badge variant="outline" className="text-[10px] h-4">
                          {item.reminder_count} reminder{item.reminder_count === 1 ? '' : 's'} sent
                        </Badge>
                      )}
                    </div>
                    {recipients && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        To: {recipients}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {item.sent_at && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Sent {formatDistanceToNow(new Date(item.sent_at), { addSuffix: true })}
                        </span>
                      )}
                      {item.due_at && (
                        <span className={cn('font-medium', overdue && 'text-destructive')}>
                          {overdue ? 'Overdue' : 'Due'} {formatDistanceToNow(new Date(item.due_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Surfaces overdue follow-ups (pending from yesterday or earlier) so they
// jump the queue at the top of the brief.
function PendingFromYesterdaySection({ connectionId }: { connectionId?: string }) {
  const { hasFeature, loading: featLoading } = useFeatureAccess();

  const { data: items } = useQuery({
    queryKey: ['daily-brief-yesterday-pending', connectionId],
    enabled: !!connectionId && !featLoading && hasFeature('feature.follow_up_reminder'),
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<PendingFollowUp[]> => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('follow_up_trackers')
        .select('id, subject, to_recipients, sent_at, due_at, reminder_count, status')
        .eq('connection_id', connectionId!)
        .is('replied_at', null)
        .in('status', ['pending', 'drafted', 'reminded'])
        .lt('due_at', startOfToday.toISOString())
        .order('due_at', { ascending: true })
        .limit(15);
      if (error) throw error;
      return (data || []) as PendingFollowUp[];
    },
  });

  if (!items || items.length === 0) return null;

  const formatRecipients = (r: any): string => {
    if (!r) return '';
    const arr = Array.isArray(r) ? r : [];
    const emails = arr
      .map((x: any) => x?.emailAddress?.address || x?.address || x?.email || '')
      .filter(Boolean);
    if (!emails.length) return '';
    return emails.length > 2 ? `${emails.slice(0, 2).join(', ')} +${emails.length - 2}` : emails.join(', ');
  };

  return (
    <Card className="mb-6 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="w-5 h-5 text-amber-600" />
          Pending from Yesterday
          <Badge variant="destructive" className="text-xs">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map((item) => {
            const recipients = formatRecipients(item.to_recipients);
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-l-4 border-l-destructive bg-background/70"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.subject || '(no subject)'}</p>
                  {recipients && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">To: {recipients}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    {item.sent_at && (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Sent {formatDistanceToNow(new Date(item.sent_at), { addSuffix: true })}
                      </span>
                    )}
                    {item.due_at && (
                      <span className="font-medium text-destructive">
                        Overdue {formatDistanceToNow(new Date(item.due_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}


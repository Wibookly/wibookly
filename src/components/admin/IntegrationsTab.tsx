import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Mail, Calendar as CalendarIcon, FolderOpen, Building2, Users as TeamsIcon,
  Bot, Brain, MessageSquare, Sparkles, RefreshCw, Activity,
  CheckCircle2, AlertTriangle, Loader2, Play, Workflow, Inbox, BellRing,
  ExternalLink, ShieldCheck, Key, Cable, Server, Cpu, Mic, FileText, ListChecks,
  LifeBuoy,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import M365IndexingPanel from './M365IndexingPanel';
import AzurePermissionsCheck from './AzurePermissionsCheck';
import AgentPanel from './AgentPanel';
import FollowUpsPanel from './FollowUpsPanel';

/* ============================ Registry ============================ */

type ServiceId =
  | 'mail' | 'calendar' | 'onedrive' | 'sharepoint' | 'teams_graph'
  | 'email_agent' | 'teams_bot' | 'chat_agent' | 'agent_orchestrator'
  | 'llm_gateway' | 'embeddings'
  | 'm365_sync' | 'ingest_emails' | 'process_ai_emails' | 'follow_ups'
  | 'indexing'
  | 'meeting_copilot_prep' | 'meeting_copilot_suggestion' | 'meeting_copilot_summary';

type Section = 'm365' | 'agents' | 'ai' | 'jobs' | 'connectors' | 'meeting_copilot';

interface ServiceDef {
  id: ServiceId;
  section: Section;
  name: string;
  description: string;
  icon: typeof Mail;
  apiName?: 'mail' | 'calendar' | 'onedrive' | 'sharepoint' | 'user';
  aiAction?: string;
  jobType?: string;
  syncSource?: string;
  functionName?: string;
  testable: boolean;
  /** Settings panel kind to render in the Settings tab. */
  settings?:
    | 'graph_scopes'
    | 'agent_email'
    | 'agent_teams'
    | 'llm_keys'
    | 'embeddings_keys'
    | 'job_schedule'
    | 'indexing'
    | 'orchestrator'
    | 'follow_ups';
  /** Required env secrets surfaced in the Settings tab. */
  requiredSecrets?: string[];
  docsLink?: { label: string; href: string };
}

const SERVICES: ServiceDef[] = [
  /* ---- Microsoft 365 (Graph) ---- */
  { id: 'mail', section: 'm365', name: 'Outlook Mail', description: 'Read mailboxes, threads, and attachments via Microsoft Graph.',
    icon: Mail, apiName: 'mail', testable: true, settings: 'graph_scopes' },
  { id: 'calendar', section: 'm365', name: 'Calendar', description: 'Meetings, scheduling, availability windows.',
    icon: CalendarIcon, apiName: 'calendar', testable: true, settings: 'graph_scopes' },
  { id: 'onedrive', section: 'm365', name: 'OneDrive', description: 'Personal file search & extraction.',
    icon: FolderOpen, apiName: 'onedrive', testable: true, settings: 'graph_scopes' },
  { id: 'sharepoint', section: 'm365', name: 'SharePoint', description: 'Tenant-wide file & site search.',
    icon: Building2, apiName: 'sharepoint', testable: true, settings: 'graph_scopes' },
  { id: 'teams_graph', section: 'm365', name: 'Teams (Graph)', description: 'Teams data access via Graph (channels, chats).',
    icon: TeamsIcon, apiName: 'user', testable: true, settings: 'graph_scopes' },

  /* ---- AI Agents (product-level) ---- */
  { id: 'email_agent', section: 'agents', name: 'AI Email Agent', description: 'Inbound mail → categorization, AI drafts, follow-ups.',
    icon: Mail, aiAction: 'ai_email_draft', functionName: 'process-ai-emails', testable: true, settings: 'agent_email' },
  { id: 'teams_bot', section: 'agents', name: 'Teams Bot', description: 'Conversational agent inside Microsoft Teams.',
    icon: TeamsIcon, functionName: 'teams-bot', testable: true, settings: 'agent_teams',
    requiredSecrets: ['TEAMS_BOT_APP_ID', 'TEAMS_BOT_APP_PASSWORD', 'TEAMS_BOT_TENANT_ID'] },
  { id: 'chat_agent', section: 'agents', name: 'Chat (Web)', description: 'Streaming /chat UI bridge to the orchestrator.',
    icon: MessageSquare, functionName: 'chat-agent', testable: true, settings: 'orchestrator' },
  { id: 'agent_orchestrator', section: 'agents', name: 'Agent Orchestrator', description: 'Multi-tool reasoning loop powering every agent surface.',
    icon: Bot, functionName: 'agent-orchestrator', testable: true, settings: 'orchestrator' },

  /* ---- AI Infrastructure ---- */
  { id: 'llm_gateway', section: 'ai', name: 'LLM Gateway', description: 'Routes OpenAI / Anthropic with quota & cost logging.',
    icon: Brain, aiAction: 'ai_chat', functionName: 'llm-gateway', testable: true, settings: 'llm_keys',
    requiredSecrets: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] },
  { id: 'embeddings', section: 'ai', name: 'Embeddings', description: 'text-embedding-3-small for retrieval (vector 1536).',
    icon: Sparkles, functionName: 'embed-text', testable: true, settings: 'embeddings_keys',
    requiredSecrets: ['OPENAI_API_KEY'] },

  /* ---- Background jobs ---- */
  { id: 'm365_sync', section: 'jobs', name: 'M365 Delta Sync', description: 'Hourly delta sync across all active connections.',
    icon: RefreshCw, syncSource: 'onedrive', functionName: 'm365-sync-all', testable: true, settings: 'job_schedule' },
  { id: 'ingest_emails', section: 'jobs', name: 'Email Ingest', description: 'Pulls recent mail into email_messages for retrieval.',
    icon: Inbox, jobType: 'email_ingest', functionName: 'cron-ingest-emails', testable: true, settings: 'job_schedule' },
  { id: 'process_ai_emails', section: 'jobs', name: 'AI Email Cron (scheduled trigger)', description: 'Scheduled pg_cron trigger that runs the AI Email Agent across all connections.',
    icon: Workflow, jobType: 'ai_email_processing', functionName: 'process-ai-emails', testable: true, settings: 'job_schedule' },
  { id: 'follow_ups', section: 'jobs', name: 'Follow-Up Reminders', description: 'BCC-triggered auto-reminders for sent mail.',
    icon: BellRing, jobType: 'follow_up_audit', functionName: 'cron-follow-ups', testable: true, settings: 'follow_ups' },

  /* ---- Connectors / indexing ---- */
  { id: 'indexing', section: 'connectors', name: 'Document Indexing', description: 'OneDrive / SharePoint / mail attachment extraction & embedding.',
    icon: Activity, testable: false, settings: 'indexing' },

  /* ---- Meeting Copilot ---- */
  { id: 'meeting_copilot_prep', section: 'meeting_copilot', name: 'Meeting Prep', description: 'Pre-meeting AI brief: context, questions to ask, talking points.',
    icon: FileText, aiAction: 'meeting_copilot_prep', functionName: 'meeting-copilot-prep', testable: true },
  { id: 'meeting_copilot_suggestion', section: 'meeting_copilot', name: 'Live Suggestions', description: 'Real-time "what to say / ask / answer" during the meeting.',
    icon: Mic, aiAction: 'meeting_copilot_suggestion', functionName: 'meeting-copilot-suggestion', testable: true },
  { id: 'meeting_copilot_summary', section: 'meeting_copilot', name: 'Recap & Email', description: 'Post-meeting summary, decisions, action items, follow-up email.',
    icon: ListChecks, aiAction: 'meeting_copilot_summary', functionName: 'meeting-copilot-summary', testable: true },
];

const SECTION_META: Record<Section, { title: string; description: string; icon: typeof Mail }> = {
  m365:            { title: 'Microsoft 365',         description: 'Graph surfaces & tenant access',         icon: Building2 },
  agents:          { title: 'AI Agents',             description: 'Email, Teams, Chat & orchestrator',     icon: Bot },
  ai:              { title: 'AI Infrastructure',     description: 'LLM gateway, embeddings, providers',    icon: Cpu },
  jobs:            { title: 'Background Jobs',       description: 'Scheduled crons & manual triggers',     icon: Server },
  connectors:      { title: 'Connectors & Indexing', description: 'Document extraction pipelines',         icon: Cable },
  meeting_copilot: { title: 'Meeting Copilot',       description: 'Prep · live suggestions · recap',       icon: Mic },
};

const SECTION_ORDER: Section[] = ['m365', 'agents', 'meeting_copilot', 'ai', 'jobs', 'connectors'];

/* ============================ Types ============================ */

type Status = 'healthy' | 'degraded' | 'failed' | 'idle' | 'unknown';

interface Snapshot {
  status: Status;
  lastActivityAt: string | null;
  lastMessage: string | null;
  latencyMs: number | null;
}
type SnapshotMap = Partial<Record<ServiceId, Snapshot>>;

interface HealthRow { api_name: string; status: string; endpoint: string | null; response_ms: number | null; error_code: string | null; error_message: string | null; checked_at: string; }
interface SyncJobRow { id: string; source: string; sync_type: string; status: string; items_processed: number; items_failed: number; error_message: string | null; created_at: string; }
interface JobRow { id: string; job_type: string; status: string; error_message: string | null; started_at: string | null; completed_at: string | null; created_at: string; }
interface UsageRow { action: string; status: string; provider: string; model: string; latency_ms: number | null; error_message: string | null; created_at: string; }

interface SecretStatus { name: string; configured: boolean }

interface RecoveryAttempt {
  service_id: ServiceId;
  service_name: string;
  at: number;
  trigger: 'auto-monitor' | 'manual';
  action: string;
  ok: boolean;
  message: string;
}

const RECOVERY_LS_KEY = 'admin.integrations.recoveryLog';
const MAX_RECOVERY_LOG = 100;

function loadRecoveryLog(): RecoveryAttempt[] {
  try {
    const raw = localStorage.getItem(RECOVERY_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function appendRecovery(entry: RecoveryAttempt) {
  try {
    const next = [entry, ...loadRecoveryLog()].slice(0, MAX_RECOVERY_LOG);
    localStorage.setItem(RECOVERY_LS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('admin:recovery-log-updated'));
  } catch { /* */ }
}

/* ============================ Helpers ============================ */

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function statusBadge(s: Status) {
  if (s === 'healthy')  return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">Healthy</Badge>;
  if (s === 'degraded') return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">Degraded</Badge>;
  if (s === 'failed')   return <Badge variant="destructive">Failed</Badge>;
  if (s === 'idle')     return <Badge variant="secondary">Idle</Badge>;
  return <Badge variant="outline">Unknown</Badge>;
}

function statusDot(s: Status) {
  const cls =
    s === 'healthy'  ? 'bg-emerald-500' :
    s === 'degraded' ? 'bg-amber-500'   :
    s === 'failed'   ? 'bg-destructive' :
    s === 'idle'     ? 'bg-muted-foreground/40' :
                       'bg-muted-foreground/30';
  return <span className={cn('inline-block h-2 w-2 rounded-full', cls)} />;
}

/* ============================ Main component ============================ */

interface Props {
  adminInvoke: (action: string, payload?: Record<string, any>) => Promise<any>;
  organizationId: string | null;
}

export default function IntegrationsTab({ adminInvoke, organizationId }: Props) {
  const { session } = useAuth();
  const { toast } = useToast();
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<ServiceId>('mail');
  const [testingId, setTestingId] = useState<ServiceId | null>(null);
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);

  const active = useMemo(() => SERVICES.find((s) => s.id === activeId) ?? SERVICES[0], [activeId]);

  const load = async () => {
    setLoading(true);
    try {
      const [healthRes, syncRes, jobsRes, usageRes, secretRes] = await Promise.all([
        supabase.from('m365_api_health')
          .select('api_name, status, endpoint, response_ms, error_code, error_message, checked_at')
          .order('checked_at', { ascending: false }).limit(500),
        supabase.from('m365_sync_jobs')
          .select('id, source, sync_type, status, items_processed, items_failed, error_message, created_at')
          .order('created_at', { ascending: false }).limit(200),
        supabase.from('jobs')
          .select('id, job_type, status, error_message, started_at, completed_at, created_at')
          .order('created_at', { ascending: false }).limit(200),
        supabase.from('ai_usage_logs')
          .select('action, status, provider, model, latency_ms, error_message, created_at')
          .order('created_at', { ascending: false }).limit(200),
        adminInvoke('check_secrets').catch(() => ({ secrets: [] })),
      ]);

      setSecrets(Array.isArray(secretRes?.secrets) ? secretRes.secrets : []);

      const snap: SnapshotMap = {};

      // Graph services
      const byApi = new Map<string, HealthRow[]>();
      for (const r of (healthRes.data ?? []) as HealthRow[]) {
        const arr = byApi.get(r.api_name) ?? []; arr.push(r); byApi.set(r.api_name, arr);
      }
      for (const svc of SERVICES.filter((s) => s.apiName)) {
        const latest = (byApi.get(svc.apiName!) ?? [])[0];
        snap[svc.id] = latest ? {
          status: (latest.status as Status) ?? 'unknown',
          lastActivityAt: latest.checked_at,
          lastMessage: latest.error_message || latest.endpoint || 'OK',
          latencyMs: latest.response_ms ?? null,
        } : { status: 'unknown', lastActivityAt: null, lastMessage: null, latencyMs: null };
      }

      // AI usage
      const usageRows = (usageRes.data ?? []) as UsageRow[];
      const latestAi = usageRows[0];
      for (const svc of SERVICES.filter((s) => s.section === 'ai' || s.section === 'agents' || s.section === 'meeting_copilot')) {
        const row = svc.aiAction
          ? usageRows.find((r) => r.action === svc.aiAction)
          : latestAi;
        snap[svc.id] = {
          status: !row ? 'idle' : row.status === 'success' ? 'healthy' : 'failed',
          lastActivityAt: row?.created_at ?? null,
          lastMessage: row?.error_message || (row ? `${row.provider}/${row.model}` : 'No recent activity'),
          latencyMs: row?.latency_ms ?? null,
        };
      }

      // Jobs
      const syncRows = (syncRes.data ?? []) as SyncJobRow[];
      const jobRows = (jobsRes.data ?? []) as JobRow[];
      const latestSync = syncRows[0];
      snap.m365_sync = {
        status: !latestSync ? 'idle'
          : latestSync.status === 'failed' ? 'failed'
          : latestSync.status === 'complete' ? 'healthy' : 'degraded',
        lastActivityAt: latestSync?.created_at ?? null,
        lastMessage: latestSync?.error_message || (latestSync ? `${latestSync.items_processed} ok · ${latestSync.items_failed} fail` : 'No runs yet'),
        latencyMs: null,
      };
      for (const svc of SERVICES.filter((s) => s.jobType)) {
        const row = jobRows.find((r) => r.job_type === svc.jobType);
        snap[svc.id] = {
          status: !row ? 'idle'
            : row.status === 'completed' || row.status === 'complete' ? 'healthy'
            : row.status === 'failed' ? 'failed' : 'degraded',
          lastActivityAt: row?.created_at ?? null,
          lastMessage: row?.error_message || row?.status || 'No runs yet',
          latencyMs: null,
        };
      }

      // Indexing aggregate
      const { data: docs } = await supabase.from('knowledge_documents')
        .select('extraction_status, updated_at')
        .in('source_type', ['mail_attachment', 'onedrive', 'sharepoint'])
        .order('updated_at', { ascending: false }).limit(500);
      const total = docs?.length ?? 0;
      const failed = docs?.filter((d: any) => d.extraction_status === 'failed').length ?? 0;
      snap.indexing = {
        status: total === 0 ? 'idle' : failed > total * 0.2 ? 'degraded' : 'healthy',
        lastActivityAt: (docs as any)?.[0]?.updated_at ?? null,
        lastMessage: total === 0 ? 'No M365 documents indexed yet' : `${total} documents indexed · ${failed} failed`,
        latencyMs: null,
      };

      setSnapshots(snap);
    } catch (e: any) {
      toast({ title: 'Failed to load integrations', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const runTest = async (svc: ServiceDef, opts?: { silent?: boolean }): Promise<boolean> => {
    if (!session?.access_token) return false;
    if (!opts?.silent) setTestingId(svc.id);
    try {
      const { data, error } = await supabase.functions.invoke('admin-integration-probe', {
        body: { service: svc.id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw new Error(error.message);
      const ok = !!data?.ok;
      if (!opts?.silent) {
        toast({
          title: ok ? `${svc.name}: OK` : `${svc.name}: failed`,
          description: `${data?.message ?? ''}${data?.latency_ms ? ` · ${data.latency_ms}ms` : ''}`,
          variant: ok ? 'default' : 'destructive',
        });
        await load();
      }
      return ok;
    } catch (e: any) {
      if (!opts?.silent) toast({ title: `${svc.name}: failed`, description: e.message, variant: 'destructive' });
      return false;
    } finally {
      if (!opts?.silent) setTestingId(null);
    }
  };

  /* ---- Auto-monitor: periodically re-test every testable service and
     auto-retry failures once to confirm a real outage. ---- */
  const [autoMonitor, setAutoMonitor] = useState<boolean>(() => {
    try { return localStorage.getItem('admin.integrations.autoMonitor') === '1'; } catch { return false; }
  });
  const [lastMonitorRun, setLastMonitorRun] = useState<number | null>(null);
  const [monitorAlerts, setMonitorAlerts] = useState<Array<{ id: ServiceId; name: string; message: string; at: number }>>([]);

  useEffect(() => {
    try { localStorage.setItem('admin.integrations.autoMonitor', autoMonitor ? '1' : '0'); } catch { /* */ }
  }, [autoMonitor]);

  useEffect(() => {
    if (!autoMonitor || !session?.access_token) return;
    let cancelled = false;
    const tick = async () => {
      const testable = SERVICES.filter((s) => s.testable);
      const alerts: Array<{ id: ServiceId; name: string; message: string; at: number }> = [];
      for (const svc of testable) {
        if (cancelled) return;
        const ok = await runTest(svc, { silent: true });
        if (!ok) {
          // retry once before alerting to avoid flapping
          await new Promise((r) => setTimeout(r, 1500));
          const retryOk = await runTest(svc, { silent: true });
          if (!retryOk) alerts.push({ id: svc.id, name: svc.name, message: 'Health probe failed twice in a row.', at: Date.now() });
        }
      }
      if (!cancelled) {
        setMonitorAlerts(alerts);
        setLastMonitorRun(Date.now());
        await load();
        if (alerts.length) {
          toast({
            title: `Auto-monitor: ${alerts.length} service${alerts.length === 1 ? '' : 's'} unhealthy`,
            description: alerts.map((a) => a.name).join(', '),
            variant: 'destructive',
          });
        }
      }
    };
    void tick();
    const id = setInterval(tick, 5 * 60 * 1000); // every 5 minutes
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMonitor, session?.access_token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const snap = snapshots[active.id] ?? { status: 'unknown' as Status, lastActivityAt: null, lastMessage: null, latencyMs: null };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      {/* ============== Left rail ============== */}
      <aside className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Integrations</h2>
          <p className="text-xs text-muted-foreground">All services, settings & audit in one place.</p>
        </div>
        <div className="rounded-md border bg-card/40 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="auto-monitor" className="text-xs font-medium cursor-pointer">
              Always-on auto-monitor
            </Label>
            <Switch id="auto-monitor" checked={autoMonitor} onCheckedChange={setAutoMonitor} />
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Re-tests every integration every 5 min and auto-retries failures once before alerting.
          </p>
          {autoMonitor && (
            <p className="text-[11px] text-muted-foreground">
              Last run: {lastMonitorRun ? timeAgo(new Date(lastMonitorRun).toISOString()) : '—'}
              {monitorAlerts.length > 0 && (
                <span className="ml-1 text-destructive">· {monitorAlerts.length} unhealthy</span>
              )}
            </p>
          )}
        </div>
        <ScrollArea className="lg:h-[calc(100vh-220px)] pr-2">
          <nav className="space-y-5">
            {SECTION_ORDER.map((section) => {
              const services = SERVICES.filter((s) => s.section === section);
              const SectionIcon = SECTION_META[section].icon;
              return (
                <div key={section} className="space-y-1">
                  <div className="flex items-center gap-2 px-2">
                    <SectionIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {SECTION_META[section].title}
                    </h3>
                  </div>
                  <div className="space-y-0.5">
                    {services.map((svc) => {
                      const s = snapshots[svc.id]?.status ?? 'unknown';
                      const Icon = svc.icon;
                      const isActive = activeId === svc.id;
                      return (
                        <button
                          key={svc.id}
                          onClick={() => setActiveId(svc.id)}
                          className={cn(
                            'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition',
                            'hover:bg-muted/60',
                            isActive && 'bg-muted text-foreground shadow-sm',
                            !isActive && 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-foreground')} />
                          <span className="flex-1 truncate">{svc.name}</span>
                          {statusDot(s)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* ============== Detail panel ============== */}
      <section className="space-y-4">
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="rounded-lg bg-primary/10 text-primary p-2.5 shrink-0">
                  <active.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-lg">{active.name}</CardTitle>
                    {statusBadge(snap.status)}
                  </div>
                  <CardDescription className="mt-1">{active.description}</CardDescription>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>Last activity: {timeAgo(snap.lastActivityAt)}</span>
                    {snap.latencyMs != null && <span>· {snap.latencyMs}ms</span>}
                    {active.functionName && (
                      <a
                        href={`https://supabase.com/dashboard/project/_/functions/${active.functionName}/logs`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        Edge logs <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
              {active.testable && (
                <Button
                  size="sm"
                  variant="default"
                  disabled={testingId === active.id}
                  onClick={() => runTest(active)}
                  className="shrink-0"
                >
                  {testingId === active.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  <span className="ml-1.5">Run test</span>
                </Button>
              )}
            </div>
          </CardHeader>
        </Card>

        <Tabs defaultValue="overview" key={active.id} className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Settings</TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5"><Server className="h-3.5 w-3.5" /> Audit & history</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            <OverviewPanel svc={active} snapshot={snap} secrets={secrets} />
          </TabsContent>

          {/* SETTINGS */}
          <TabsContent value="settings" className="space-y-4">
            <SettingsPanel
              svc={active}
              adminInvoke={adminInvoke}
              organizationId={organizationId}
              secrets={secrets}
            />
          </TabsContent>

          {/* AUDIT */}
          <TabsContent value="audit" className="space-y-4">
            <AuditPanel svc={active} />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

/* ============================ Overview ============================ */

function OverviewPanel({ svc, snapshot, secrets }: { svc: ServiceDef; snapshot: Snapshot; secrets: SecretStatus[] }) {
  const required = svc.requiredSecrets ?? [];
  const missingSecrets = required.filter((n) => !secrets.find((s) => s.name === n && s.configured));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Live status</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            {snapshot.status === 'healthy' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {snapshot.status === 'failed' && <AlertTriangle className="h-4 w-4 text-destructive" />}
            {snapshot.status !== 'healthy' && snapshot.status !== 'failed' && <Activity className="h-4 w-4 text-muted-foreground" />}
            {statusBadge(snapshot.status)}
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Last activity: <span className="text-foreground">{timeAgo(snapshot.lastActivityAt)}</span></div>
            {snapshot.latencyMs != null && <div>Latency: <span className="text-foreground">{snapshot.latencyMs}ms</span></div>}
            {snapshot.lastMessage && (
              <div className="break-words">Message: <span className="text-foreground">{snapshot.lastMessage}</span></div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Required configuration</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {required.length === 0 && (
            <p className="text-muted-foreground">No secrets required for this service.</p>
          )}
          {required.map((name) => {
            const ok = !missingSecrets.includes(name);
            return (
              <div key={name} className="flex items-center justify-between">
                <span className="font-mono">{name}</span>
                {ok ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">Set</Badge>
                ) : (
                  <Badge variant="destructive">Missing</Badge>
                )}
              </div>
            );
          })}
          {svc.functionName && (
            <>
              <Separator className="my-2" />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Edge function</span>
                <a
                  href={`https://supabase.com/dashboard/project/_/functions/${svc.functionName}/logs`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground font-mono"
                >
                  {svc.functionName} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================ Settings (per-service) ============================ */

function SettingsPanel({
  svc, adminInvoke, organizationId, secrets,
}: {
  svc: ServiceDef;
  adminInvoke: (action: string, payload?: Record<string, any>) => Promise<any>;
  organizationId: string | null;
  secrets: SecretStatus[];
}) {
  switch (svc.settings) {
    case 'graph_scopes':
      return (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Azure tenant permissions</CardTitle>
              <CardDescription className="text-xs">
                Verify admin-consented Graph scopes for this surface. Run this whenever scope errors appear in audit logs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AzurePermissionsCheck invoke={adminInvoke} />
            </CardContent>
          </Card>
          <ScopeReference serviceId={svc.id} />
        </div>
      );

    case 'agent_email':
    case 'agent_teams':
      return (
        <div className="space-y-4">
          {svc.settings === 'agent_teams' && (
            <SecretStatusCard required={svc.requiredSecrets ?? []} secrets={secrets} />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> Agent configuration</CardTitle>
              <CardDescription className="text-xs">
                Manage email & Teams agent toggles, allowed sender domains, and shared mailbox.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AgentPanel organizationId={organizationId} />
            </CardContent>
          </Card>
        </div>
      );

    case 'follow_ups':
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><BellRing className="h-4 w-4" /> Follow-up settings</CardTitle>
            <CardDescription className="text-xs">
              BCC alias, reminder cadence, and auto-reply behavior.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FollowUpsPanel organizationId={organizationId} />
          </CardContent>
        </Card>
      );

    case 'llm_keys':
    case 'embeddings_keys':
      return (
        <div className="space-y-4">
          <SecretStatusCard required={svc.requiredSecrets ?? []} secrets={secrets} />
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4" /> Provider keys</CardTitle>
              <CardDescription className="text-xs">
                Provider API keys are managed centrally under <span className="font-medium text-foreground">Settings → AI APIs</span>.
                This service is healthy as long as the required secrets above are set and the gateway responds to Test.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      );

    case 'orchestrator':
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> Orchestrator</CardTitle>
            <CardDescription className="text-xs">
              The orchestrator uses tools <span className="font-mono">search_outlook_mail</span>, <span className="font-mono">search_onedrive</span>, <span className="font-mono">search_sharepoint</span>, <span className="font-mono">get_calendar_events</span>, <span className="font-mono">search_context</span>, and <span className="font-mono">compose_email_draft</span>.
              Per-user cost caps and model assignment live in <span className="font-medium text-foreground">Plans</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div>Default model: <span className="font-mono text-foreground">gpt-5-mini</span></div>
            <div>Drafts are never auto-sent — they always wait for user review.</div>
          </CardContent>
        </Card>
      );

    case 'job_schedule':
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" /> Cron schedule</CardTitle>
            <CardDescription className="text-xs">
              This job runs on pg_cron. Use <span className="font-medium text-foreground">Run test</span> above to fire it manually.
              History appears in the Audit tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div>Function: <span className="font-mono text-foreground">{svc.functionName}</span></div>
            <div>Trigger: pg_cron via pg_net</div>
          </CardContent>
        </Card>
      );

    case 'indexing':
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Cable className="h-4 w-4" /> Indexing controls</CardTitle>
            <CardDescription className="text-xs">
              Trigger sync across all connections or a specific one. Failed extractions show in the Audit tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <M365IndexingPanel />
          </CardContent>
        </Card>
      );

    default:
      return (
        <Card>
          <CardContent className="py-6 text-xs text-muted-foreground">
            No editable settings for this service.
          </CardContent>
        </Card>
      );
  }
}

function SecretStatusCard({ required, secrets }: { required: string[]; secrets: SecretStatus[] }) {
  if (required.length === 0) return null;
  const missing = required.filter((n) => !secrets.find((s) => s.name === n && s.configured));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4" /> Secrets</CardTitle>
        <CardDescription className="text-xs">
          {missing.length === 0 ? 'All required secrets are configured.' : `${missing.length} required secret(s) missing.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {required.map((name) => {
          const ok = !missing.includes(name);
          return (
            <div key={name} className="flex items-center justify-between">
              <span className="font-mono">{name}</span>
              {ok ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">Set</Badge>
              ) : (
                <Badge variant="destructive">Missing</Badge>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ScopeReference({ serviceId }: { serviceId: ServiceId }) {
  const SCOPES: Partial<Record<ServiceId, string[]>> = {
    mail: ['Mail.Read', 'Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.Read'],
    calendar: ['Calendars.ReadWrite'],
    onedrive: ['Files.Read.All', 'Sites.Read.All'],
    sharepoint: ['Sites.Read.All', 'Files.Read.All'],
    teams_graph: ['ChannelMessage.Read.All', 'Chat.Read'],
  };
  const scopes = SCOPES[serviceId] ?? [];
  if (scopes.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Required Graph scopes</CardTitle>
        <CardDescription className="text-xs">Grant admin consent in Azure AD for this surface.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {scopes.map((s) => <Badge key={s} variant="outline" className="font-mono text-xs">{s}</Badge>)}
      </CardContent>
    </Card>
  );
}

/* ============================ Audit ============================ */

function AuditPanel({ svc }: { svc: ServiceDef }) {
  const [healthLogs, setHealthLogs] = useState<HealthRow[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncJobRow[]>([]);
  const [jobLogs, setJobLogs] = useState<JobRow[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (svc.apiName) {
          const { data } = await supabase.from('m365_api_health')
            .select('api_name, status, endpoint, response_ms, error_code, error_message, checked_at')
            .eq('api_name', svc.apiName).order('checked_at', { ascending: false }).limit(50);
          if (!cancelled) setHealthLogs((data ?? []) as HealthRow[]);
        }
        if (svc.id === 'm365_sync' || svc.id === 'indexing') {
          const { data } = await supabase.from('m365_sync_jobs')
            .select('id, source, sync_type, status, items_processed, items_failed, error_message, created_at')
            .order('created_at', { ascending: false }).limit(50);
          if (!cancelled) setSyncLogs((data ?? []) as SyncJobRow[]);
        }
        if (svc.jobType) {
          const { data } = await supabase.from('jobs')
            .select('id, job_type, status, error_message, started_at, completed_at, created_at')
            .eq('job_type', svc.jobType).order('created_at', { ascending: false }).limit(50);
          if (!cancelled) setJobLogs((data ?? []) as JobRow[]);
        }
        if (svc.section === 'ai' || svc.section === 'agents') {
          const q = supabase.from('ai_usage_logs')
            .select('action, status, provider, model, latency_ms, error_message, created_at')
            .order('created_at', { ascending: false }).limit(50);
          const { data } = svc.aiAction ? await q.eq('action', svc.aiAction) : await q;
          if (!cancelled) setUsageLogs((data ?? []) as UsageRow[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [svc]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading audit data…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {svc.apiName && (
        <LogTable
          title="Recent Graph API calls"
          empty="No recorded Graph API calls."
          rows={healthLogs}
          columns={[
            { head: 'When', cell: (r) => new Date(r.checked_at).toLocaleString() },
            { head: 'Status', cell: (r) => statusBadge(r.status as Status) },
            { head: 'Endpoint', cell: (r) => <span className="font-mono text-xs">{(r.endpoint ?? '').slice(0, 70)}</span> },
            { head: 'ms', cell: (r) => r.response_ms ?? '' },
            { head: 'Error', cell: (r) => r.error_message ? <span className="text-destructive text-xs">{r.error_code}: {r.error_message}</span> : '' },
          ]}
        />
      )}
      {(svc.section === 'ai' || svc.section === 'agents') && (
        <LogTable
          title="Recent AI activity"
          empty="No AI usage records yet."
          rows={usageLogs}
          columns={[
            { head: 'When', cell: (r) => new Date(r.created_at).toLocaleString() },
            { head: 'Action', cell: (r) => r.action },
            { head: 'Provider/Model', cell: (r) => <span className="font-mono text-xs">{r.provider}/{r.model}</span> },
            { head: 'Status', cell: (r) => statusBadge(r.status === 'success' ? 'healthy' : 'failed') },
            { head: 'ms', cell: (r) => r.latency_ms ?? '' },
            { head: 'Error', cell: (r) => r.error_message ? <span className="text-destructive text-xs">{r.error_message}</span> : '' },
          ]}
        />
      )}
      {(svc.id === 'm365_sync' || svc.id === 'indexing') && (
        <LogTable
          title="Sync job history"
          empty="No sync jobs yet."
          rows={syncLogs}
          columns={[
            { head: 'When', cell: (r) => new Date(r.created_at).toLocaleString() },
            { head: 'Source', cell: (r) => r.source },
            { head: 'Type', cell: (r) => r.sync_type },
            { head: 'Status', cell: (r) => statusBadge(r.status === 'complete' ? 'healthy' : r.status === 'failed' ? 'failed' : 'degraded') },
            { head: 'Items', cell: (r) => `${r.items_processed} ok · ${r.items_failed} fail` },
            { head: 'Error', cell: (r) => r.error_message ? <span className="text-destructive text-xs">{r.error_message}</span> : '' },
          ]}
        />
      )}
      {svc.jobType && (
        <LogTable
          title="Job runs"
          empty="No job rows yet."
          rows={jobLogs}
          columns={[
            { head: 'When', cell: (r) => new Date(r.created_at).toLocaleString() },
            { head: 'Status', cell: (r) => statusBadge(r.status === 'completed' || r.status === 'complete' ? 'healthy' : r.status === 'failed' ? 'failed' : 'degraded') },
            { head: 'Started', cell: (r) => r.started_at ? new Date(r.started_at).toLocaleTimeString() : '—' },
            { head: 'Completed', cell: (r) => r.completed_at ? new Date(r.completed_at).toLocaleTimeString() : '—' },
            { head: 'Error', cell: (r) => r.error_message ? <span className="text-destructive text-xs">{r.error_message}</span> : '' },
          ]}
        />
      )}
    </div>
  );
}

/* ============================ LogTable ============================ */

function LogTable<R>({
  title, empty, rows, columns,
}: {
  title: string;
  empty: string;
  rows: R[];
  columns: { head: string; cell: (r: R) => React.ReactNode }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  {columns.map((c) => <th key={c.head} className="px-3 py-2 whitespace-nowrap">{c.head}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {columns.map((c) => (
                      <td key={c.head} className="px-3 py-2 align-top whitespace-nowrap">{c.cell(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

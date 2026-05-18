import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Mail, Calendar as CalendarIcon, FolderOpen, Building2, Users as TeamsIcon,
  Bot, Brain, MessageSquare, Sparkles, RefreshCw, Activity,
  CheckCircle2, AlertTriangle, Loader2, Play, Workflow, Inbox, BellRing,
  ChevronRight, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import M365IndexingPanel from './M365IndexingPanel';

/* ============================ Registry ============================ */

type ServiceId =
  | 'mail' | 'calendar' | 'onedrive' | 'sharepoint' | 'teams'
  | 'llm_gateway' | 'embeddings' | 'agent_orchestrator' | 'chat_agent'
  | 'm365_sync' | 'ingest_emails' | 'process_ai_emails' | 'follow_ups'
  | 'indexing';

type Section = 'graph' | 'ai' | 'jobs' | 'connectors';

interface ServiceDef {
  id: ServiceId;
  section: Section;
  name: string;
  description: string;
  icon: typeof Mail;
  /** m365_api_health.api_name match (Graph services) */
  apiName?: 'mail' | 'calendar' | 'onedrive' | 'sharepoint' | 'user';
  /** ai_usage_logs action match (AI services) */
  aiAction?: string;
  /** jobs.job_type match (background jobs) */
  jobType?: string;
  /** m365_sync_jobs.source match */
  syncSource?: string;
  /** edge function deployed name (for log links / probe target) */
  functionName?: string;
  /** Show "Test" button */
  testable: boolean;
}

const SERVICES: ServiceDef[] = [
  // Microsoft Graph services
  { id: 'mail', section: 'graph', name: 'Outlook Mail', description: 'Read mailboxes, threads, attachments via Microsoft Graph.',
    icon: Mail, apiName: 'mail', testable: true },
  { id: 'calendar', section: 'graph', name: 'Calendar', description: 'Meetings, scheduling, availability.',
    icon: CalendarIcon, apiName: 'calendar', testable: true },
  { id: 'onedrive', section: 'graph', name: 'OneDrive', description: 'Personal file search and extraction.',
    icon: FolderOpen, apiName: 'onedrive', testable: true },
  { id: 'sharepoint', section: 'graph', name: 'SharePoint', description: 'Tenant-wide file & site search.',
    icon: Building2, apiName: 'sharepoint', testable: true },
  { id: 'teams', section: 'graph', name: 'Microsoft Teams', description: 'Teams agent — channel & DM access. Requires extra scopes.',
    icon: TeamsIcon, apiName: 'user', testable: true },

  // AI services
  { id: 'llm_gateway', section: 'ai', name: 'LLM Gateway', description: 'Routes OpenAI / Anthropic calls with quota enforcement.',
    icon: Brain, aiAction: 'ai_chat', functionName: 'llm-gateway', testable: true },
  { id: 'embeddings', section: 'ai', name: 'Embeddings', description: 'text-embedding-3-small (vector(1536)).',
    icon: Sparkles, functionName: 'embed-text', testable: true },
  { id: 'agent_orchestrator', section: 'ai', name: 'Agent Orchestrator', description: 'Multi-tool reasoning loop powering /chat.',
    icon: Bot, functionName: 'agent-orchestrator', testable: true },
  { id: 'chat_agent', section: 'ai', name: 'Chat Agent (SSE)', description: 'Streaming bridge between /chat UI and the orchestrator.',
    icon: MessageSquare, functionName: 'chat-agent', testable: true },

  // Internal jobs
  { id: 'm365_sync', section: 'jobs', name: 'M365 Sync (delta)', description: 'Hourly delta sync across all active connections.',
    icon: RefreshCw, syncSource: 'onedrive', functionName: 'm365-sync-all', testable: true },
  { id: 'ingest_emails', section: 'jobs', name: 'Ingest Emails', description: 'Pulls recent mail into email_messages for retrieval.',
    icon: Inbox, jobType: 'email_ingest', functionName: 'cron-ingest-emails', testable: true },
  { id: 'process_ai_emails', section: 'jobs', name: 'AI Email Processor', description: 'Categorization + AI drafts on inbound mail.',
    icon: Workflow, jobType: 'ai_email_processing', functionName: 'process-ai-emails', testable: true },
  { id: 'follow_ups', section: 'jobs', name: 'Follow-Up Reminders', description: 'BCC-triggered auto-reminders.',
    icon: BellRing, jobType: 'follow_up_audit', functionName: 'cron-follow-ups', testable: true },

  // Connectors / indexing
  { id: 'indexing', section: 'connectors', name: 'Document Indexing', description: 'OneDrive / SharePoint / mail attachment extraction & embedding.',
    icon: Activity, testable: false },
];

const SECTION_META: Record<Section, { title: string; description: string }> = {
  graph: {
    title: 'Microsoft Graph services',
    description: 'Live status for each Microsoft 365 surface. "Test" probes against the super-admin connection.',
  },
  ai: {
    title: 'AI services',
    description: 'LLM gateway, embeddings, and the orchestrator/chat agent that power /chat.',
  },
  jobs: {
    title: 'Background jobs',
    description: 'Scheduled crons + manual "Run now" triggers. Last execution shown per job.',
  },
  connectors: {
    title: 'External connectors',
    description: 'Indexing pipelines and integrations that feed the agent.',
  },
};

/* ============================ Types ============================ */

type Status = 'healthy' | 'degraded' | 'failed' | 'idle' | 'unknown';

interface Snapshot {
  status: Status;
  lastActivityAt: string | null;
  lastMessage: string | null;
  latencyMs: number | null;
  meta?: Record<string, unknown>;
}

type SnapshotMap = Partial<Record<ServiceId, Snapshot>>;

interface HealthRow { api_name: string; status: string; endpoint: string | null; response_ms: number | null; error_code: string | null; error_message: string | null; checked_at: string; }
interface SyncJobRow { id: string; source: string; sync_type: string; status: string; items_processed: number; items_failed: number; error_message: string | null; created_at: string; }
interface JobRow { id: string; job_type: string; status: string; error_message: string | null; started_at: string | null; completed_at: string | null; created_at: string; }
interface UsageRow { action: string; status: string; provider: string; model: string; latency_ms: number | null; error_message: string | null; created_at: string; }

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
  if (s === 'healthy') return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Healthy</Badge>;
  if (s === 'degraded') return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">Degraded</Badge>;
  if (s === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (s === 'idle') return <Badge variant="secondary">Idle</Badge>;
  return <Badge variant="outline">Unknown</Badge>;
}

function StatusIcon({ s }: { s: Status }) {
  if (s === 'healthy') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (s === 'failed' || s === 'degraded') return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <Activity className="h-4 w-4 text-muted-foreground" />;
}

/* ============================ Main component ============================ */

export default function IntegrationsTab() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<ServiceId | null>(null);
  const [testingId, setTestingId] = useState<ServiceId | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [healthRes, syncRes, jobsRes, usageRes] = await Promise.all([
        // m365_api_health is service-role only — admin RLS not granted. We rely
        // on the super admin's own user_id rows for the latest snapshot.
        supabase.from('m365_api_health')
          .select('api_name, status, endpoint, response_ms, error_code, error_message, checked_at')
          .order('checked_at', { ascending: false })
          .limit(500),
        supabase.from('m365_sync_jobs')
          .select('id, source, sync_type, status, items_processed, items_failed, error_message, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('jobs')
          .select('id, job_type, status, error_message, started_at, completed_at, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('ai_usage_logs')
          .select('action, status, provider, model, latency_ms, error_message, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      const snap: SnapshotMap = {};

      // Graph services from m365_api_health
      const healthByApi = new Map<string, HealthRow[]>();
      for (const r of (healthRes.data ?? []) as HealthRow[]) {
        const arr = healthByApi.get(r.api_name) ?? [];
        arr.push(r);
        healthByApi.set(r.api_name, arr);
      }
      for (const svc of SERVICES.filter((s) => s.apiName)) {
        const rows = healthByApi.get(svc.apiName!) ?? [];
        const latest = rows[0];
        if (!latest) { snap[svc.id] = { status: 'unknown', lastActivityAt: null, lastMessage: null, latencyMs: null }; continue; }
        snap[svc.id] = {
          status: (latest.status as Status) ?? 'unknown',
          lastActivityAt: latest.checked_at,
          lastMessage: latest.error_message || latest.endpoint || 'OK',
          latencyMs: latest.response_ms ?? null,
        };
      }

      // AI services from ai_usage_logs (best-available signal)
      const usageRows = (usageRes.data ?? []) as UsageRow[];
      const latestAi = usageRows[0];
      const aiHealthy = latestAi?.status === 'success';
      for (const svc of SERVICES.filter((s) => s.section === 'ai')) {
        // Match by action when available; otherwise use the overall latest row.
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

      // Jobs from jobs + m365_sync_jobs
      const syncRows = (syncRes.data ?? []) as SyncJobRow[];
      const jobRows = (jobsRes.data ?? []) as JobRow[];
      // M365 sync card
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

      // Indexing card — aggregate from knowledge_documents
      const { data: docs } = await supabase.from('knowledge_documents')
        .select('extraction_status, updated_at')
        .in('source_type', ['mail_attachment', 'onedrive', 'sharepoint'])
        .order('updated_at', { ascending: false })
        .limit(500);
      const total = docs?.length ?? 0;
      const failed = docs?.filter((d: any) => d.extraction_status === 'failed').length ?? 0;
      snap.indexing = {
        status: total === 0 ? 'idle' : failed > total * 0.2 ? 'degraded' : 'healthy',
        lastActivityAt: docs?.[0]?.updated_at ?? null,
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

  useEffect(() => { void load(); }, []);

  const runTest = async (svc: ServiceDef) => {
    if (!session?.access_token) return;
    setTestingId(svc.id);
    try {
      const { data, error } = await supabase.functions.invoke('admin-integration-probe', {
        body: { service: svc.id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw new Error(error.message);
      const ok = !!data?.ok;
      toast({
        title: ok ? `${svc.name}: OK` : `${svc.name}: failed`,
        description: `${data?.message ?? ''}${data?.latency_ms ? ` · ${data.latency_ms}ms` : ''}`,
        variant: ok ? 'default' : 'destructive',
      });
      // Snapshot refresh so the badge reflects the probe
      await load();
    } catch (e: any) {
      toast({ title: `${svc.name}: failed`, description: e.message, variant: 'destructive' });
    } finally {
      setTestingId(null);
    }
  };

  const sections: Section[] = ['graph', 'ai', 'jobs', 'connectors'];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => {
        const services = SERVICES.filter((s) => s.section === section);
        return (
          <section key={section} className="space-y-3">
            <div>
              <h3 className="text-base font-semibold">{SECTION_META[section].title}</h3>
              <p className="text-sm text-muted-foreground">{SECTION_META[section].description}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {services.map((svc) => {
                const snap = snapshots[svc.id] ?? { status: 'unknown' as Status, lastActivityAt: null, lastMessage: null, latencyMs: null };
                const Icon = svc.icon;
                return (
                  <Card
                    key={svc.id}
                    className={cn(
                      'cursor-pointer transition hover:border-primary/60 hover:shadow-sm',
                      snap.status === 'failed' && 'border-destructive/40',
                    )}
                    onClick={() => setOpenId(svc.id)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="rounded-md bg-muted p-2 shrink-0"><Icon className="h-4 w-4" /></div>
                          <div className="min-w-0">
                            <CardTitle className="text-sm truncate">{svc.name}</CardTitle>
                            <CardDescription className="text-xs line-clamp-1">{svc.description}</CardDescription>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon s={snap.status} />
                          {statusBadge(snap.status)}
                        </div>
                        <span className="text-xs text-muted-foreground">{timeAgo(snap.lastActivityAt)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                        {snap.lastMessage || '\u00A0'}
                      </div>
                      {svc.testable && (
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xs text-muted-foreground">
                            {snap.latencyMs != null ? `${snap.latencyMs}ms` : ''}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={testingId === svc.id}
                            onClick={(e) => { e.stopPropagation(); void runTest(svc); }}
                          >
                            {testingId === svc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                            <span className="ml-1.5 text-xs">Test</span>
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      <ServiceDetailSheet
        serviceId={openId}
        onClose={() => setOpenId(null)}
        snapshot={openId ? snapshots[openId] : undefined}
        onTest={(svc) => runTest(svc)}
        testingId={testingId}
      />
    </div>
  );
}

/* ============================ Detail Sheet ============================ */

function ServiceDetailSheet({
  serviceId, onClose, snapshot, onTest, testingId,
}: {
  serviceId: ServiceId | null;
  onClose: () => void;
  snapshot?: Snapshot;
  onTest: (svc: ServiceDef) => void;
  testingId: ServiceId | null;
}) {
  const svc = useMemo(() => SERVICES.find((s) => s.id === serviceId) ?? null, [serviceId]);
  const [healthLogs, setHealthLogs] = useState<HealthRow[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncJobRow[]>([]);
  const [jobLogs, setJobLogs] = useState<JobRow[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!svc) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (svc.apiName) {
          const { data } = await supabase.from('m365_api_health')
            .select('api_name, status, endpoint, response_ms, error_code, error_message, checked_at')
            .eq('api_name', svc.apiName)
            .order('checked_at', { ascending: false })
            .limit(50);
          if (!cancelled) setHealthLogs((data ?? []) as HealthRow[]);
        }
        if (svc.id === 'm365_sync' || svc.id === 'indexing') {
          const { data } = await supabase.from('m365_sync_jobs')
            .select('id, source, sync_type, status, items_processed, items_failed, error_message, created_at')
            .order('created_at', { ascending: false })
            .limit(50);
          if (!cancelled) setSyncLogs((data ?? []) as SyncJobRow[]);
        }
        if (svc.jobType) {
          const { data } = await supabase.from('jobs')
            .select('id, job_type, status, error_message, started_at, completed_at, created_at')
            .eq('job_type', svc.jobType)
            .order('created_at', { ascending: false })
            .limit(50);
          if (!cancelled) setJobLogs((data ?? []) as JobRow[]);
        }
        if (svc.section === 'ai') {
          const { data } = await supabase.from('ai_usage_logs')
            .select('action, status, provider, model, latency_ms, error_message, created_at')
            .order('created_at', { ascending: false })
            .limit(50);
          if (!cancelled) setUsageLogs((data ?? []) as UsageRow[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [svc]);

  if (!svc) return null;
  const Icon = svc.icon;
  const snap = snapshot ?? { status: 'unknown' as Status, lastActivityAt: null, lastMessage: null, latencyMs: null };

  return (
    <Sheet open={!!serviceId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-muted p-2"><Icon className="h-5 w-5" /></div>
            <div>
              <SheetTitle>{svc.name}</SheetTitle>
              <SheetDescription>{svc.description}</SheetDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            {statusBadge(snap.status)}
            <span className="text-xs text-muted-foreground">Last activity: {timeAgo(snap.lastActivityAt)}</span>
            {snap.latencyMs != null && <span className="text-xs text-muted-foreground">· {snap.latencyMs}ms</span>}
            <div className="ml-auto flex items-center gap-2">
              {svc.testable && (
                <Button size="sm" variant="outline" disabled={testingId === svc.id} onClick={() => onTest(svc)}>
                  {testingId === svc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  <span className="ml-1.5 text-xs">Test now</span>
                </Button>
              )}
              {svc.functionName && (
                <a
                  href={`https://supabase.com/dashboard/project/_/functions/${svc.functionName}/logs`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  Logs <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading audit data…
            </div>
          )}

          {svc.apiName && (
            <LogTable
              title="Recent Graph API calls"
              empty="No recorded calls in m365_api_health."
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

          {svc.section === 'ai' && (
            <LogTable
              title="Recent AI usage"
              empty="No ai_usage_logs entries yet."
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

          {svc.id === 'indexing' && (
            <div className="space-y-3 pt-2">
              <h4 className="text-sm font-semibold">Indexing controls</h4>
              <M365IndexingPanel />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
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
    </div>
  );
}

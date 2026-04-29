import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, RefreshCw, Mail, Send, Search, Download, ChevronRight, AlertCircle, CheckCircle2, Clock, Bot, FileText } from 'lucide-react';

interface AgentMessage {
  id: string;
  channel: string;
  direction: string;
  sender_email: string | null;
  subject: string | null;
  content: string | null;
  status: string;
  rejected_reason: string | null;
  conversation_id: string | null;
  external_message_id: string | null;
  response_to_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

interface UsageRow {
  id: string;
  created_at: string;
  user_id: string | null;
  action: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number | null;
  cost_usd: number;
  metadata: Record<string, any>;
}

const STATUS_OPTIONS = ['all', 'received', 'processing', 'sent', 'failed', 'rejected'] as const;
const DIRECTION_OPTIONS = ['all', 'inbound', 'outbound'] as const;
const CHANNEL_OPTIONS = ['all', 'email', 'teams', 'api'] as const;

export default function AgentAuditPanel({ organizationId }: { organizationId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [directionFilter, setDirectionFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [days, setDays] = useState<string>('7');
  const [selected, setSelected] = useState<AgentMessage | null>(null);

  async function load() {
    if (!organizationId) return;
    setRefreshing(true);
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();

    const [msgRes, usageRes] = await Promise.all([
      supabase
        .from('agent_messages')
        .select('id,channel,direction,sender_email,subject,content,status,rejected_reason,conversation_id,external_message_id,response_to_id,metadata,created_at')
        .eq('organization_id', organizationId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('ai_usage_logs')
        .select('id,created_at,user_id,action,provider,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,metadata')
        .eq('organization_id', organizationId)
        .gte('created_at', since)
        .in('action', ['agent_email_reply', 'agent_loop', 'teams_agent_reply'])
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    setMessages((msgRes.data ?? []) as AgentMessage[]);
    setUsage((usageRes.data ?? []) as UsageRow[]);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (organizationId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, days]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (directionFilter !== 'all' && m.direction !== directionFilter) return false;
      if (channelFilter !== 'all' && m.channel !== channelFilter) return false;
      if (q) {
        const hay = `${m.sender_email ?? ''} ${m.subject ?? ''} ${m.content ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [messages, search, statusFilter, directionFilter, channelFilter]);

  const stats = useMemo(() => {
    const inbound = messages.filter((m) => m.direction === 'inbound').length;
    const outbound = messages.filter((m) => m.direction === 'outbound').length;
    const failed = messages.filter((m) => m.status === 'failed' || m.status === 'rejected').length;
    const totalCost = usage.reduce((s, u) => s + Number(u.cost_usd || 0), 0);
    const totalTokens = usage.reduce((s, u) => s + Number(u.total_tokens || u.prompt_tokens + u.completion_tokens || 0), 0);
    return { inbound, outbound, failed, totalCost, totalTokens };
  }, [messages, usage]);

  function findRelated(m: AgentMessage): { thread: AgentMessage[]; usage: UsageRow[] } {
    const thread = m.conversation_id
      ? messages.filter((x) => x.conversation_id === m.conversation_id).sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      : [m];
    const related = usage.filter((u) =>
      u.metadata?.conversation_id === m.conversation_id ||
      u.metadata?.message_id === m.id ||
      u.metadata?.inbound_message_id === m.id
    );
    return { thread, usage: related };
  }

  function exportCsv() {
    const rows = [
      ['timestamp', 'direction', 'channel', 'status', 'sender', 'subject', 'conversation_id', 'content', 'error'],
      ...filtered.map((m) => [
        m.created_at,
        m.direction,
        m.channel,
        m.status,
        m.sender_email ?? '',
        (m.subject ?? '').replace(/"/g, "'"),
        m.conversation_id ?? '',
        (m.content ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").slice(0, 1000),
        (m.rejected_reason ?? '').replace(/"/g, "'"),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={<Mail className="w-4 h-4" />} label="Inbound" value={stats.inbound} />
        <StatCard icon={<Send className="w-4 h-4" />} label="Outbound" value={stats.outbound} />
        <StatCard icon={<AlertCircle className="w-4 h-4 text-destructive" />} label="Failed" value={stats.failed} tone={stats.failed > 0 ? 'destructive' : undefined} />
        <StatCard icon={<Bot className="w-4 h-4" />} label="Tokens" value={stats.totalTokens.toLocaleString()} />
        <StatCard icon={<FileText className="w-4 h-4" />} label="Cost (USD)" value={`$${stats.totalCost.toFixed(4)}`} />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Bot className="w-5 h-5" /> Agent Audit Log</CardTitle>
              <CardDescription>Every request to <code>agent@</code> and every reply the agent generated. Click a row to see the full conversation, generated content, and any errors.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
                {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="w-4 h-4 mr-1" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search sender, subject, body…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24h</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIRECTION_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o === 'all' ? 'All directions' : o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o === 'all' ? 'All statuses' : o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o === 'all' ? 'All channels' : o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No matching activity</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelected(m)}
                  className="w-full text-left flex items-start gap-3 rounded-lg border p-3 text-sm hover:bg-accent/50 transition-colors"
                >
                  <div className="mt-0.5">
                    {m.direction === 'inbound' ? (
                      <Mail className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Send className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] uppercase">{m.channel}</Badge>
                      <StatusBadge status={m.status} />
                      {m.sender_email && <span className="text-xs text-muted-foreground truncate max-w-[260px]">{m.sender_email}</span>}
                      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString()}
                      </span>
                    </div>
                    {m.subject && <p className="font-medium mt-1 truncate">{m.subject}</p>}
                    {m.content && <p className="text-muted-foreground line-clamp-2 mt-1">{m.content}</p>}
                    {m.rejected_reason && (
                      <p className="text-destructive text-xs mt-1 line-clamp-2">⚠ {m.rejected_reason}</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selected && (() => {
            const { thread, usage: relUsage } = findRelated(selected);
            const attachments = thread
              .flatMap((t) => (Array.isArray(t.metadata?.attachments) ? t.metadata.attachments : []));
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Bot className="w-5 h-5" /> {selected.subject || '(no subject)'}
                  </DialogTitle>
                  <DialogDescription>
                    Conversation {selected.conversation_id?.slice(0, 24) ?? selected.id.slice(0, 8)} • {thread.length} message{thread.length === 1 ? '' : 's'}
                  </DialogDescription>
                </DialogHeader>

                {/* Usage summary */}
                {relUsage.length > 0 && (
                  <div className="rounded-lg border p-3 bg-muted/30 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div><span className="text-muted-foreground">Provider:</span> {relUsage[0].provider}</div>
                    <div><span className="text-muted-foreground">Model:</span> {relUsage[0].model}</div>
                    <div><span className="text-muted-foreground">Tokens:</span> {(relUsage[0].total_tokens ?? relUsage[0].prompt_tokens + relUsage[0].completion_tokens).toLocaleString()}</div>
                    <div><span className="text-muted-foreground">Cost:</span> ${Number(relUsage[0].cost_usd).toFixed(4)}</div>
                  </div>
                )}

                {/* Attachments */}
                {attachments.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-medium mb-2 flex items-center gap-1"><FileText className="w-3 h-3" /> Generated attachments</p>
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((a: any, i: number) => (
                        <Badge key={i} variant="secondary" className="text-[11px]">
                          {a.filename || a.name || 'file'} {a.byte_size ? `· ${Math.round(a.byte_size / 1024)}KB` : ''}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Thread */}
                <div className="space-y-3">
                  {thread.map((t) => (
                    <div key={t.id} className={`rounded-lg border p-3 ${t.direction === 'inbound' ? 'bg-blue-500/5' : 'bg-green-500/5'}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {t.direction === 'inbound' ? <Mail className="w-3.5 h-3.5 text-blue-500" /> : <Send className="w-3.5 h-3.5 text-green-500" />}
                        <span className="text-xs font-medium">{t.sender_email || 'unknown'}</span>
                        <StatusBadge status={t.status} />
                        <span className="text-xs text-muted-foreground ml-auto">{new Date(t.created_at).toLocaleString()}</span>
                      </div>
                      {t.content ? (
                        <pre className="text-xs whitespace-pre-wrap break-words font-sans text-foreground/90">{t.content}</pre>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">(no body captured)</p>
                      )}
                      {t.rejected_reason && (
                        <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2">
                          <p className="text-xs font-medium text-destructive">Error / rejection reason</p>
                          <p className="text-xs text-destructive/90 mt-1 break-words">{t.rejected_reason}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Raw metadata */}
                {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                  <details className="rounded-lg border p-3">
                    <summary className="text-xs font-medium cursor-pointer">Raw metadata</summary>
                    <pre className="text-[11px] mt-2 overflow-x-auto">{JSON.stringify(selected.metadata, null, 2)}</pre>
                  </details>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone?: 'destructive' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon} {label}</div>
        <p className={`text-2xl font-bold mt-1 ${tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon?: React.ReactNode }> = {
    sent: { variant: 'secondary', icon: <CheckCircle2 className="w-3 h-3" /> },
    received: { variant: 'secondary' },
    processing: { variant: 'outline', icon: <Clock className="w-3 h-3" /> },
    queued: { variant: 'outline', icon: <Clock className="w-3 h-3" /> },
    running: { variant: 'outline', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    failed: { variant: 'destructive', icon: <AlertCircle className="w-3 h-3" /> },
    rejected: { variant: 'destructive', icon: <AlertCircle className="w-3 h-3" /> },
  };
  const cfg = map[status] || { variant: 'outline' as const };
  return (
    <Badge variant={cfg.variant} className="text-[10px] gap-1">
      {cfg.icon}{status}
    </Badge>
  );
}

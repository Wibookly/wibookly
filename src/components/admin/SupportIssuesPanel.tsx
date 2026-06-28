import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw, MessageSquareWarning, ExternalLink, Send, Building2, Paperclip, X } from 'lucide-react';

interface SupportIssue {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  user_email: string;
  subject: string;
  description: string;
  page_url: string | null;
  user_agent: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  attachments?: Array<{ path: string; name: string; size?: number; type?: string }> | null;
}

interface OrgRow { id: string; name: string }
interface ThreadMessage {
  id: string;
  issue_id: string;
  author_user_id: string | null;
  author_role: string | null;
  body: string;
  attachments?: Array<{ path: string; name: string; size?: number; type?: string }> | null;
  created_at: string;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', tone: 'destructive' as const },
  { value: 'in_progress', label: 'In progress', tone: 'default' as const },
  { value: 'resolved', label: 'Resolved', tone: 'secondary' as const },
  { value: 'wont_fix', label: "Won't fix", tone: 'outline' as const },
];

function statusBadge(status: string) {
  const opt = STATUS_OPTIONS.find((s) => s.value === status);
  return (
    <Badge variant={opt?.tone ?? 'secondary'} className="capitalize">
      {opt?.label ?? status}
    </Badge>
  );
}

export default function SupportIssuesPanel() {
  const { profile, user } = useAuth();
  const { isSuperAdmin } = useUserRoles();
  const { toast } = useToast();
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [draftReplies, setDraftReplies] = useState<Record<string, string>>({});
  const [threadById, setThreadById] = useState<Record<string, ThreadMessage[]>>({});
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgFilter, setOrgFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Load orgs for the super-admin filter dropdown.
  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
        .order('name', { ascending: true });
      setOrgs((data ?? []) as OrgRow[]);
    })();
  }, [isSuperAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('support_issues')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

      if (isSuperAdmin) {
        if (orgFilter !== 'all') q = q.eq('organization_id', orgFilter);
      } else {
        if (!profile?.organization_id) {
          setIssues([]);
          return;
        }
        q = q.eq('organization_id', profile.organization_id);
      }
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as SupportIssue[];
      setIssues(rows);

      // Bulk-load thread messages for visible issues.
      if (rows.length > 0) {
        const { data: msgs } = await supabase
          .from('support_issue_messages' as any)
          .select('*')
          .in('issue_id', rows.map((r) => r.id))
          .order('created_at', { ascending: true });
        const grouped: Record<string, ThreadMessage[]> = {};
        for (const m of (msgs ?? []) as unknown as ThreadMessage[]) {
          (grouped[m.issue_id] ||= []).push(m);
        }
        setThreadById(grouped);
      } else {
        setThreadById({});
      }
    } catch (err) {
      console.error('load support issues', err);
      toast({
        title: 'Could not load issues',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.organization_id, isSuperAdmin, orgFilter, statusFilter]);

  const updateIssue = async (
    id: string,
    patch: Partial<Pick<SupportIssue, 'status' | 'admin_notes'>>,
  ) => {
    setSavingId(id);
    try {
      const update: Record<string, unknown> = { ...patch };
      if (patch.status === 'resolved') update.resolved_at = new Date().toISOString();
      else if (patch.status && patch.status !== 'resolved') update.resolved_at = null;

      const { error } = await supabase
        .from('support_issues')
        .update(update as never)
        .eq('id', id);
      if (error) throw error;

      setIssues((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                ...patch,
                resolved_at:
                  patch.status === 'resolved'
                    ? new Date().toISOString()
                    : patch.status
                    ? null
                    : it.resolved_at,
                updated_at: new Date().toISOString(),
              }
            : it,
        ),
      );
      toast({ title: 'Saved' });
    } catch (err) {
      console.error('update issue', err);
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const sendReply = async (issue: SupportIssue) => {
    const body = (draftReplies[issue.id] ?? '').trim();
    if (!body || !user?.id) return;
    setSavingId(issue.id);
    try {
      const { data: inserted, error } = await supabase
        .from('support_issue_messages' as any)
        .insert({
          issue_id: issue.id,
          organization_id: issue.organization_id,
          author_user_id: user.id,
          author_role: isSuperAdmin ? 'super_admin' : 'admin',
          body,
        } as any)
        .select()
        .maybeSingle();
      if (error) throw error;

      // Move ticket to in_progress if currently open
      if (issue.status === 'open') {
        await supabase
          .from('support_issues')
          .update({ status: 'in_progress' } as never)
          .eq('id', issue.id);
        setIssues((prev) => prev.map((i) => i.id === issue.id ? { ...i, status: 'in_progress' } : i));
      }

      // Fire ticket-updated email (best-effort; ignore failure)
      supabase.functions.invoke('ticket-updated-email', {
        body: {
          issue_id: issue.id,
          reply_excerpt: body.slice(0, 280),
        },
      }).catch(() => {});

      setThreadById((prev) => ({
        ...prev,
        [issue.id]: [...(prev[issue.id] || []), inserted as unknown as ThreadMessage],
      }));
      setDraftReplies((prev) => ({ ...prev, [issue.id]: '' }));
      toast({ title: 'Reply sent to user' });
    } catch (err) {
      toast({
        title: 'Could not send reply',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const counts = useMemo(() => ({
    open: issues.filter((i) => i.status === 'open').length,
    in_progress: issues.filter((i) => i.status === 'in_progress').length,
    resolved: issues.filter((i) => i.status === 'resolved').length,
  }), [issues]);

  const orgNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of orgs) m[o.id] = o.name;
    return m;
  }, [orgs]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareWarning className="w-5 h-5" />
              Support Issues
            </CardTitle>
            <CardDescription>
              User-submitted issues from the in-app Help panel
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSuperAdmin && (
              <Select value={orgFilter} onValueChange={setOrgFilter}>
                <SelectTrigger className="w-52 h-9 text-xs">
                  <Building2 className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="All organizations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All organizations</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{counts.open}</strong> open</span>
            <span>·</span>
            <span><strong className="text-foreground">{counts.in_progress}</strong> in progress</span>
            <span>·</span>
            <span><strong className="text-foreground">{counts.resolved}</strong> resolved</span>
            <span>·</span>
            <span><strong className="text-foreground">{issues.length}</strong> total</span>
          </div>
        </CardContent>
      </Card>

      {loading && issues.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading…
        </div>
      ) : issues.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No issues match the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {issues.map((it) => {
            const notes = draftNotes[it.id] ?? it.admin_notes ?? '';
            const dirty = notes !== (it.admin_notes ?? '');
            const thread = threadById[it.id] || [];
            const reply = draftReplies[it.id] ?? '';
            return (
              <Card key={it.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {statusBadge(it.status)}
                        {isSuperAdmin && it.organization_id && (
                          <Badge variant="outline" className="text-[10px]">
                            <Building2 className="w-3 h-3 mr-1" />
                            {orgNameById[it.organization_id] || it.organization_id.slice(0, 8)}
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(it.created_at).toLocaleString()}
                        </span>
                      </div>
                      <CardTitle className="text-base break-words">{it.subject}</CardTitle>
                      <CardDescription className="text-xs mt-1">
                        From <span className="font-mono">{it.user_email}</span>
                        {it.page_url && (
                          <>
                            {' · '}
                            <span className="inline-flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" />
                              <code className="text-[11px]">{it.page_url}</code>
                            </span>
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <Select
                      value={it.status}
                      onValueChange={(v) => updateIssue(it.id, { status: v })}
                      disabled={savingId === it.id}
                    >
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">User · original</div>
                    <p className="text-sm whitespace-pre-wrap break-words">{it.description}</p>
                  </div>
                  {Array.isArray(it.attachments) && it.attachments.length > 0 && (
                    <AttachmentsStrip attachments={it.attachments} />
                  )}

                  {/* Threaded conversation */}
                  {thread.length > 0 && (
                    <div className="space-y-2">
                      <Separator />
                      {thread.map((m) => {
                        const isStaff = m.author_role === 'admin' || m.author_role === 'super_admin';
                        return (
                          <div
                            key={m.id}
                            className={`rounded-md border px-3 py-2 ${isStaff ? 'bg-primary/5 border-primary/30' : 'bg-muted/30'}`}
                          >
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center justify-between">
                              <span>{isStaff ? 'Support team' : it.user_email}</span>
                              <span>{new Date(m.created_at).toLocaleString()}</span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reply-to-user composer */}
                  <Separator />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Reply to user (sends an email notification)
                    </label>
                    <Textarea
                      value={reply}
                      onChange={(e) => setDraftReplies((prev) => ({ ...prev, [it.id]: e.target.value }))}
                      rows={2}
                      placeholder={`Write a reply to ${it.user_email}…`}
                      className="text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={!reply.trim() || savingId === it.id}
                        onClick={() => sendReply(it)}
                      >
                        {savingId === it.id ? (
                          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                        ) : (
                          <Send className="w-3 h-3 mr-1.5" />
                        )}
                        Send reply
                      </Button>
                    </div>
                  </div>

                  {/* Internal admin notes */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Internal notes (admin-only, not visible to user)
                    </label>
                    <Textarea
                      value={notes}
                      onChange={(e) =>
                        setDraftNotes((prev) => ({ ...prev, [it.id]: e.target.value }))
                      }
                      rows={2}
                      placeholder="Root cause, who's working on it…"
                      className="text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!dirty || savingId === it.id}
                        onClick={() => updateIssue(it.id, { admin_notes: notes })}
                      >
                        {savingId === it.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : null}
                        Save notes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttachmentsStrip({ attachments }: { attachments: Array<{ path: string; name: string; size?: number; type?: string }> }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const a of attachments) {
        const { data } = await supabase.storage
          .from('support-attachments')
          .createSignedUrl(a.path, 60 * 60);
        if (data?.signedUrl) next[a.path] = data.signedUrl;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [attachments]);

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">Attachments ({attachments.length})</div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <a
            key={a.path}
            href={urls[a.path] || '#'}
            target="_blank"
            rel="noreferrer"
            className="relative block w-28 h-20 rounded-md overflow-hidden border border-border bg-muted hover:ring-2 hover:ring-primary transition"
            title={a.name}
          >
            {urls[a.path] ? (
              <img src={urls[a.path]} alt={a.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">loading…</div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

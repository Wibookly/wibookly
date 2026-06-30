import { useEffect, useRef, useState } from 'react';
import { PageHero } from '@/components/app/PageHero';
import { LifeBuoy, Loader2, RefreshCw, Inbox, ExternalLink, Send, RotateCcw, CheckCircle2, Paperclip, X, ImageIcon } from 'lucide-react';
import { HelpIssueForm } from '@/components/help/HelpIssueForm';
import { useSupportUnread } from '@/hooks/useSupportUnread';
import SupportIssuesPanel from '@/components/admin/SupportIssuesPanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from 'sonner';

interface MyTicket {
  id: string;
  subject: string;
  description: string;
  status: string;
  page_url: string | null;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  attachments?: Array<{ path: string; name: string; size?: number; type?: string }> | null;
}

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'destructive',
  in_progress: 'default',
  resolved: 'secondary',
  wont_fix: 'outline',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
};

function TicketDetailDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: MyTicket | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const MAX_FILES = 5;
  const MAX_BYTES = 10 * 1024 * 1024;

  const addReplyFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming).filter((f) => {
      if (!f.type.startsWith('image/')) {
        toast.error(`${f.name} isn't an image`);
        return false;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is over 10 MB`);
        return false;
      }
      return true;
    });
    setReplyFiles((prev) => [...prev, ...arr].slice(0, MAX_FILES));
  };

  const loadSignedUrls = async (attachments: Array<{ path: string; name: string }>) => {
    const next: Record<string, string> = {};
    for (const a of attachments) {
      if (urls[a.path]) { next[a.path] = urls[a.path]; continue; }
      const { data } = await supabase.storage
        .from('support-attachments')
        .createSignedUrl(a.path, 60 * 60);
      if (data?.signedUrl) next[a.path] = data.signedUrl;
    }
    return next;
  };

  const loadMessages = async () => {
    if (!ticket?.id) return;
    const { data } = await supabase
      .from('support_issue_messages' as any)
      .select('*')
      .eq('issue_id', ticket.id)
      .order('created_at', { ascending: true });
    const rows = (data ?? []) as any[];
    setMessages(rows);
    // Sign attachment URLs for messages
    const allAtts: Array<{ path: string; name: string }> = [];
    for (const m of rows) {
      if (Array.isArray(m.attachments)) allAtts.push(...m.attachments);
    }
    if (allAtts.length) {
      const signed = await loadSignedUrls(allAtts);
      setUrls((prev) => ({ ...prev, ...signed }));
    }
  };

  // Load attachments + messages + mark-as-read when dialog opens
  useEffect(() => {
    let cancelled = false;
    const atts = ticket?.attachments;
    if (!open || !ticket) {
      setUrls({});
      setMessages([]);
      setReply('');
      setReplyFiles([]);
      return;
    }
    (async () => {
      if (Array.isArray(atts) && atts.length > 0) {
        const signed = await loadSignedUrls(atts);
        if (!cancelled) setUrls((prev) => ({ ...prev, ...signed }));
      }
      await loadMessages();
      if (user?.id) {
        await supabase
          .from('support_issue_reads' as any)
          .upsert({ issue_id: ticket.id, user_id: user.id, last_read_at: new Date().toISOString() } as any);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket?.id]);

  const postReply = async () => {
    if (!ticket || !user?.id || (!reply.trim() && replyFiles.length === 0)) return;
    setSending(true);
    try {
      // Upload attachments first
      const attachments: Array<{ path: string; name: string; size: number; type: string }> = [];
      if (replyFiles.length) {
        const stamp = Date.now();
        for (const f of replyFiles) {
          const safe = f.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
          const path = `${user.id}/${ticket.id}/${stamp}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
          const { error: upErr } = await supabase.storage
            .from('support-attachments')
            .upload(path, f, { contentType: f.type, upsert: false });
          if (upErr) throw upErr;
          attachments.push({ path, name: f.name, size: f.size, type: f.type });
        }
      }

      const { error } = await supabase
        .from('support_issue_messages' as any)
        .insert({
          issue_id: ticket.id,
          organization_id: (ticket as any).organization_id ?? null,
          author_user_id: user.id,
          author_role: 'user',
          body: reply.trim(),
          attachments,
        } as any);
      if (error) throw error;
      // Re-open if resolved (user is following up)
      if (ticket.status === 'resolved') {
        await supabase
          .from('support_issues')
          .update({ status: 'open', resolved_at: null } as never)
          .eq('id', ticket.id);
      }
      setReply('');
      setReplyFiles([]);
      toast.success('Reply sent');
      await loadMessages();
      // Stay on the ticket — user closes manually when done.
    } catch (e: any) {
      toast.error(e?.message || 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status: string) => {
    if (!ticket) return;
    const patch: any = { status };
    if (status === 'resolved') patch.resolved_at = new Date().toISOString();
    else patch.resolved_at = null;
    const { error } = await supabase.from('support_issues').update(patch as never).eq('id', ticket.id);
    if (error) toast.error(error.message);
    else {
      toast.success(status === 'resolved' ? 'Marked resolved' : 'Re-opened');
      // Do NOT close the dialog — user closes manually.
    }
  };


  if (!ticket) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={STATUS_TONE[ticket.status] ?? 'secondary'} className="text-[10px]">
              {STATUS_LABEL[ticket.status] ?? ticket.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {format(new Date(ticket.created_at), 'PPpp')}
            </span>
          </div>
          <DialogTitle className="break-words">{ticket.subject}</DialogTitle>
          {ticket.page_url && (
            <DialogDescription className="text-xs inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              <code className="font-mono">{ticket.page_url}</code>
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">You · original</div>
            <p className="text-sm whitespace-pre-wrap break-words">{ticket.description}</p>
          </div>
          {Array.isArray(ticket.attachments) && ticket.attachments.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Attachments ({ticket.attachments.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {ticket.attachments.map((a) => (
                  <a
                    key={a.path}
                    href={urls[a.path] || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="relative block w-28 h-20 rounded-md overflow-hidden border bg-muted hover:ring-2 hover:ring-primary transition"
                    title={a.name}
                  >
                    {urls[a.path] ? (
                      <img src={urls[a.path]} alt={a.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
                        loading…
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Threaded messages */}
          {messages.length > 0 && (
            <div className="space-y-2">
              <Separator />
              {messages.map((m) => {
                const isMine = m.author_user_id === user?.id;
                const atts: Array<{ path: string; name: string }> = Array.isArray(m.attachments) ? m.attachments : [];
                return (
                  <div
                    key={m.id}
                    className={`rounded-md border px-3 py-2 ${
                      isMine ? 'bg-muted/30' : 'bg-primary/5 border-primary/30'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center justify-between">
                      <span>{isMine ? 'You' : m.author_role === 'admin' || m.author_role === 'super_admin' ? 'Support team' : 'Reply'}</span>
                      <span>{format(new Date(m.created_at), 'PPp')}</span>
                    </div>
                    {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                    {atts.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {atts.map((a) => (
                          <a
                            key={a.path}
                            href={urls[a.path] || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="block w-24 h-16 rounded border bg-muted overflow-hidden hover:ring-2 hover:ring-primary"
                            title={a.name}
                          >
                            {urls[a.path] ? (
                              <img src={urls[a.path]} alt={a.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">…</div>
                            )}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {ticket.admin_notes && (
            <div className="rounded bg-muted/40 border px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Internal note (admin)
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{ticket.admin_notes}</p>
            </div>
          )}
          {ticket.resolved_at && (
            <p className="text-[11px] text-muted-foreground">
              Resolved {formatDistanceToNow(new Date(ticket.resolved_at), { addSuffix: true })}
            </p>
          )}

          {/* Reply composer */}
          <Separator />
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Add a reply or update</label>
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              placeholder="Type a message to support…"
              className="text-sm"
            />
            {replyFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {replyFiles.map((f, i) => {
                  const url = URL.createObjectURL(f);
                  return (
                    <div key={i} className="relative w-20 h-16 rounded border overflow-hidden bg-muted">
                      <img src={url} alt={f.name} className="w-full h-full object-cover" onLoad={() => URL.revokeObjectURL(url)} />
                      <button
                        type="button"
                        onClick={() => setReplyFiles((p) => p.filter((_, idx) => idx !== i))}
                        className="absolute top-0.5 right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { addReplyFiles(e.target.files); if (e.target) e.target.value = ''; }}
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1.5 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={replyFiles.length >= MAX_FILES}
                >
                  <Paperclip className="w-3.5 h-3.5 mr-1.5" /> Attach
                </Button>
                {ticket.status !== 'resolved' ? (
                  <Button variant="outline" size="sm" onClick={() => setStatus('resolved')}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Mark resolved
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setStatus('open')}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Re-open
                  </Button>
                )}
              </div>
              <Button size="sm" onClick={postReply} disabled={(!reply.trim() && replyFiles.length === 0) || sending}>
                {sending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                Send reply
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MyTicketsList() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MyTicket | null>(null);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('support_issues')
      .select('id, subject, description, status, page_url, admin_notes, created_at, resolved_at, attachments, organization_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setTickets((data ?? []) as unknown as MyTicket[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="w-4 h-4" /> My tickets
          </CardTitle>
          <CardDescription className="text-xs">
            Click any ticket to see the full details and admin reply.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </CardHeader>
      <CardContent>
        {loading && tickets.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            You haven't submitted any tickets yet.
          </p>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t)}
                className="w-full text-left rounded-md border bg-card p-3 space-y-1.5 hover:bg-muted/40 hover:border-primary/40 transition cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="font-medium text-sm break-words min-w-0 flex-1">{t.subject}</div>
                  <Badge variant={STATUS_TONE[t.status] ?? 'secondary'} className="text-[10px]">
                    {STATUS_LABEL[t.status] ?? t.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-2 break-words">
                  {t.description}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  <span>Submitted {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</span>
                  {t.admin_notes && (
                    <>
                      <span>·</span>
                      <span className="text-primary font-medium">Admin replied</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
      <TicketDetailDialog
        ticket={selected}
        open={!!selected}
        onOpenChange={(v) => !v && setSelected(null)}
      />
    </Card>
  );
}

function UnreadPill({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span
      className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold animate-pulse"
      style={{ background: '#ef4444', color: '#fff' }}
      aria-label={`${count} unread`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

export default function Help() {
  const { isOrgAdmin } = useUserRoles();
  const unread = useSupportUnread();

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Knowledge Base"
          title="Help & Support"
          description="Send your admin team an issue, or check the status of tickets you've already submitted."
          accent="cyan"
          icon={<LifeBuoy className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in space-y-6">
        {isOrgAdmin ? (
          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">All tickets (admin)<UnreadPill count={unread.all} /></TabsTrigger>
              <TabsTrigger value="mine">My tickets<UnreadPill count={unread.mine} /></TabsTrigger>
              <TabsTrigger value="submit">Submit an issue</TabsTrigger>
              
            </TabsList>
            <TabsContent value="all" className="mt-4">
              <SupportIssuesPanel />
            </TabsContent>
            <TabsContent value="mine" className="mt-4">
              <MyTicketsList />
            </TabsContent>
            <TabsContent value="submit" className="mt-4 space-y-4">
              <Card>
                <CardContent className="p-6">
                  <HelpIssueForm />
                </CardContent>
              </Card>
              <MyTicketsList />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-6">
                <HelpIssueForm />
              </CardContent>
            </Card>
            <MyTicketsList />
          </div>
        )}
      </div>
    </div>
  );
}



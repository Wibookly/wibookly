// INTERNAL — testing harness, not user-facing. The production chat surface is
// src/pages/Chat.tsx (routed at /chat). Kept for direct knowledge-retrieval
// testing against agent-orchestrator + retrieve-context.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Send, Loader2, Sparkles, Mail, FileText, RefreshCw, Inbox, Check, BookOpen, Plus, MessageSquare, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type AgentMode = 'qa' | 'email_draft';

interface Citation {
  type: string;
  id: string | null;
  title: string;
  from?: string | null;
  sent_at?: string | null;
  snippet?: string | null;
  similarity?: number | null;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  draft?: { subject: string; body: string; to?: string[]; cc?: string[] } | null;
  draftSavedId?: string | null;
  citations?: Citation[];
}

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
  agent_mode: boolean;
}

export default function KnowledgeChat() {
  const { activeConnection } = useActiveEmail();
  const [mode, setMode] = useState<AgentMode>('qa');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [citationDetail, setCitationDetail] = useState<{
    loading: boolean;
    body?: string | null;
    thread?: Array<{ from_email: string | null; subject: string | null; body_clean: string | null; sent_at: string | null }>;
  }>({ loading: false });

  const openCitation = async (c: Citation) => {
    setActiveCitation(c);
    setCitationDetail({ loading: true });
    try {
      if (c.type === 'email' && c.id) {
        // Fetch the full message + sibling thread messages
        const { data: msg } = await supabase
          .from('email_messages')
          .select('body_clean, thread_id, subject, from_email, sent_at')
          .eq('id', c.id)
          .maybeSingle();
        if (msg?.thread_id) {
          const { data: thread } = await supabase
            .from('email_messages')
            .select('from_email, subject, body_clean, sent_at')
            .eq('thread_id', msg.thread_id)
            .order('sent_at', { ascending: true })
            .limit(50);
          setCitationDetail({ loading: false, body: msg.body_clean, thread: thread ?? [] });
        } else {
          setCitationDetail({ loading: false, body: msg?.body_clean ?? c.snippet ?? null });
        }
      } else if (c.id) {
        // Document chunk
        const { data: chunk } = await supabase
          .from('knowledge_chunks')
          .select('content')
          .eq('id', c.id)
          .maybeSingle();
        setCitationDetail({ loading: false, body: chunk?.content ?? c.snippet ?? null });
      } else {
        setCitationDetail({ loading: false, body: c.snippet ?? null });
      }
    } catch (e) {
      console.error('citation load', e);
      setCitationDetail({ loading: false, body: c.snippet ?? null });
    }
  };


  // (state declared above)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onUploadFile = async (file: File) => {
    if (!file || uploading) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File too large (max 25 MB)');
      return;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error('Not signed in');
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('knowledge-files')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (upErr) throw upErr;

      const { data, error } = await supabase.functions.invoke('ingest-document', {
        body: {
          storage_path: path,
          title: file.name,
          mime_type: file.type,
          filename: file.name,
          connection_id: activeConnection?.id ?? null,
          source_type: 'upload',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Indexed "${file.name}" (${data?.chunk_count ?? 0} chunks).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const syncEmails = async () => {
    if (!activeConnection?.id || syncing) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ingest-email', {
        body: { connection_id: activeConnection.id, max_messages: 100 },
      });
      if (error) throw error;
      const ingested = data?.ingested ?? data?.messages_ingested ?? 0;
      const embedded = data?.embedded ?? 0;
      toast.success(`Synced ${ingested} message${ingested === 1 ? '' : 's'} (${embedded} embedded).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Email sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);

  const saveDraft = async (turn: ChatTurn) => {
    if (!turn.draft || !activeConnection?.id || savingDraftId) return;
    setSavingDraftId(turn.id);
    try {
      const { data, error } = await supabase.functions.invoke('push-draft-to-provider', {
        body: {
          connection_id: activeConnection.id,
          subject: turn.draft.subject,
          body: turn.draft.body,
          to: turn.draft.to ?? [],
          cc: turn.draft.cc ?? [],
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const draftId = data?.id || data?.messageId || 'saved';
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, draftSavedId: draftId } : t)),
      );
      toast.success('Draft saved to your mailbox. Open your email app to review and send.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save draft');
    } finally {
      setSavingDraftId(null);
    }
  };

  // Reset conversation when switching mode or workspace
  useEffect(() => {
    setConversationId(null);
    setTurns([]);
  }, [mode, activeConnection?.id]);

  // Load conversation list for the current connection
  const loadConversations = async () => {
    if (!activeConnection?.id) {
      setConversations([]);
      return;
    }
    const { data, error } = await supabase
      .from('ai_chat_conversations')
      .select('id, title, updated_at, agent_mode')
      .eq('connection_id', activeConnection.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('loadConversations', error);
      return;
    }
    setConversations((data ?? []) as ConversationSummary[]);
  };

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id]);

  const openConversation = async (convId: string) => {
    if (loadingConvId) return;
    setLoadingConvId(convId);
    try {
      const { data, error } = await supabase
        .from('ai_chat_messages')
        .select('id, role, content, tool_results, citations, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const restored: ChatTurn[] = (data ?? [])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content ?? '',
          draft: m.tool_results?.draft ?? null,
          draftSavedId: null,
          citations: Array.isArray(m.citations) ? m.citations : [],
        }));
      setConversationId(convId);
      setTurns(restored);
      const conv = conversations.find((c) => c.id === convId);
      if (conv) setMode(conv.agent_mode ? 'email_draft' : 'qa');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load conversation');
    } finally {
      setLoadingConvId(null);
    }
  };

  const newChat = () => {
    setConversationId(null);
    setTurns([]);
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    const { error } = await supabase.from('ai_chat_conversations').delete().eq('id', convId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    if (conversationId === convId) newChat();
    toast.success('Conversation deleted');
  };


  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    if (!activeConnection?.id) {
      toast.error('Connect an email account first.');
      return;
    }

    setInput('');
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: message }]);
    setBusy(true);

    try {
      const { data, error } = await supabase.functions.invoke('agent-orchestrator', {
        body: {
          conversation_id: conversationId,
          connection_id: activeConnection.id,
          agent: mode,
          user_message: message,
        },
      });
      if (error) throw error;

      if (data?.conversation_id) setConversationId(data.conversation_id);
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data?.reply || 'No response.',
          draft: data?.draft || null,
          citations: Array.isArray(data?.citations) ? data.citations : [],
        },
      ]);
      loadConversations();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      toast.error(msg);
      setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] max-w-7xl mx-auto w-full">
      {/* Conversation history rail */}
      <aside className="hidden md:flex flex-col w-64 border-r bg-card/40 shrink-0">
        <div className="p-3 border-b">
          <Button
            onClick={newChat}
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2"
          >
            <Plus className="h-4 w-4" /> New chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {conversations.length === 0 && (
              <div className="px-2 py-6 text-xs text-muted-foreground text-center">
                No past conversations yet.
              </div>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={cn(
                  'group w-full text-left rounded-md px-2 py-2 text-xs flex items-start gap-2 hover:bg-muted transition-colors',
                  conversationId === c.id && 'bg-muted',
                )}
              >
                {c.agent_mode ? (
                  <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate" title={c.title}>
                  {c.title || 'Untitled'}
                </span>
                {loadingConvId === c.id ? (
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                ) : (
                  <Trash2
                    className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-destructive"
                    onClick={(e) => deleteConversation(c.id, e)}
                  />
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex flex-col flex-1 min-w-0 p-6 gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Knowledge Assistant
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Grounded answers and email drafts using your indexed documents and prior emails.
          </p>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as AgentMode)}>
          <TabsList>
            <TabsTrigger value="qa" className="gap-1.5">
              <FileText className="h-4 w-4" /> Q&amp;A
            </TabsTrigger>
            <TabsTrigger value="email_draft" className="gap-1.5">
              <Mail className="h-4 w-4" /> Draft Email
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="py-3 border-b flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {activeConnection?.email
                ? `Workspace: ${activeConnection.email}`
                : 'No active workspace'}
            </CardTitle>
            <CardDescription className="text-xs">
              Drafts always require your review before sending.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadFile(f);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload Doc
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={syncEmails}
              disabled={syncing || !activeConnection?.id}
              className="gap-1.5"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sync Emails
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {turns.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-12">
                  {mode === 'qa'
                    ? 'Ask anything about your knowledge base or recent emails.'
                    : 'Describe the email you want to draft (recipient, intent, context).'}
                </div>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex',
                    t.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap',
                      t.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted',
                    )}
                  >
                    {t.content}
                    {t.draft && (
                      <div className="mt-3 border rounded-md bg-background text-foreground p-3 space-y-2">
                        <Badge variant="secondary" className="gap-1">
                          <Mail className="h-3 w-3" /> Draft for review
                        </Badge>
                        {!!t.draft.to?.length && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">To: </span>
                            {t.draft.to.join(', ')}
                          </div>
                        )}
                        {!!t.draft.cc?.length && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Cc: </span>
                            {t.draft.cc.join(', ')}
                          </div>
                        )}
                        <div className="text-sm font-medium">{t.draft.subject}</div>
                        <div className="text-sm whitespace-pre-wrap">{t.draft.body}</div>
                        <div className="pt-1">
                          <Button
                            size="sm"
                            variant={t.draftSavedId ? 'secondary' : 'default'}
                            onClick={() => saveDraft(t)}
                            disabled={!!t.draftSavedId || savingDraftId === t.id || !activeConnection?.id}
                            className="gap-1.5"
                          >
                            {savingDraftId === t.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : t.draftSavedId ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Inbox className="h-3.5 w-3.5" />
                            )}
                            {t.draftSavedId ? 'Saved to Drafts' : 'Save to Drafts'}
                          </Button>
                        </div>
                      </div>
                    )}
                    {t.role === 'assistant' && !!t.citations?.length && (
                      <div className="mt-3 pt-2 border-t border-border/60">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                          <BookOpen className="h-3 w-3" /> Sources
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {t.citations.map((c, idx) => (
                            <button
                              key={`${c.id ?? idx}-${idx}`}
                              onClick={() => openCitation(c)}
                              className="inline-flex"
                              title={c.snippet || c.title}
                            >
                              <Badge
                                variant="outline"
                                className="gap-1 max-w-[260px] font-normal cursor-pointer hover:bg-muted transition-colors"
                              >
                                {c.type === 'email' ? (
                                  <Mail className="h-3 w-3 shrink-0" />
                                ) : (
                                  <FileText className="h-3 w-3 shrink-0" />
                                )}
                                <span className="truncate text-xs">
                                  [{idx + 1}] {c.title}
                                </span>
                              </Badge>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-4 py-2.5 text-sm flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking…
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={
            mode === 'qa'
              ? 'Ask a question about your knowledge or emails…'
              : 'Describe the email you want to draft…'
          }
          rows={2}
          disabled={busy}
          className="resize-none"
        />
        <Button onClick={send} disabled={busy || !input.trim()} size="lg">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      </div>

      <Sheet open={!!activeCitation} onOpenChange={(o) => !o && setActiveCitation(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {activeCitation && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-base">
                  {activeCitation.type === 'email' ? (
                    <Mail className="h-4 w-4 text-primary" />
                  ) : (
                    <FileText className="h-4 w-4 text-primary" />
                  )}
                  <span className="truncate">{activeCitation.title}</span>
                </SheetTitle>
                <SheetDescription className="text-xs">
                  {activeCitation.from && <span>From {activeCitation.from} · </span>}
                  {activeCitation.sent_at && (
                    <span>{new Date(activeCitation.sent_at).toLocaleString()}</span>
                  )}
                  {typeof activeCitation.similarity === 'number' && (
                    <span className="ml-1">
                      · {Math.round(activeCitation.similarity * 100)}% match
                    </span>
                  )}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4">
                {citationDetail.loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : citationDetail.thread && citationDetail.thread.length > 0 ? (
                  <div className="space-y-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Thread ({citationDetail.thread.length} message{citationDetail.thread.length === 1 ? '' : 's'})
                    </div>
                    {citationDetail.thread.map((m, i) => (
                      <div key={i} className="border rounded-md p-3 bg-card">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="text-xs font-medium truncate">{m.from_email || 'Unknown'}</div>
                          <div className="text-[10px] text-muted-foreground shrink-0">
                            {m.sent_at ? new Date(m.sent_at).toLocaleString() : ''}
                          </div>
                        </div>
                        {m.subject && (
                          <div className="text-xs text-muted-foreground mb-1.5 truncate">{m.subject}</div>
                        )}
                        <div className="text-xs whitespace-pre-wrap leading-relaxed">
                          {m.body_clean ?? '(no content)'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap leading-relaxed border rounded-md p-3 bg-card">
                    {citationDetail.body || activeCitation.snippet || 'No content available.'}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

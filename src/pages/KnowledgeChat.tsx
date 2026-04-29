import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Loader2, Sparkles, Mail, FileText, RefreshCw, Inbox, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type AgentMode = 'qa' | 'email_draft';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  draft?: { subject: string; body: string; to?: string[]; cc?: string[] } | null;
  draftSavedId?: string | null;
}

export default function KnowledgeChat() {
  const { activeConnection } = useActiveEmail();
  const [mode, setMode] = useState<AgentMode>('qa');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

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

  // Reset conversation when switching mode or workspace
  useEffect(() => {
    setConversationId(null);
    setTurns([]);
  }, [mode, activeConnection?.id]);

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
        },
      ]);
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
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto p-6 gap-4">
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
  );
}

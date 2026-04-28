import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { MiniMarkdown } from './MiniMarkdown';
import { buildHelpKnowledge, describePageContext } from './buildHelpKnowledge';
import { useToast } from '@/hooks/use-toast';

type Msg = { role: 'user' | 'assistant'; content: string };

const STORAGE_KEY = 'inboxiq:help-chat:transcript';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/help-chat`;

const SUGGESTIONS = [
  'How do I connect my mailbox?',
  'How do I turn on AI Drafts for one category?',
  'I configured everything — why am I not seeing drafts?',
  'How do I schedule the Daily Brief?',
];

export function HelpChat() {
  const location = useLocation();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore transcript from session storage (per-tab persistence only)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* quota or disabled */
    }
  }, [messages]);

  // Autoscroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, streaming]);

  const knowledge = useMemo(() => buildHelpKnowledge(), []);
  const pageContext = useMemo(
    () => describePageContext(location.pathname),
    [location.pathname],
  );

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const userMsg: Msg = { role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setStreaming(true);

    let assistantSoFar = '';
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantSoFar } : m,
          );
        }
        return [...prev, { role: 'assistant', content: assistantSoFar }];
      });
    };

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          messages: next,
          knowledge,
          pageContext,
        }),
      });

      if (!resp.ok) {
        let msg = 'AI is not available right now.';
        try {
          const j = await resp.json();
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        if (resp.status === 429) {
          toast({ title: 'Slow down', description: msg });
        } else if (resp.status === 402) {
          toast({
            title: 'AI credits exhausted',
            description: msg,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Help chat error',
            description: msg,
            variant: 'destructive',
          });
        }
        // Roll back the optimistic user msg so they can edit & retry
        setMessages((prev) => prev.filter((m) => m !== userMsg));
        return;
      }

      if (!resp.body) {
        toast({
          title: 'Help chat error',
          description: 'Empty response from AI.',
          variant: 'destructive',
        });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const { value, done: rdrDone } = await reader.read();
        if (rdrDone) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || !line.trim()) continue;
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) upsert(delta);
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('help-chat client error', err);
      toast({
        title: 'Help chat error',
        description: err instanceof Error ? err.message : 'Network error',
        variant: 'destructive',
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 py-2 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-6 space-y-4">
            <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Ask the InboxIQ AI assistant</p>
              <p className="text-xs text-muted-foreground mt-1">
                Grounded in the help articles. Doesn't read your inbox.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 text-left">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-xs text-foreground bg-muted/40 hover:bg-muted px-3 py-2 rounded-md border border-border transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {m.role === 'assistant' ? (
                  <MiniMarkdown source={m.content || '…'} />
                ) : (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                )}
              </div>
            </div>
          ))
        )}
        {streaming && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t pt-3 space-y-2">
        {messages.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="h-7 text-xs"
            >
              <Trash2 className="h-3 w-3 mr-1" /> New chat
            </Button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything about InboxIQ…"
            rows={2}
            className="resize-none text-sm"
            disabled={streaming}
          />
          <Button
            type="button"
            size="icon"
            onClick={() => send(input)}
            disabled={streaming || !input.trim()}
            aria-label="Send message"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">
          AI answers can be wrong. If something looks off, submit an issue.
        </p>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

/**
 * Reusable FinanceIQ chat dock — pill → panel → maximize.
 * Reuses the app's existing chat-agent edge function and chat_conversations
 * table. Every dock conversation lives in the user's "Unanet" chat folder so
 * it persists inside the main AI Chat sidebar. Maximizing navigates to
 * /chat/:id so the same thread continues in the full page.
 */

const UNANET_SYSTEM_GUARD =
  'You are FinanceIQ, an assistant scoped to this organization\'s Unanet A/E data ' +
  '(projects, financials, AR/AP, WIP, utilization, CRM pipeline, timesheets, invoicing). ' +
  'Answer only questions about Unanet data or the finance dashboards it powers. ' +
  'For unrelated topics, politely decline in one sentence and redirect the user back to Unanet-related questions.';

type Msg = { role: 'user' | 'assistant'; content: string };

export function FinanceChatDock({
  suggestions = [
    'Which projects are over budget?',
    'Draft a collections email for 90+ day AR',
    'What is my utilization by team this month?',
    'Show pipeline weighted by win probability',
  ],
}: { suggestions?: string[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const folderIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Ensure a "Unanet" chat folder exists for this user.
  const ensureFolder = async (): Promise<string | null> => {
    if (folderIdRef.current) return folderIdRef.current;
    if (!user) return null;
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!prof?.organization_id) return null;
    const { data: existing } = await supabase
      .from('chat_folders')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', 'Unanet')
      .maybeSingle();
    if (existing?.id) {
      folderIdRef.current = existing.id;
      return existing.id;
    }
    const { data: created } = await supabase
      .from('chat_folders')
      .insert({ user_id: user.id, organization_id: prof.organization_id, name: 'Unanet' })
      .select('id')
      .single();
    folderIdRef.current = created?.id ?? null;
    return folderIdRef.current;
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setSending(true);

    // Placeholder assistant message we will fill as tokens arrive.
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);

    try {
      const folder_id = await ensureFolder();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectRef}.supabase.co/functions/v1/chat-agent`;

      // Frontend scope guard: prepend the Unanet-only instruction. Backend
      // enforces the same guard; we keep the client-side hint per spec.
      const messageText = `[SYSTEM]\n${UNANET_SYSTEM_GUARD}\n[/SYSTEM]\n\n${text}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          message: messageText,
          conversation_id: threadId ?? undefined,
          folder_id: threadId ? undefined : folder_id ?? undefined,
          stream: true,
        }),
      });

      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('text/event-stream') && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let acc = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const ev of events) {
            const line = ev.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'conversation' && data.conversation_id) {
                setThreadId(data.conversation_id);
              } else if (data.type === 'token' && typeof data.content === 'string') {
                acc += data.content;
                setMessages((m) => {
                  const next = [...m];
                  next[next.length - 1] = { role: 'assistant', content: acc };
                  return next;
                });
              }
            } catch { /* ignore malformed frame */ }
          }
        }
      } else {
        const json = await resp.json().catch(() => null);
        const content = json?.message ?? json?.content ?? 'No response.';
        if (json?.conversation_id) setThreadId(json.conversation_id);
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: 'assistant', content };
          return next;
        });
      }
    } catch (e: any) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: 'assistant',
          content: `Sorry — I couldn't reach the assistant (${e?.message ?? 'error'}).`,
        };
        return next;
      });
    } finally {
      setSending(false);
    }
  };

  const maximize = () => {
    // Continue the same thread on the full AI Chat page.
    if (threadId) navigate(`/chat/${threadId}`);
    else navigate('/chat');
  };

  const pillGradient = 'linear-gradient(135deg,#8b5cf6,#e879b9)';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-medium shadow-2xl shadow-fuchsia-900/40"
        style={{ background: pillGradient }}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white/70 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
        </span>
        ✦ Ask FinanceIQ
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[360px] max-h-[70vh] flex flex-col rounded-2xl border shadow-2xl"
      style={{ background: '#0f131c', borderColor: '#1e2634', color: '#eef2f8' }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-2xl"
        style={{ background: 'linear-gradient(135deg,rgba(139,92,246,0.25),rgba(232,121,185,0.20))', borderBottom: '1px solid #1e2634' }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2 w-2 rounded-full" style={{ background: '#3ecf8e', boxShadow: '0 0 8px #3ecf8e' }} />
          ✦ FinanceIQ Assistant
        </div>
        <div className="flex items-center gap-1">
          <button onClick={maximize} title="Open in AI Chat" className="p-1 rounded hover:bg-white/10 text-[#8892a4]">⤢</button>
          <button onClick={() => setOpen(false)} title="Minimize" className="p-1 rounded hover:bg-white/10 text-[#8892a4]">—</button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-[#8892a4] text-xs">Ask about your Unanet data — projects, AR/AP, WIP, utilization, CRM pipeline.</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-[11px] px-2 py-1 rounded-full border text-[#eef2f8]/90 hover:bg-white/5"
                  style={{ borderColor: '#1e2634', background: '#131926' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className="max-w-[85%] rounded-xl px-3 py-2 whitespace-pre-wrap text-[13px] leading-relaxed"
              style={
                m.role === 'user'
                  ? { background: 'linear-gradient(135deg,#8b5cf6,#a78bfa)', color: 'white' }
                  : { background: '#131926', border: '1px solid #1e2634' }
              }
            >
              {m.content || (sending && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="p-2 flex items-center gap-2 border-t"
        style={{ borderColor: '#1e2634' }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder="Ask FinanceIQ about Unanet…"
          className="flex-1 bg-transparent outline-none px-2 py-1.5 text-sm placeholder:text-[#5a6474]"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium disabled:opacity-50"
          style={{ background: pillGradient }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

export default FinanceChatDock;

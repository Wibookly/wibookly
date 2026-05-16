import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import {
  Send, Plus, Trash2, Menu, X, Paperclip, Sun, Moon, Loader2,
  Copy, RefreshCw, Mail, FileText, Calendar, BarChart3, LogOut, Settings,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PageHero } from '@/components/app/PageHero';
import { AgentAvatar } from '@/components/ai/AgentAvatar';

interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}
interface Msg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  attachments?: string[] | null;
}

const examplePrompts = [
  { icon: Mail, title: 'Draft an email', desc: 'to my team about Q1 priorities' },
  { icon: FileText, title: 'Summarize a document', desc: 'and pull out the key action items' },
  { icon: Calendar, title: 'Prepare for a meeting', desc: 'review my calendar and recent emails' },
  { icon: BarChart3, title: 'Analyze data', desc: 'trends in my recent activity' },
];

const THEME_KEY = 'inboxiq-chat-theme';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null;
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

function dateBucket(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return 'Previous 7 days';
  return 'Older';
}

export default function Chat() {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const { hasFeature, loading: featLoading } = useFeatureAccess();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const { theme, toggle: toggleTheme } = useTheme();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(params.id || null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [blocked, setBlocked] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' });
  const [usage, setUsage] = useState<{ used: number; limit: number | null }>({ used: 0, limit: null });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';
  const canChat = isSuperAdmin || hasFeature('ai_assistant');

  // Sync url param to active id
  useEffect(() => {
    if (params.id && params.id !== activeId) setActiveId(params.id);
  }, [params.id, activeId]);

  // Load conversation list
  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('chat_conversations')
      .select('id, title, created_at, updated_at')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(100);
    setConversations((data as Conversation[]) || []);
  }, [user]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load messages
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, role, content, created_at, attachments')
        .eq('conversation_id', activeId)
        .order('created_at', { ascending: true });
      setMessages(((data as Msg[]) || []).filter((m) => m.role !== 'system'));
    })();
  }, [activeId]);

  // Load usage (today)
  const loadUsage = useCallback(async () => {
    if (!user || !profile?.organization_id) return;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('ai_usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('action', 'ai_chat')
      .gte('created_at', startOfDay.toISOString());
    // Get user group's daily limit
    const { data: gm } = await supabase
      .from('user_group_memberships')
      .select('group_id, permission_groups!inner(display_order)')
      .eq('user_id', user.id);
    let limit: number | null = null;
    if (gm && gm.length) {
      const groupIds = gm.map((g: { group_id: string }) => g.group_id);
      const { data: feats } = await supabase
        .from('group_features')
        .select('daily_limit, group_id')
        .eq('feature_key', 'ai_chat')
        .in('group_id', groupIds);
      if (feats?.length) {
        limit = Math.max(...feats.map((f: { daily_limit: number }) => f.daily_limit || 0)) || null;
      }
    }
    setUsage({ used: count || 0, limit });
  }, [user, profile?.organization_id]);

  useEffect(() => { loadUsage(); }, [loadUsage]);

  // Auto-scroll only if user near bottom
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText]);

  const onScrollContainer = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 120;
  };

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 8 * 24) + 'px';
  }, [input]);

  const groupedConversations = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      const k = dateBucket(c.updated_at || c.created_at);
      (groups[k] = groups[k] || []).push(c);
    }
    return groups;
  }, [conversations]);

  const handleNewChat = () => {
    setActiveId(null);
    setMessages([]);
    setInput('');
    setFiles([]);
    setSidebarOpen(false);
    navigate('/chat');
  };

  const handleSelectConv = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    navigate(`/chat/${id}`);
  };

  const handleDeleteConv = async (id: string) => {
    await supabase.from('chat_conversations').delete().eq('id', id);
    if (activeId === id) handleNewChat();
    loadConversations();
  };

  const uploadFiles = async (toUpload: File[]): Promise<string[]> => {
    if (!user || !toUpload.length) return [];
    const urls: string[] = [];
    for (const f of toUpload) {
      const path = `${user.id}/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('chat-attachments').upload(path, f);
      if (error) { toast.error(`Upload failed: ${f.name}`); continue; }
      const { data } = await supabase.storage.from('chat-attachments').createSignedUrl(path, 60 * 60 * 24);
      if (data?.signedUrl) urls.push(data.signedUrl);
    }
    return urls;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming || !user) return;
    setInput('');
    stickToBottomRef.current = true;

    const tempUserMsg: Msg = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
      attachments: files.length ? files.map((f) => f.name) : null,
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    const toUpload = files;
    setFiles([]);
    setIsStreaming(true);
    setStreamingText('');

    try {
      const attachmentUrls = await uploadFiles(toUpload);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectRef}.supabase.co/functions/v1/ai-assistant-chat`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          message: text,
          conversation_id: activeId,
          attachments: attachmentUrls,
          stream: true,
        }),
      });

      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('text/event-stream') && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assembled = '';
        let newConvId: string | null = activeId;
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
              if (data.type === 'conversation') {
                newConvId = data.conversation_id;
                if (!activeId && newConvId) {
                  setActiveId(newConvId);
                  navigate(`/chat/${newConvId}`, { replace: true });
                }
              } else if (data.type === 'token') {
                assembled += data.content;
                setStreamingText(assembled);
              } else if (data.type === 'blocked') {
                setBlocked({ open: true, reason: data.reason });
              } else if (data.type === 'done') {
                // finalize
              } else if (data.type === 'error') {
                toast.error(data.message || 'Stream error');
              }
            } catch {/* ignore */}
          }
        }
        // Reload messages & conversations to capture saved rows
        if (newConvId) {
          const { data: msgs } = await supabase
            .from('chat_messages')
            .select('id, role, content, created_at, attachments')
            .eq('conversation_id', newConvId)
            .order('created_at', { ascending: true });
          setMessages(((msgs as Msg[]) || []).filter((m) => m.role !== 'system'));
        }
        loadConversations();
        loadUsage();
      } else {
        const data = await resp.json();
        if (data.blocked) {
          setBlocked({ open: true, reason: data.reason });
        } else if (data.error) {
          toast.error(data.error);
        } else {
          if (data.conversation_id && !activeId) {
            setActiveId(data.conversation_id);
            navigate(`/chat/${data.conversation_id}`, { replace: true });
          }
          const cid = data.conversation_id || activeId;
          if (cid) {
            const { data: msgs } = await supabase
              .from('chat_messages')
              .select('id, role, content, created_at, attachments')
              .eq('conversation_id', cid)
              .order('created_at', { ascending: true });
            setMessages(((msgs as Msg[]) || []).filter((m) => m.role !== 'system'));
          }
          loadConversations();
          loadUsage();
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const next: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} > 10MB`); continue; }
      if (!accepted.includes(f.type) && !/\.(pdf|png|jpe?g|docx|txt)$/i.test(f.name)) {
        toast.error(`${f.name} not supported`); continue;
      }
      next.push(f);
    }
    setFiles((prev) => [...prev, ...next].slice(0, 3));
  };

  if (authLoading || featLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!canChat) return <Navigate to="/chat/upgrade" replace />;

  const usagePct = usage.limit ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  const usageColor =
    usagePct >= 100 ? 'text-destructive' :
    usagePct >= 80 ? 'text-orange-500' :
    usagePct >= 50 ? 'text-yellow-500' :
    'text-muted-foreground';
  const limitReached = usage.limit !== null && usage.used >= usage.limit;

  const userInitial = (profile?.full_name || profile?.email || 'U').charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <aside className={cn(
        'fixed lg:static inset-y-0 left-0 z-40 w-[260px] bg-card border-r border-border flex flex-col transition-transform',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="font-semibold text-sm">InboxIQ Chat</span>
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-3">
          <Button onClick={handleNewChat} variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" /> New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
          {Object.entries(groupedConversations).map(([label, items]) => (
            <div key={label}>
              <div className="px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
              {items.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-center gap-2 px-2 py-2 rounded-md text-sm cursor-pointer hover:bg-accent',
                    activeId === c.id && 'bg-accent'
                  )}
                  onClick={() => handleSelectConv(c.id)}
                >
                  <span className="flex-1 truncate">{c.title || 'New chat'}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background"
                    onClick={(e) => { e.stopPropagation(); handleDeleteConv(c.id); }}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!conversations.length && (
            <div className="px-2 py-6 text-xs text-muted-foreground text-center">
              No conversations yet
            </div>
          )}
        </div>
        <div className="border-t border-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 w-full text-left hover:bg-accent rounded-md p-2 transition">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">{userInitial}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{profile?.full_name || profile?.email}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleTheme}>
                {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b border-border h-14 flex items-center px-4 gap-2">
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <div className="font-semibold">Energy Forward AI Chat</div>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>

        <div
          ref={scrollContainerRef}
          onScroll={onScrollContainer}
          className="flex-1 overflow-y-auto"
        >
          {messages.length === 0 && !streamingText ? (
            <div className="max-w-4xl mx-auto px-4 pt-6 pb-16">
              <PageHero
                eyebrow="AI Assistant"
                title="InboxIQ Chat"
                description="Ask anything about your inbox, calendar, or work. Drafts, summaries, follow-ups — all in one place."
                accent="blue"
                icon={<AgentAvatar active={isStreaming} className="w-10 h-10 rounded-xl" />}
              />
              <div className="flex flex-col items-center mt-4">
                <AgentAvatar active={isStreaming} className="w-16 h-16 mb-4" />
                <h2 className="text-xl font-semibold mb-2">How can I help you today?</h2>
                <p className="text-muted-foreground mb-6 text-sm">Pick a starter or type your own message.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                  {examplePrompts.map((p) => (
                    <button
                      key={p.title}
                      onClick={() => setInput(`${p.title} ${p.desc}`)}
                      className="text-left border-2 border-border rounded-xl p-4 hover:border-primary hover:bg-accent transition group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-muted group-hover:bg-background">
                          <p.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{p.title}</div>
                          <div className="text-xs text-muted-foreground">{p.desc}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-10 text-xs text-muted-foreground">Type your message below to start</div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.map((m) => <MessageBubble key={m.id} message={m} userInitial={userInitial} />)}
              {isStreaming && (
                <MessageBubble
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamingText || '...',
                    created_at: new Date().toISOString(),
                  }}
                  userInitial={userInitial}
                  streaming
                />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-background">
          <div className="max-w-3xl mx-auto px-4 py-4">
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 bg-muted rounded-md px-2 py-1 text-xs">
                    <FileText className="h-3 w-3" />
                    <span className="truncate max-w-[160px]">{f.name}</span>
                    <span className="text-muted-foreground">{(f.size / 1024).toFixed(0)}KB</span>
                    <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative flex items-end gap-2 border border-border rounded-2xl p-2 bg-background focus-within:ring-2 focus-within:ring-ring">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className="hidden"
                onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={isStreaming || limitReached}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={limitReached ? 'Daily limit reached' : 'Message InboxIQ...'}
                disabled={isStreaming || limitReached}
                rows={1}
                className="flex-1 resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent min-h-0 py-2"
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSend}
                disabled={!input.trim() || isStreaming || limitReached}
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className={usageColor}>
                {usage.limit
                  ? limitReached
                    ? `Limit reached. Resets at midnight UTC`
                    : `${usage.used} / ${usage.limit} messages used today`
                  : `${usage.used} messages today`}
              </span>
              {input.length > 1000 && (
                <span className="text-muted-foreground">{input.length} chars</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Blocked dialog */}
      <Dialog open={blocked.open} onOpenChange={(o) => setBlocked({ ...blocked, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠️ AI Chat Limit Reached</DialogTitle>
            <DialogDescription>
              {blocked.reason === 'feature_disabled'
                ? 'AI Chat is not enabled for your tier. Contact your admin to upgrade.'
                : `You've reached your daily AI Chat limit. It resets at midnight UTC.`}
              {usage.limit ? ` (${usage.used} / ${usage.limit} messages today)` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setBlocked({ ...blocked, open: false })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MessageBubble({
  message,
  userInitial,
  streaming,
}: {
  message: Msg;
  userInitial: string;
  streaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const copy = () => {
    navigator.clipboard.writeText(message.content);
    toast.success('Copied');
  };

  return (
    <div className={cn('flex gap-3 group', isUser && 'flex-row-reverse')}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={cn('text-xs', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
          {isUser ? userInitial : 'IQ'}
        </AvatarFallback>
      </Avatar>
      <div className={cn('max-w-[85%] flex flex-col gap-1', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:bg-background [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {message.content}
              </ReactMarkdown>
              {streaming && <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse align-middle ml-1" />}
            </div>
          )}
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.attachments.map((a, i) => (
              <span key={i} className="text-xs bg-muted/60 rounded px-2 py-0.5 inline-flex items-center gap-1">
                <FileText className="h-3 w-3" /> {typeof a === 'string' ? a.split('/').pop()?.split('?')[0] : 'file'}
              </span>
            ))}
          </div>
        )}
        {!isUser && !streaming && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
            <button onClick={copy} className="p-1 hover:bg-accent rounded text-muted-foreground" title="Copy">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import {
  Send, Plus, Trash2, Menu, X, Paperclip, Sun, Moon, Loader2,
  Copy, RefreshCw, Mail, FileText, Calendar, BarChart3, LogOut, Settings,
  MoreVertical, Download, FileSpreadsheet, AlertTriangle, Globe,
  Folder, FolderPlus, ChevronRight, ChevronDown, FolderInput, Check,
  Sparkles, Volume2, VolumeX, Mic, Square,
} from 'lucide-react';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { AgentAvatar } from '@/components/ai/AgentAvatar';

interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  folder_id: string | null;
}
interface Folder {
  id: string;
  name: string;
  created_at: string;
}
interface Citation {
  source?: string;
  source_type?: string;
  id?: string | null;
  title?: string;
  url?: string | null;
  from?: string | null;
  sent_at?: string | null;
  snippet?: string | null;
}
interface Msg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  attachments?: string[] | null;
  citations?: Citation[] | null;
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

const RETENTION_DAYS = 30;
const EXPIRY_WARN_DAYS = 7; // warn within 7 days of deletion

function daysUntilExpiry(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = Math.floor(ageMs / 86400000);
  return Math.max(0, RETENTION_DAYS - ageDays);
}

function downloadBase64File(filename: string, mime: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Chat() {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const { activeConnection } = useActiveEmail();
  const { hasFeature, loading: featLoading } = useFeatureAccess();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const { theme, toggle: toggleTheme } = useTheme();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [activeId, setActiveId] = useState<string | null>(params.id || null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [blocked, setBlocked] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' });
  const [usage, setUsage] = useState<{ used: number; limit: number | null }>({ used: 0, limit: null });
  const [webSearch, setWebSearch] = useState(false);
  const [userLocation, setUserLocation] = useState<{ city?: string; region?: string; country?: string; timezone?: string } | null>(null);
  const [deepMode, setDeepMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('inboxiq-chat-deep') === '1';
  });
  const [voiceOut, setVoiceOut] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('inboxiq-chat-voice') === '1';
  });
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  useEffect(() => { localStorage.setItem('inboxiq-chat-deep', deepMode ? '1' : '0'); }, [deepMode]);
  useEffect(() => { localStorage.setItem('inboxiq-chat-voice', voiceOut ? '1' : '0'); }, [voiceOut]);

  const speak = useCallback((text: string, id: string) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) { toast.error('Speech not supported in this browser'); return; }
      synth.cancel();
      const clean = text.replace(/```[\s\S]*?```/g, ' code block ').replace(/[#*_`>~]/g, '').slice(0, 4000);
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.0; u.pitch = 1.0;
      u.onend = () => setSpeakingId(null);
      u.onerror = () => setSpeakingId(null);
      setSpeakingId(id);
      synth.speak(u);
    } catch { setSpeakingId(null); }
  }, []);
  const stopSpeak = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setSpeakingId(null);
  }, []);
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }, []);

  // Voice input: hold-or-toggle mic → Whisper → append transcript to input.
  const { isRecording, isTranscribing, startRecording, stopRecording } = useVoiceRecording({
    onTranscription: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text).trim());
      // Refocus textarea so the user can immediately send / edit.
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';
  const canChat = isSuperAdmin || hasFeature('ai_assistant');
  const canWebSearch = isSuperAdmin || hasFeature('ai_chat_web_search');

  // Sync url param to active id
  useEffect(() => {
    if (params.id && params.id !== activeId) setActiveId(params.id);
  }, [params.id, activeId]);

  // Load conversation list
  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('chat_conversations')
      .select('id, title, created_at, updated_at, folder_id')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(200);
    setConversations((data as Conversation[]) || []);
  }, [user]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load folders
  const loadFolders = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('chat_folders')
      .select('id, name, created_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    setFolders((data as Folder[]) || []);
  }, [user]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  // Persist expanded folders per-user in localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('inboxiq-chat-expanded-folders');
      if (raw) setExpandedFolders(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('inboxiq-chat-expanded-folders', JSON.stringify(Array.from(expandedFolders)));
    } catch { /* ignore */ }
  }, [expandedFolders]);

  // Folder operations
  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreateFolder = async () => {
    if (!user || !profile?.organization_id) return;
    const { data, error } = await supabase
      .from('chat_folders')
      .insert({ user_id: user.id, organization_id: profile.organization_id, name: 'New folder' })
      .select('id, name, created_at')
      .single();
    if (error || !data) { toast.error('Could not create folder'); return; }
    setFolders((prev) => [...prev, data as Folder]);
    setExpandedFolders((prev) => new Set(prev).add(data.id));
    setRenamingFolderId(data.id);
    setFolderNameDraft(data.name);
  };

  const handleRenameFolder = async (id: string, name: string) => {
    const trimmed = name.trim() || 'New folder';
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name: trimmed } : f));
    setRenamingFolderId(null);
    const { error } = await supabase.from('chat_folders').update({ name: trimmed }).eq('id', id);
    if (error) toast.error('Rename failed');
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('Delete this folder? Chats inside will move to the top level.')) return;
    const { error } = await supabase.from('chat_folders').delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setConversations((prev) => prev.map((c) => c.folder_id === id ? { ...c, folder_id: null } : c));
    if (activeFolderId === id) setActiveFolderId(null);
  };

  const handleMoveConv = async (convId: string, folderId: string | null) => {
    setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, folder_id: folderId } : c));
    const { error } = await supabase.from('chat_conversations').update({ folder_id: folderId }).eq('id', convId);
    if (error) { toast.error('Move failed'); loadConversations(); return; }
    if (folderId) setExpandedFolders((prev) => new Set(prev).add(folderId));
  };


  // Load messages
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, role, content, created_at, attachments, citations')
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

  const rootConversations = useMemo(
    () => conversations.filter((c) => !c.folder_id),
    [conversations],
  );

  const conversationsByFolder = useMemo(() => {
    const map: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      if (!c.folder_id) continue;
      (map[c.folder_id] = map[c.folder_id] || []).push(c);
    }
    return map;
  }, [conversations]);

  const groupedConversations = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const c of rootConversations) {
      const k = dateBucket(c.updated_at || c.created_at);
      (groups[k] = groups[k] || []).push(c);
    }
    return groups;
  }, [rootConversations]);

  // Pick a header title that reflects the current conversation, not a
  // generic label. Prefers the saved conversation title; falls back to the
  // first user message; finally falls back to "New chat".
  const activeConversationTitle = useMemo(() => {
    if (!activeId) return 'New chat';
    const conv = conversations.find((c) => c.id === activeId);
    const placeholderTitles = new Set(['user greeting', 'new chat', 'new conversation', 'untitled']);
    const raw = conv?.title?.trim();
    if (raw && !placeholderTitles.has(raw.toLowerCase())) {
      return raw;
    }
    // Backend hasn't generated a title yet (or saved the placeholder) — derive
    // one from the first user message so every conversation gets a real header.
    const firstUser = messages.find((m) => m.role === 'user')?.content?.trim();
    if (firstUser) {
      return firstUser.length > 60 ? firstUser.slice(0, 60) + '…' : firstUser;
    }
    return 'New chat';
  }, [activeId, conversations, messages]);

  const handleNewChat = (folderId: string | null = null) => {
    setActiveId(null);
    setMessages([]);
    setInput('');
    setFiles([]);
    setSidebarOpen(false);
    setActiveFolderId(folderId);
    if (folderId) setExpandedFolders((prev) => new Set(prev).add(folderId));
    navigate('/chat');
  };

  const handleSelectConv = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    const conv = conversations.find((c) => c.id === id);
    setActiveFolderId(conv?.folder_id ?? null);
    navigate(`/chat/${id}`);
  };

  const handleDeleteConv = async (id: string) => {
    await supabase.from('chat_conversations').delete().eq('id', id);
    if (activeId === id) handleNewChat();
    loadConversations();
  };

  const [exporting, setExporting] = useState<string | null>(null);
  const handleExport = async (
    conversationId: string | null,
    format: 'pdf' | 'xlsx',
  ) => {
    const key = `${conversationId || 'all'}-${format}`;
    setExporting(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('export-chat', {
        body: { conversation_id: conversationId, format },
      });
      if (error) throw error;
      const file = data as { filename: string; mime_type: string; base64: string };
      if (!file?.base64) throw new Error('Empty export');
      downloadBase64File(file.filename, file.mime_type, file.base64);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const expiringSoon = useMemo(
    () => conversations.filter((c) => daysUntilExpiry(c.created_at) <= EXPIRY_WARN_DAYS),
    [conversations],
  );

  const uploadFiles = async (
    toUpload: File[],
  ): Promise<{ urls: string[]; refs: { path: string; name: string; mime_type: string }[] }> => {
    if (!user || !toUpload.length) return { urls: [], refs: [] };
    const urls: string[] = [];
    const refs: { path: string; name: string; mime_type: string }[] = [];
    for (const f of toUpload) {
      const path = `${user.id}/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('chat-attachments').upload(path, f);
      if (error) { toast.error(`Upload failed: ${f.name}`); continue; }
      const { data } = await supabase.storage.from('chat-attachments').createSignedUrl(path, 60 * 60 * 24);
      if (data?.signedUrl) urls.push(data.signedUrl);
      refs.push({ path, name: f.name, mime_type: f.type || '' });
    }
    return { urls, refs };
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
    setStreamingCitations([]);

    try {
      const { urls: attachmentUrls, refs: attachmentRefs } = await uploadFiles(toUpload);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      // Route through chat-agent (SSE adapter around agent-orchestrator) so
      // the AI has tool access to Outlook / OneDrive / SharePoint and can
      // actually read file contents instead of just naming them.
      const url = `https://${projectRef}.supabase.co/functions/v1/chat-agent`;

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
          connectionId: activeConnection?.id,
          folder_id: activeId ? undefined : activeFolderId,
          attachments: attachmentUrls,
          attachment_refs: attachmentRefs,
          stream: true,
          web_search: webSearch,
          user_location: webSearch ? (userLocation || undefined) : undefined,
          deep: deepMode,
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
              } else if (data.type === 'citations') {
                setStreamingCitations(Array.isArray(data.citations) ? data.citations : []);
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
        let lastAssistant: Msg | null = null;
        if (newConvId) {
          const { data: msgs } = await supabase
            .from('chat_messages')
            .select('id, role, content, created_at, attachments, citations')
            .eq('conversation_id', newConvId)
            .order('created_at', { ascending: true });
          const filtered = ((msgs as Msg[]) || []).filter((m) => m.role !== 'system');
          setMessages(filtered);
          lastAssistant = [...filtered].reverse().find((m) => m.role === 'assistant') || null;
        }
        if (voiceOut && lastAssistant?.content) {
          speak(lastAssistant.content, lastAssistant.id);
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
              .select('id, role, content, created_at, attachments, citations')
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
      setStreamingCitations([]);
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

  const renderConvRow = (c: Conversation, opts: { indent?: boolean } = {}) => {
    const days = daysUntilExpiry(c.created_at);
    const expiring = days <= EXPIRY_WARN_DAYS;
    const titleText = c.title && c.title.trim() && c.title.toLowerCase() !== 'user greeting'
      ? c.title
      : 'New chat';
    return (
      <div
        key={c.id}
        className={cn(
          'group flex items-center gap-2 px-2 py-2 rounded-md text-sm cursor-pointer hover:bg-accent',
          opts.indent && 'ml-5',
          activeId === c.id && 'bg-accent'
        )}
        onClick={() => handleSelectConv(c.id)}
      >
        <span className="flex-1 truncate">{titleText}</span>
        {expiring && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 whitespace-nowrap"
            title={`Deletes in ${days} day${days === 1 ? '' : 's'}`}
          >
            {days}d
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity p-1 rounded hover:bg-background"
              onClick={(e) => e.stopPropagation()}
              title="More"
            >
              <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-4 w-4 mr-2" /> Move to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {folders.length === 0 && (
                    <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                  )}
                  {folders.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      disabled={c.folder_id === f.id}
                      onClick={() => handleMoveConv(c.id, f.id)}
                    >
                      <Folder className="h-4 w-4 mr-2" /> {f.name}
                    </DropdownMenuItem>
                  ))}
                  {c.folder_id && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleMoveConv(c.id, null)}>
                        Remove from folder
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={exporting === `${c.id}-pdf`}
              onClick={() => handleExport(c.id, 'pdf')}
            >
              <Download className="h-4 w-4 mr-2" /> Export as PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={exporting === `${c.id}-xlsx`}
              onClick={() => handleExport(c.id, 'xlsx')}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Export as Excel
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handleDeleteConv(c.id)}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

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
        <div className="p-3 space-y-2">
          <Button onClick={() => handleNewChat(null)} variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" /> New chat
          </Button>
          <Button onClick={handleCreateFolder} variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground">
            <FolderPlus className="h-3.5 w-3.5" /> New folder
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
          {expiringSoon.length > 0 && (
            <div className="mx-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">
                    {expiringSoon.length} chat{expiringSoon.length === 1 ? '' : 's'} expiring soon
                  </div>
                  <div className="opacity-80">
                    Chats are deleted after {RETENTION_DAYS} days. Export to keep a copy.
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1"
                  disabled={exporting === 'all-pdf'}
                  onClick={() => handleExport(null, 'pdf')}
                >
                  {exporting === 'all-pdf'
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <Download className="h-3 w-3 mr-1" />}
                  All PDF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1"
                  disabled={exporting === 'all-xlsx'}
                  onClick={() => handleExport(null, 'xlsx')}
                >
                  {exporting === 'all-xlsx'
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <FileSpreadsheet className="h-3 w-3 mr-1" />}
                  All Excel
                </Button>
              </div>
            </div>
          )}
          {/* Folders */}
          {folders.length > 0 && (
            <div className="space-y-0.5">
              <div className="px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground">Folders</div>
              {folders.map((f) => {
                const expanded = expandedFolders.has(f.id);
                const items = conversationsByFolder[f.id] || [];
                const isRenaming = renamingFolderId === f.id;
                return (
                  <div key={f.id}>
                    <div
                      className={cn(
                        'group flex items-center gap-1 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-accent',
                      )}
                      onClick={() => !isRenaming && toggleFolder(f.id)}
                    >
                      {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {isRenaming ? (
                        <Input
                          autoFocus
                          value={folderNameDraft}
                          onChange={(e) => setFolderNameDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleRenameFolder(f.id, folderNameDraft); }
                            if (e.key === 'Escape') { setRenamingFolderId(null); }
                          }}
                          onBlur={() => handleRenameFolder(f.id, folderNameDraft)}
                          className="h-6 text-sm px-1 py-0 flex-1"
                        />
                      ) : (
                        <span className="flex-1 truncate font-medium">{f.name}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{items.length}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity p-1 rounded hover:bg-background"
                            onClick={(e) => e.stopPropagation()}
                            title="More"
                          >
                            <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => { handleNewChat(f.id); }}>
                            <Plus className="h-4 w-4 mr-2" /> New chat in folder
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setRenamingFolderId(f.id); setFolderNameDraft(f.name); }}>
                            <Check className="h-4 w-4 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteFolder(f.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {expanded && (
                      <div className="space-y-0.5">
                        {items.length === 0 ? (
                          <div className="ml-5 px-2 py-1.5 text-xs text-muted-foreground italic">Empty — start a new chat here</div>
                        ) : (
                          items.map((c) => renderConvRow(c, { indent: true }))
                        )}
                        <button
                          className="ml-5 flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => handleNewChat(f.id)}
                        >
                          <Plus className="h-3 w-3" /> New chat in this folder
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {Object.entries(groupedConversations).map(([label, items]) => (
            <div key={label}>
              <div className="px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
              {items.map((c) => renderConvRow(c))}
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
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Sticky header — stays in place while the chat scrolls */}
        <header className="shrink-0 z-20 bg-background border-b border-border">
          <div className="h-14 flex items-center px-4 gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <AgentAvatar className="h-8 w-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">
                {activeConversationTitle}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {activeId
                  ? 'Ask follow-ups, draft replies, or summarize — all in one thread.'
                  : 'Ask anything about your inbox, calendar, or work.'}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        <div
          ref={scrollContainerRef}
          onScroll={onScrollContainer}
          className="flex-1 overflow-y-auto min-h-0"
        >
          {messages.length === 0 && !streamingText ? (
            <div className="max-w-6xl mx-auto px-6 pb-16">
              <div className="flex flex-col items-center mt-4">
                <AgentAvatar className="w-40 h-40 mb-4 shadow-glow" />
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
            <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
              {messages.map((m) => <MessageBubble key={m.id} message={m} userInitial={userInitial} speakingId={speakingId} onSpeak={speak} onStopSpeak={stopSpeak} />)}
              {isStreaming && (
                <MessageBubble
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamingText || '...',
                    created_at: new Date().toISOString(),
                    citations: streamingCitations.length ? streamingCitations : null,
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
          <div className="max-w-6xl mx-auto px-6 py-4">
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
            <div className="relative flex items-end gap-2 border-2 border-[var(--border-strong)] hover:border-primary focus-within:border-primary rounded-2xl p-2 bg-[var(--surface-2)] focus-within:ring-2 focus-within:ring-ring transition-colors shadow-sm">
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
              <Button
                type="button"
                variant={isRecording ? 'default' : 'ghost'}
                size="icon"
                className={cn(
                  'h-9 w-9 shrink-0',
                  isRecording && 'bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse',
                )}
                disabled={isStreaming || limitReached || isTranscribing}
                onClick={() => (isRecording ? stopRecording() : startRecording())}
                title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing…' : 'Hold to talk — speak your message'}
              >
                {isTranscribing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : isRecording
                    ? <Square className="h-4 w-4" />
                    : <Mic className="h-4 w-4" />}
              </Button>
              {canWebSearch && (
                <Button
                  type="button"
                  variant={webSearch ? 'default' : 'ghost'}
                  size="icon"
                  className={cn(
                    'h-9 w-9 shrink-0',
                    webSearch && 'bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                  disabled={isStreaming || limitReached}
                  onClick={() => {
                    setWebSearch((v) => {
                      const next = !v;
                      if (next) {
                        toast.success('Web search on — using live results & your approximate location');
                        // Best-effort: capture timezone immediately, ask for
                        // geolocation in the background and reverse-geocode
                        // for city/region/country so location-aware queries work.
                        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                        setUserLocation((prev) => ({ ...(prev || {}), timezone: tz }));
                        if (typeof navigator !== 'undefined' && navigator.geolocation) {
                          navigator.geolocation.getCurrentPosition(
                            async (pos) => {
                              try {
                                const r = await fetch(
                                  `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=10`,
                                  { headers: { 'Accept-Language': 'en' } },
                                );
                                const j = await r.json();
                                const a = j.address || {};
                                setUserLocation({
                                  city: a.city || a.town || a.village || a.hamlet,
                                  region: a.state || a.region,
                                  country: a.country_code ? String(a.country_code).toUpperCase() : a.country,
                                  timezone: tz,
                                });
                              } catch {/* keep timezone-only fallback */}
                            },
                            () => {/* permission denied — keep timezone-only */},
                            { timeout: 8000, maximumAge: 5 * 60 * 1000 },
                          );
                        }
                      } else {
                        toast.success('Web search off');
                      }
                      return next;
                    });
                  }}
                  title={webSearch ? 'Web search: ON — click to disable' : 'Web search: OFF — click to search the internet'}
                >
                  <Globe className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                variant={deepMode ? 'default' : 'ghost'}
                size="icon"
                className={cn('h-9 w-9 shrink-0', deepMode && 'bg-primary text-primary-foreground hover:bg-primary/90')}
                disabled={isStreaming || limitReached}
                onClick={() => {
                  setDeepMode((v) => {
                    const next = !v;
                    toast.success(next
                      ? 'Deep mode ON — thorough multi-step answers, no follow-up questions'
                      : 'Deep mode OFF');
                    return next;
                  });
                }}
                title={deepMode ? 'Deep mode: ON — click to disable' : 'Deep mode: OFF — click for thorough, expert answers'}
              >
                <Sparkles className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={voiceOut ? 'default' : 'ghost'}
                size="icon"
                className={cn('h-9 w-9 shrink-0', voiceOut && 'bg-primary text-primary-foreground hover:bg-primary/90')}
                disabled={isStreaming || limitReached}
                onClick={() => {
                  setVoiceOut((v) => {
                    const next = !v;
                    if (!next) stopSpeak();
                    toast.success(next ? 'Voice replies ON — answers will be spoken aloud' : 'Voice replies OFF');
                    return next;
                  });
                }}
                title={voiceOut ? 'Voice replies: ON — click to disable' : 'Voice replies: OFF — click to hear answers spoken'}
              >
                {voiceOut ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
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
  speakingId,
  onSpeak,
  onStopSpeak,
}: {
  message: Msg;
  userInitial: string;
  streaming?: boolean;
  speakingId?: string | null;
  onSpeak?: (text: string, id: string) => void;
  onStopSpeak?: () => void;
}) {
  const isUser = message.role === 'user';
  const copy = () => {
    navigator.clipboard.writeText(message.content);
    toast.success('Copied');
  };
  const isSpeaking = speakingId === message.id;

  return (
    <div className="flex flex-col gap-1.5 group">
      {!isUser && (
        <AgentAvatar active={!!streaming} className="h-9 w-9 shrink-0" />
      )}
      <div className="max-w-[85%] flex flex-col gap-1 items-start">
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
        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationChips citations={message.citations} />
        )}
        {!isUser && !streaming && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
            <button onClick={copy} className="p-1 hover:bg-accent rounded text-muted-foreground" title="Copy">
              <Copy className="h-3.5 w-3.5" />
            </button>
            {onSpeak && (
              <button
                onClick={() => isSpeaking ? onStopSpeak?.() : onSpeak(message.content, message.id)}
                className={cn('p-1 hover:bg-accent rounded', isSpeaking ? 'text-primary' : 'text-muted-foreground')}
                title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
              >
                {isSpeaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function citationIcon(sourceType?: string) {
  switch ((sourceType || '').toLowerCase()) {
    case 'sharepoint': return FileSpreadsheet;
    case 'onedrive': return FolderInput;
    case 'mail_attachment':
    case 'outlook':
    case 'email': return Mail;
    default: return FileText;
  }
}

function citationLabel(sourceType?: string) {
  switch ((sourceType || '').toLowerCase()) {
    case 'sharepoint': return 'SharePoint';
    case 'onedrive': return 'OneDrive';
    case 'mail_attachment': return 'Email attachment';
    case 'outlook':
    case 'email': return 'Outlook';
    default: return 'Source';
  }
}

function CitationChips({ citations }: { citations: Citation[] }) {
  // Dedupe by url+title, cap to 8 chips so long-tail retrievals don't overwhelm the bubble.
  const seen = new Set<string>();
  const items = citations.filter((c) => {
    const k = `${c.url || ''}|${c.title || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
  if (!items.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((c, i) => {
        const Icon = citationIcon(c.source_type);
        const title = c.title || citationLabel(c.source_type);
        const chip = (
          <span className="inline-flex items-center gap-1.5 max-w-[280px] rounded-full border border-border bg-background hover:bg-accent px-2.5 py-1 text-xs text-foreground transition">
            <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="truncate" title={title}>{title}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{citationLabel(c.source_type)}</span>
          </span>
        );
        return c.url ? (
          <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" className="no-underline">{chip}</a>
        ) : (
          <span key={i}>{chip}</span>
        );
      })}
    </div>
  );
}

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
  Sparkles, Volume2, VolumeX, Mic, MapPin, MapPinOff, Wand2, Cloud,
} from 'lucide-react';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { ChatCapacityMeter } from '@/components/chat/ChatCapacityMeter';
import { VoiceWaveform } from '@/components/chat/VoiceWaveform';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { AIThinking } from '@/components/ai/AIThinking';


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

import { useTheme as useGlobalTheme } from '@/lib/theme';

// Use the app-wide theme so the chat page stays in sync with the
// global Dark Mode toggle (was previously using a separate key which
// caused the page to flash to light mode on entry).
function useTheme() {
  const { resolvedTheme, setTheme } = useGlobalTheme();
  return {
    theme: resolvedTheme,
    toggle: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
  };
}

// Ensure assistant text renders with breathing room: when the model returns
// label-style lines separated by single newlines (e.g. "Title:\nBody\n..."),
// promote them into separate markdown paragraphs/list items.
function formatAssistantMarkdown(input: string): string {
  if (!input) return input;
  // Normalize line endings
  let text = input.replace(/\r\n/g, '\n');
  // Protect fenced code blocks from transformation
  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  // Convert lines that look like "Label: rest" into bolded paragraphs
  text = text.replace(/^([A-Z][A-Za-z0-9 /&'-]{2,40}):\s+(?!\n)/gm, '**$1:** ');
  // Turn single newlines between non-empty, non-list lines into blank lines
  text = text.replace(/([^\n])\n(?=[^\n\-\*\d\s#>`])/g, '$1\n\n');
  // Restore code blocks
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)]);
  return text;
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

/**
 * Detect which capabilities a message likely needs so we can auto-enable them
 * just for that turn and switch them off after. Keyword-based heuristic.
 */
function detectIntents(raw: string): { web: boolean; deep: boolean; loc: boolean } {
  const t = (raw || '').toLowerCase();
  if (!t.trim()) return { web: false, deep: false, loc: false };

  // Web search is ON BY DEFAULT for any non-trivial message, and only suppressed
  // when the request is clearly about the user's own mailbox, files, calendar,
  // or internal app actions. The orchestrator's system prompt already prefers
  // model knowledge first and only invokes a search tool when freshness or
  // unknown facts demand it — so leaving this on costs nothing when not needed.
  const personalScopeKeywords = [
    'my inbox', 'my email', 'my emails', 'my mail', 'my mailbox',
    'unread', 'reply to', 'draft a reply', 'forward to', 'archive ',
    'my calendar', 'my meeting', 'my meetings', 'my schedule', 'my agenda',
    'my onedrive', 'my drive', 'my files', 'my documents', 'my folder',
    'my contacts', 'my notes', 'in my account', 'in my workspace',
    'from john', 'from sarah', // proper-noun mentions usually map to inbox lookups
    'summarize the email', 'summarise the email', 'this email', 'that email',
    'mark as read', 'mark as unread', 'move to folder',
  ];
  const hasUrl = /\bhttps?:\/\/\S+/i.test(raw) || /\bwww\.\S+\.\S+/i.test(raw);
  const isTrivial = t.length < 4 || /^(hi|hey|hello|thanks|thank you|ok|okay|cool|great|nice|lol|yes|no|yep|nope|sure|got it)[!.?\s]*$/i.test(t.trim());
  const isPurelyPersonal = personalScopeKeywords.some((k) => t.includes(k))
    && !/\b(latest|today|news|price|stock|weather|flight|hotel|search|google|wikipedia|web)\b/.test(t);
  const web = hasUrl || (!isTrivial && !isPurelyPersonal);




  const deepKeywords = [
    'deep', 'thorough', 'in-depth', 'in depth', 'comprehensive', 'detailed analysis',
    'step by step', 'step-by-step', 'multi-step', 'research', 'investigate',
    'compare', 'comparison', 'pros and cons', 'trade-off', 'tradeoff',
    'strategy', 'roadmap', 'plan for', 'business plan', 'analyze', 'analyse',
    'evaluate', 'breakdown', 'break down', 'whitepaper', 'long answer', 'write a report',
    'draft a document', 'draft a policy', 'create a policy', 'write a policy',
    'generate a document', 'create a document', 'write a document',
  ];
  const isLong = raw.trim().length > 320 || (raw.match(/\?/g) || []).length >= 3;
  const deep = isLong || deepKeywords.some((k) => t.includes(k));

  const locKeywords = [
    'near me', 'nearby', 'around me', 'closest', 'close to me', 'in my area',
    'local ', 'restaurants', 'coffee shop', 'gas station', 'pharmacy',
    'weather', 'forecast', 'traffic', 'commute', 'directions',
    'my city', 'my town', 'my region',
  ];
  const loc = locKeywords.some((k) => t.includes(k));

  return { web, deep, loc };
}

/** One-shot best-effort geolocation lookup (timezone + city if permitted). */
async function captureOneShotLocation(): Promise<
  { city?: string; region?: string; country?: string; timezone?: string } | null
> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return { timezone: tz };
  return await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=10`,
            { headers: { 'Accept-Language': 'en' } },
          );
          const j = await r.json();
          const a = j.address || {};
          resolve({
            city: a.city || a.town || a.village || a.hamlet,
            region: a.state || a.region,
            country: a.country_code ? String(a.country_code).toUpperCase() : a.country,
            timezone: tz,
          });
        } catch { resolve({ timezone: tz }); }
      },
      () => resolve({ timezone: tz }),
      { timeout: 6000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

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
  const [locationEnabled, setLocationEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const v = localStorage.getItem('inboxiq-chat-location');
    return v === null ? true : v === '1';
  });
  const [deepMode, setDeepMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('inboxiq-chat-deep') === '1';
  });
  const [voiceOut] = useState<boolean>(false); // Auto-speak disabled — use per-message speaker buttons instead.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Auto mode: detect intent from each message and turn web search / deep
  // reasoning / location ON just for that turn, then back OFF when done.
  const [autoMode, setAutoMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('inboxiq-chat-auto') !== '0';
  });
  const [autoBadges, setAutoBadges] = useState<{ web?: boolean; deep?: boolean; loc?: boolean }>({});
  useEffect(() => { localStorage.setItem('inboxiq-chat-auto', autoMode ? '1' : '0'); }, [autoMode]);
  useEffect(() => { localStorage.setItem('inboxiq-chat-deep', deepMode ? '1' : '0'); }, [deepMode]);
  useEffect(() => { localStorage.setItem('inboxiq-chat-location', locationEnabled ? '1' : '0'); }, [locationEnabled]);

  // Capture timezone + best-effort geolocation whenever location sharing is on.
  // Runs on mount (default on) and whenever the user re-enables it.
  useEffect(() => {
    if (!locationEnabled) { setUserLocation(null); return; }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setUserLocation((prev) => ({ ...(prev || {}), timezone: tz }));
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
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
  }, [locationEnabled]);


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
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(() => {
    try { return localStorage.getItem('inboxiq:mic-device-id'); } catch { return null; }
  });
  const refreshMicDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(all.filter((d) => d.kind === 'audioinput'));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    refreshMicDevices();
    const md = navigator.mediaDevices;
    if (md?.addEventListener) {
      const handler = () => refreshMicDevices();
      md.addEventListener('devicechange', handler);
      return () => md.removeEventListener('devicechange', handler);
    }
  }, [refreshMicDevices]);
  const handleSelectMic = useCallback(async (id: string | null) => {
    setSelectedMicId(id);
    try {
      if (id) localStorage.setItem('inboxiq:mic-device-id', id);
      else localStorage.removeItem('inboxiq:mic-device-id');
    } catch { /* ignore */ }
    // After first permission grant, labels become available; refresh.
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
      refreshMicDevices();
    } catch { /* ignore */ }
  }, [refreshMicDevices]);

  const { isRecording, isTranscribing, startRecording, stopRecording, cancelRecording, getAnalyser } = useVoiceRecording({
    onTranscription: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text).trim());
      // Refocus textarea so the user can immediately send / edit.
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    silenceTimeoutMs: 2000,
    deviceId: selectedMicId,
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
    destination: 'download' | 'onedrive' = 'download',
  ) => {
    const key = `${conversationId || 'all'}-${format}-${destination}`;
    setExporting(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      if (destination === 'onedrive' && !activeConnection?.id) {
        throw new Error('Connect a Microsoft 365 account first.');
      }
      const { data, error } = await supabase.functions.invoke('export-chat', {
        body: {
          conversation_id: conversationId,
          format,
          destination,
          connection_id: destination === 'onedrive' ? activeConnection?.id : undefined,
        },
      });
      if (error) throw error;
      if (destination === 'onedrive') {
        const res = data as { webUrl?: string; filename?: string; error?: string };
        if (res?.error) throw new Error(res.error);
        toast.success(
          res?.webUrl ? `Saved to OneDrive › InboxIQ Chat › Exports` : 'Saved to OneDrive',
          res?.webUrl ? { action: { label: 'Open', onClick: () => window.open(res.webUrl!, '_blank') } } : undefined,
        );
      } else {
        const file = data as { filename: string; mime_type: string; base64: string };
        if (!file?.base64) throw new Error('Empty export');
        downloadBase64File(file.filename, file.mime_type, file.base64);
        toast.success(`Downloaded ${format.toUpperCase()}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };


  // === Summarize current chat + continue in a fresh one ===
  const [summarizing, setSummarizing] = useState(false);
  const handleSummarizeAndContinue = useCallback(async () => {
    if (summarizing) return;
    if (messages.length < 2) {
      toast.info('Send a few messages first before summarizing.');
      return;
    }
    setSummarizing(true);
    const t = toast.loading('Generating handoff summary…');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');


      // Build a compact transcript from in-memory messages to send to a
      // lightweight summarizer model. We do NOT route this through the
      // streaming agent (no tool calls needed).
      const transcript = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-40) // cap so the summarizer prompt stays small
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').slice(0, 2000)}`)
        .join('\n\n');

      const systemPrompt =
        `You produce a concise handoff summary so the user can continue a long chat in a fresh thread without losing context. ` +
        `Output ONLY markdown (≤ 250 words) with these sections:\n` +
        `**Topic** — one line.\n` +
        `**Key facts & data** — bullets of names, numbers, dates, decisions established so far.\n` +
        `**Open questions / next steps** — what we were about to do.\n` +
        `**Preferences** — any style/format/tool preferences the user expressed.\n` +
        `Do not greet. Do not address the user. No preamble.`;

      const { data, error } = await supabase.functions.invoke('llm-gateway', {
        body: {
          model: 'openai/gpt-5-mini',
          purpose: 'chat_handoff_summary',
          temperature: 0.3,
          max_tokens: 600,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Conversation transcript:\n\n${transcript}` },
          ],
        },
      });

      let summary = '';
      if (!error && data) {
        summary = (data?.content || '').trim();
      }


      if (!summary) {
        // Fallback: lightweight local summary so the user is never blocked.
        summary = `**Continuing previous conversation**\n\n` +
          messages.slice(-6).map((m) => `- **${m.role}:** ${(m.content || '').slice(0, 240)}`).join('\n');
      }

      // Start a fresh chat seeded with the summary as the first user message.
      handleNewChat(activeFolderId);
      const seed = `📋 **Carried over from previous chat:**\n\n${summary}\n\n---\n\nContinue from here:`;
      setInput(seed);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        // Scroll cursor to end so user can keep typing.
        const el = textareaRef.current;
        if (el) { el.selectionStart = el.selectionEnd = el.value.length; }
      });
      toast.success('Summary ready in your new chat', { id: t });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate summary', { id: t });
    } finally {
      setSummarizing(false);
    }
  }, [summarizing, messages, activeFolderId]);



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

      // Auto-detect intents from the user's message and turn the matching
      // capabilities ON just for this request, then OFF when the stream
      // finishes (handled in the `finally` block). Manual toggles still
      // override (OR'd in), so user-set state is never weakened.
      const detected = autoMode ? detectIntents(text) : { web: false, deep: false, loc: false };
      const effWeb = (canWebSearch && webSearch) || (canWebSearch && detected.web);
      const effDeep = deepMode || detected.deep;
      const effLoc = locationEnabled || detected.loc;
      let effLocation = (locationEnabled && userLocation) ? userLocation : undefined;
      if (!effLocation && detected.loc) {
        // Just-in-time one-shot lookup so location flows through for this turn
        // without permanently flipping the location toggle on.
        const loc = await captureOneShotLocation();
        if (loc) effLocation = loc;
      }
      const usedAuto = {
        web: !webSearch && detected.web && canWebSearch,
        deep: !deepMode && detected.deep,
        loc: !locationEnabled && detected.loc,
      };
      if (autoMode && (usedAuto.web || usedAuto.deep || usedAuto.loc)) {
        const parts = [
          usedAuto.web ? '🌐 Web' : null,
          usedAuto.deep ? '🧠 Deep' : null,
          usedAuto.loc ? '📍 Location' : null,
        ].filter(Boolean).join(' · ');
        toast.success(`Auto-enabled: ${parts}`, { duration: 2200, position: 'top-center' });
        setAutoBadges(usedAuto);
      }

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
          web_search: effWeb,
          user_location: effLoc ? effLocation : undefined,
          deep: effDeep,
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
              } else if (data.type === 'onedrive') {
                const path = data?.md?.path || data?.json?.path;
                if (path) toast.success(`Saved to OneDrive › ${path}`, { duration: 4000 });
              } else if (data.type === 'onedrive_error') {
                // Surface quietly — most likely the user needs to reconnect M365 to grant Files.ReadWrite.
                console.warn('OneDrive save failed:', data.message);
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
      // Auto-enabled flags are per-turn only — clear the visual badges so the
      // next message starts from the user's manual toggle state.
      setAutoBadges({});
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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download className="h-4 w-4 mr-2" /> Download to computer
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    disabled={exporting === `${c.id}-pdf-download`}
                    onClick={() => handleExport(c.id, 'pdf', 'download')}
                  >
                    <Download className="h-4 w-4 mr-2" /> PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exporting === `${c.id}-xlsx-download`}
                    onClick={() => handleExport(c.id, 'xlsx', 'download')}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Cloud className="h-4 w-4 mr-2" /> Save to OneDrive
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    disabled={exporting === `${c.id}-pdf-onedrive`}
                    onClick={() => handleExport(c.id, 'pdf', 'onedrive')}
                  >
                    <Download className="h-4 w-4 mr-2" /> PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exporting === `${c.id}-xlsx-onedrive`}
                    onClick={() => handleExport(c.id, 'xlsx', 'onedrive')}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

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
    <div className="h-full flex bg-background text-foreground overflow-hidden">
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
          <Button onClick={() => handleNewChat(null)} variant="outline" className="w-full justify-start gap-2" data-tour="chat-new">
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
                  disabled={exporting === 'all-pdf-download'}
                  onClick={() => handleExport(null, 'pdf', 'download')}
                >
                  {exporting === 'all-pdf-download'
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <Download className="h-3 w-3 mr-1" />}
                  All PDF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1"
                  disabled={exporting === 'all-xlsx-download'}
                  onClick={() => handleExport(null, 'xlsx', 'download')}
                >
                  {exporting === 'all-xlsx-download'
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
      <div className="flex-1 flex flex-col min-w-0 h-full min-h-0">
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
                streamingText ? (
                  <MessageBubble
                    message={{
                      id: 'streaming',
                      role: 'assistant',
                      content: streamingText,
                      created_at: new Date().toISOString(),
                      citations: streamingCitations.length ? streamingCitations : null,
                    }}
                    userInitial={userInitial}
                    streaming
                  />
                ) : (
                  <AIThinking />
                )
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-background">
          <div className="max-w-6xl mx-auto px-6 py-4 space-y-3">
            {messages.length > 0 && (
              <div data-tour="chat-capacity">
                <ChatCapacityMeter
                  messages={messages}
                  streamingText={streamingText}
                  onSummarizeAndContinue={handleSummarizeAndContinue}
                  summarizing={summarizing}
                />
              </div>
            )}

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
            {autoMode && (autoBadges.web || autoBadges.deep || autoBadges.loc) && (
              <div className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-xs font-medium text-primary animate-pulse w-fit">
                <span className="opacity-70">Auto-enabled:</span>
                {autoBadges.web && <span>🌐 Web</span>}
                {autoBadges.deep && <span>🧠 Deep</span>}
                {autoBadges.loc && <span>📍 Location</span>}
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={autoMode ? 'default' : 'ghost'}
                    size="icon"
                    className={cn(
                      'h-9 w-9 shrink-0',
                      autoMode && 'bg-primary text-primary-foreground hover:bg-primary/90',
                    )}
                    disabled={isStreaming || limitReached}
                    onClick={() => {
                      setAutoMode((v) => {
                        const next = !v;
                        toast.success(next
                          ? 'Auto mode ON — I’ll turn on web search, location, and deep reasoning when your request needs them'
                          : 'Auto mode OFF — I’ll only use the toggles you set');
                        return next;
                      });
                    }}
                    title={autoMode
                      ? 'Auto mode: ON — capabilities auto-enable per message'
                      : 'Auto mode: OFF — manual toggles only'}
                  >
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{autoMode ? 'Auto-detect: web, location & deep reasoning' : 'Auto-detect is off'}</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={isStreaming || limitReached}
                onClick={() => fileInputRef.current?.click()}
                data-tour="chat-attach"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              {canWebSearch && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={webSearch ? 'default' : 'ghost'}
                      size="icon"
                      className={cn(
                        'h-9 w-9 shrink-0',
                        webSearch && 'bg-primary text-primary-foreground hover:bg-primary/90',
                        autoBadges.web && 'ring-2 ring-primary/60 animate-pulse'
                      )}
                      disabled={isStreaming || limitReached}
                      onClick={() => {
                        setWebSearch((v) => {
                          const next = !v;
                          toast.success(next ? 'Web search on — using live results' : 'Web search off');
                          return next;
                        });
                      }}
                      title={webSearch ? 'Web search: ON — click to disable' : 'Web search: OFF — click to search the internet'}
                      data-tour="chat-web"
                    >
                      <Globe className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{webSearch ? 'Live web search is on' : 'Search the live web before answering'}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={locationEnabled ? 'default' : 'ghost'}
                    size="icon"
                    className={cn(
                      'h-9 w-9 shrink-0 transition-colors',
                      locationEnabled && 'bg-accent text-accent-foreground hover:opacity-90',
                      autoBadges.loc && 'ring-2 ring-accent/60 animate-pulse'
                    )}
                    disabled={isStreaming || limitReached}
                    onClick={() => {
                      setLocationEnabled((v) => {
                        const next = !v;
                        toast.success(next
                          ? 'Location sharing on — the assistant can use your approximate location'
                          : 'Location sharing off');
                        return next;
                      });
                    }}
                    title={
                      locationEnabled
                        ? `Location: ON${userLocation?.city ? ` (${userLocation.city}${userLocation.region ? ', ' + userLocation.region : ''})` : ''} — click to disable`
                        : 'Location: OFF — click to share your approximate location with the assistant'
                    }
                    data-tour="chat-location"
                  >
                    {locationEnabled ? <MapPin className="h-4 w-4" /> : <MapPinOff className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{locationEnabled ? 'Approximate location sharing is on' : 'Share your approximate location for local context'}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={deepMode ? 'default' : 'ghost'}
                    size="icon"
                    className={cn('h-9 w-9 shrink-0', deepMode && 'bg-primary text-primary-foreground hover:bg-primary/90', autoBadges.deep && 'ring-2 ring-primary/60 animate-pulse')}
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
                    data-tour="chat-deep"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{deepMode ? 'Deep mode is on' : 'Use deeper multi-step reasoning'}</TooltipContent>
              </Tooltip>
              <div className="relative flex-1 min-w-0">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={limitReached ? 'Daily limit reached' : 'Message InboxIQ...'}
                  disabled={isStreaming || limitReached}
                  rows={1}
                  className={cn(
                    'w-full resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent min-h-0 py-2',
                    isRecording && 'invisible',
                  )}
                  data-tour="chat-input"
                />
                {isRecording && (
                  <div className="absolute inset-0 flex items-center gap-3 px-1">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-destructive/70 animate-ping" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
                    </span>
                    <VoiceWaveform getAnalyser={getAnalyser} active={isRecording} className="h-8 flex-1" />
                    <span className="text-xs font-medium text-muted-foreground shrink-0 tabular-nums">
                      Listening…
                    </span>
                  </div>
                )}
              </div>
              {isRecording ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={cancelRecording}
                        title="Cancel recording"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancel</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={stopRecording}
                        title="Stop and transcribe"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stop &amp; transcribe</TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="relative h-9 w-9 shrink-0"
                      disabled={isStreaming || limitReached || isTranscribing}
                      onClick={startRecording}
                      title={isTranscribing ? 'Converting voice to text…' : 'Click to talk — pause for 2 seconds when you are done'}
                      data-tour="chat-mic"
                    >
                      {isTranscribing
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Mic className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isTranscribing ? 'Converting your speech to text' : 'Voice input — click once, speak, then pause to convert'}</TooltipContent>
                </Tooltip>
              )}
              {!isRecording && (
              <DropdownMenu onOpenChange={(o) => { if (o) refreshMicDevices(); }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-6 shrink-0 -ml-1 px-0"
                        aria-label="Choose microphone"
                      >
                        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Choose microphone</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="max-w-[300px]">
                  <DropdownMenuItem onClick={() => handleSelectMic(null)}>
                    <Check className={cn('h-4 w-4 mr-2', selectedMicId ? 'opacity-0' : 'opacity-100')} />
                    System default
                  </DropdownMenuItem>
                  {micDevices.length > 0 && <DropdownMenuSeparator />}
                  {micDevices.map((d, i) => (
                    <DropdownMenuItem key={d.deviceId || i} onClick={() => handleSelectMic(d.deviceId)}>
                      <Check className={cn('h-4 w-4 mr-2', selectedMicId === d.deviceId ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{d.label || `Microphone ${i + 1}`}</span>
                    </DropdownMenuItem>
                  ))}
                  {micDevices.length === 0 && (
                    <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                      Allow microphone access to list devices
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              )}
              {!isRecording && (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSend}
                disabled={!input.trim() || isStreaming || limitReached}
                title={isStreaming ? 'InboxIQ is processing your request' : 'Send message'}
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className={usageColor}>
                {usage.limit
                  ? limitReached
                    ? `Limit reached. Resets at midnight UTC`
                    : `${usage.used} / ${usage.limit} messages used today`
                  : `${usage.used} messages today`}
              </span>
              {isStreaming && (
                <span className="text-muted-foreground">InboxIQ is processing…</span>
              )}
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
            isUser ? 'bg-primary text-primary-foreground' : 'text-foreground'
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed [&_p]:my-3 [&_p]:leading-relaxed [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1.5 [&_li]:leading-relaxed [&_h1]:mt-5 [&_h1]:mb-3 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:mt-4 [&_h3]:mb-2 [&_hr]:my-4 [&_blockquote]:my-3 [&_pre]:bg-background [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:my-3 [&_code]:text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {formatAssistantMarkdown(message.content)}
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
          <div className="flex gap-1 items-center mt-1">
            <button onClick={copy} className="p-1 hover:bg-accent rounded text-muted-foreground" title="Copy">
              <Copy className="h-3.5 w-3.5" />
            </button>
            {onSpeak && (
              <button
                onClick={() => isSpeaking ? onStopSpeak?.() : onSpeak(message.content, message.id)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
                  isSpeaking
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                )}
                title={isSpeaking ? 'Stop reading' : 'Read this reply aloud'}
              >
                {isSpeaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                <span>{isSpeaking ? 'Stop' : 'Play'}</span>
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

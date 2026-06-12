import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Send, Plus, Trash2, Menu, X, Paperclip, Sun, Moon, Loader2,
  Copy, RefreshCw, Mail, FileText, Calendar, BarChart3, LogOut, Settings,
  MoreVertical, Download, FileSpreadsheet, AlertTriangle, Globe,
  Folder, FolderPlus, ChevronRight, ChevronDown, FolderInput, Check,
  Sparkles, Volume2, VolumeX, Mic, MapPin, MapPinOff, Wand2, Cloud, Square,
  MessageSquare, Pencil,
} from 'lucide-react';
import { PageHero } from '@/components/app/PageHero';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { ChatCreditMeter } from '@/components/chat/ChatCreditMeter';
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
import { useKokoroTTS, KOKORO_VOICES_BY_LANGUAGE, getStoredVoice, setStoredVoice, type KokoroVoiceId } from '@/hooks/useKokoroTTS';

const VOICE_PREVIEW_TEXT: Record<string, string> = {
  'English — United States': 'Hello, this is your selected American English voice. You should hear a clear difference now.',
  'English — United Kingdom': 'Hello, this is your selected British English voice. You should hear a distinct accent now.',
};


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
  // Insert a horizontal rule before every ## / ### heading (except the very
  // first line) so long answers visually break into scannable sections.
  text = text.replace(/(^|\n\n)(#{2,3}\s)/g, (_m, lead, hd, offset) => {
    if (offset === 0) return lead + hd;
    return `${lead}---\n\n${hd}`;
  });
  // Restore code blocks
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)]);
  return text;
}

function dateBucket(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const fmtDate = (dt: Date) =>
    dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtMonth = (dt: Date) =>
    dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (sameDay) return `Today · ${fmtDate(d)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${fmtDate(d)}`;
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) {
    // Week-of label with start/end dates
    const start = new Date(now); start.setDate(now.getDate() - 6);
    return `This week · ${fmtDate(start)} – ${fmtDate(now)}`;
  }
  if (diffDays < 14) {
    const start = new Date(now); start.setDate(now.getDate() - 13);
    const end = new Date(now); end.setDate(now.getDate() - 7);
    return `Last week · ${fmtDate(start)} – ${fmtDate(end)}`;
  }
  // Same calendar month as today → "This month"
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
    return `This month · ${fmtMonth(d)}`;
  }
  // Previous calendar month → "Last month"
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (d.getFullYear() === lastMonth.getFullYear() && d.getMonth() === lastMonth.getMonth()) {
    return `Last month · ${fmtMonth(d)}`;
  }
  // Group by month/year for everything older
  return fmtMonth(d);
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
  // ---- Per-conversation parallel streaming ----
  // Each in-flight chat request lives in `streamsRef` keyed by a stable
  // internal id. The map can contain multiple entries — one per chat that
  // the AI is currently working on — so the user can send in chat B while
  // chat A keeps streaming. `streamTick` is bumped to trigger renders when
  // a stream mutates its text/phase/citations in place.
  type StreamInfo = {
    key: string;
    convId: string | null;
    newChatEpoch: number; // for resolving pending-null streams safely
    tempUserMsg: Msg;
    text: string;
    phase: string;
    citations: Citation[];
    abort: AbortController;
    aborted: boolean;
  };
  const streamsRef = useRef<Map<string, StreamInfo>>(new Map());
  const [streamTick, setStreamTick] = useState(0);
  const bumpStreams = useCallback(() => setStreamTick((n) => n + 1), []);
  const activeIdRef = useRef<string | null>(params.id || null);
  const newChatEpochRef = useRef(0);
  // Per-conversation input drafts so typing in chat B doesn't leak into A.
  const draftsRef = useRef<Map<string, string>>(new Map());
  // Conversations the AI recently finished replying in but the user hasn't
  // opened yet. Used to render a dark-green "unread reply" dot in the sidebar.
  const [recentConvIds, setRecentConvIds] = useState<Set<string>>(new Set());
  const markRecent = useCallback((convId: string) => {
    setRecentConvIds((prev) => {
      if (activeIdRef.current === convId) return prev;
      const next = new Set(prev);
      next.add(convId);
      // Cap at the last 5 to avoid clutter.
      if (next.size > 5) {
        const first = next.values().next().value as string | undefined;
        if (first) next.delete(first);
      }
      return next;
    });
  }, []);
  const clearRecent = useCallback((convId: string) => {
    setRecentConvIds((prev) => {
      if (!prev.has(convId)) return prev;
      const next = new Set(prev);
      next.delete(convId);
      return next;
    });
  }, []);

  // Look up the in-flight stream (if any) for a given conversation id.
  // When `convId` is null, returns the most recently started pending stream
  // whose epoch matches the current "new chat" session — so clicking
  // New Chat hides previously pending streams from this view.
  const findStreamForConv = useCallback((convId: string | null): StreamInfo | null => {
    if (convId == null) {
      let candidate: StreamInfo | null = null;
      for (const s of streamsRef.current.values()) {
        if (s.convId == null && s.newChatEpoch === newChatEpochRef.current) candidate = s;
      }
      return candidate;
    }
    for (const s of streamsRef.current.values()) if (s.convId === convId) return s;
    return null;
  }, []);
  // Derived values that everything else in the component reads from.
  // We use `streamTick` purely as a render trigger; the actual data lives in
  // `streamsRef` so multiple parallel streams can mutate independently.
  const activeStream = useMemo(
    () => findStreamForConv(activeId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, streamTick, findStreamForConv]
  );
  const isStreaming = !!activeStream;
  const streamingConvIds = useMemo(() => {
    const s = new Set<string>();
    for (const v of streamsRef.current.values()) if (v.convId) s.add(v.convId);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamTick]);
  // Backwards-compat aliases used across the render path. They're plain
  // values derived from `activeStream` so we don't have to refactor every
  // reference.
  const streamingText = activeStream?.text ?? '';
  const streamingCitations = activeStream?.citations ?? [];
  const streamingPhase = activeStream?.phase ?? 'Thinking';
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
  const { speak, stop: stopSpeak, speakingId, loading: ttsLoading, loadProgress: ttsLoadProgress, preload: preloadTTS, error: ttsError, modelState: ttsModelState } = useKokoroTTS();
  const [ttsVoice, setTtsVoice] = useState<KokoroVoiceId>(() => getStoredVoice());

  // ---- Starter prompts: collapsed by default + user-added custom prompts ----
  type StarterPrompt = { icon?: string; title: string; desc: string; custom?: boolean };
  const CUSTOM_PROMPTS_KEY = 'inboxiq-custom-starter-prompts';
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  const [customPrompts, setCustomPrompts] = useState<StarterPrompt[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(CUSTOM_PROMPTS_KEY);
      return raw ? (JSON.parse(raw) as StarterPrompt[]) : [];
    } catch { return []; }
  });
  const [addPromptOpen, setAddPromptOpen] = useState(false);
  const [newPromptTitle, setNewPromptTitle] = useState('');
  const [newPromptDesc, setNewPromptDesc] = useState('');
  const persistCustomPrompts = (next: StarterPrompt[]) => {
    setCustomPrompts(next);
    try { localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const addCustomPrompt = () => {
    const title = newPromptTitle.trim();
    const desc = newPromptDesc.trim();
    if (!title) { toast.error('Give the prompt a short title'); return; }
    persistCustomPrompts([...customPrompts, { title, desc, custom: true }]);
    setNewPromptTitle('');
    setNewPromptDesc('');
    setAddPromptOpen(false);
    setPromptsExpanded(true);
    toast.success('Prompt added');
  };
  const removeCustomPrompt = (idx: number) => {
    persistCustomPrompts(customPrompts.filter((_, i) => i !== idx));
  };

  const handleSelectVoice = useCallback((v: KokoroVoiceId) => {
    setTtsVoice(v);
    setStoredVoice(v);
    const selectedGroup = Object.entries(KOKORO_VOICES_BY_LANGUAGE)
      .find(([, voices]) => voices.some((voice) => voice.id === v));
    const previewText = VOICE_PREVIEW_TEXT[selectedGroup?.[0] ?? '']
      ?? 'Hello, this is your selected voice preview. It should sound different from the other options.';
    speak(previewText, `voice-preview-${v}-${Date.now()}`);
  }, [speak]);
  // Warm up the Kokoro model in the background as soon as Chat mounts so
  // the first click on a "play" button feels instant instead of waiting
  // for an ~80MB download.
  useEffect(() => { preloadTTS(); }, [preloadTTS]);
  // Starter prompts are collapsed by default; collapse again whenever the
  // user switches between conversations (or starts a new chat) so the empty
  // hero stays focused on the input box.
  useEffect(() => { setPromptsExpanded(false); }, [activeId]);

  // Only show the download toast if the user actually clicks play before
  // the background preload finishes. We track that via `speakingId`.
  useEffect(() => {
    if (!ttsLoading || !speakingId) return;
    const msg = ttsModelState !== 'ready' && ttsLoadProgress < 100
      ? `Downloading voice model… ${Math.round(ttsLoadProgress)}% (one-time, then cached)`
      : 'Generating audio…';
    toast.loading(msg, { id: 'kokoro-loading' });
    return () => { toast.dismiss('kokoro-loading'); };
  }, [ttsLoading, ttsLoadProgress, speakingId, ttsModelState]);

  // Surface TTS errors so the user knows why playback didn't start.
  useEffect(() => {
    if (ttsModelState === 'error' && ttsError) {
      toast.error(`Voice playback failed: ${ttsError}`, { id: 'kokoro-error' });
    }
  }, [ttsModelState, ttsError]);

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


  // (TTS now provided by useKokoroTTS — free, in-browser Kokoro-82M.)


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
    refreshMicDevices();
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

  // Auto-scroll only if user near bottom. Also force a scroll the moment a
  // new turn begins (isStreaming flips true / phase changes) so the user
  // immediately sees the AI "Thinking…" indicator without scrolling down.
  useEffect(() => {
    if (stickToBottomRef.current || isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: streamingText ? 'auto' : 'smooth' });
    }
  }, [messages, streamingText, isStreaming, streamingPhase]);

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
    // Bump the new-chat epoch so any previously pending-null stream stops
    // showing on this fresh blank screen.
    newChatEpochRef.current += 1;
    setActiveId(null);
    setMessages([]);
    setInput('');
    setFiles([]);
    setSidebarOpen(false);
    setActiveFolderId(folderId);
    if (folderId) setExpandedFolders((prev) => new Set(prev).add(folderId));
    navigate('/chat');
  };

  // Keep a ref to activeId for use inside async stream handlers.
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  // Per-chat input drafts: save current draft for old chat, load for new.
  const prevActiveIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    const prev = prevActiveIdRef.current;
    const prevKey = prev ?? '__new__';
    // Save the in-progress draft for the chat we're leaving.
    setInput((current) => {
      if (current) draftsRef.current.set(prevKey, current);
      else draftsRef.current.delete(prevKey);
      return current;
    });
    // Load the draft (if any) for the chat we're entering.
    const newKey = activeId ?? '__new__';
    const next = draftsRef.current.get(newKey) ?? '';
    setInput(next);
    prevActiveIdRef.current = activeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const handleSelectConv = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    clearRecent(id);
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

  const handleSend = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !user) return;

    // The conversation we're starting this stream for, captured at send time.
    // May be null when the user is on the "New chat" screen.
    const startingConvId = activeId;

    // Block only if THIS chat already has an in-flight stream.
    // A stream in a different chat does not prevent sending here — that's
    // the whole point of parallel multi-chat streaming.
    if (findStreamForConv(startingConvId)) {
      toast.message('This chat is still answering — wait for it to finish or switch to another chat.');
      return;
    }

    if (!override) setInput('');

    stickToBottomRef.current = true;

    const tempUserMsg: Msg = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
      attachments: files.length ? files.map((f) => f.name) : null,
    };

    const toUpload = files;
    setFiles([]);

    const key =
      typeof crypto !== 'undefined' && (crypto as any).randomUUID
        ? (crypto as any).randomUUID()
        : `s-${Date.now()}-${Math.random()}`;
    const info: StreamInfo = {
      key,
      convId: startingConvId,
      newChatEpoch: newChatEpochRef.current,
      tempUserMsg,
      text: '',
      phase: 'Thinking',
      citations: [],
      abort: new AbortController(),
      aborted: false,
    };
    streamsRef.current.set(key, info);
    bumpStreams();

    try {
      const { urls: attachmentUrls, refs: attachmentRefs } = await uploadFiles(toUpload);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectRef}.supabase.co/functions/v1/chat-agent`;

      const detected = autoMode ? detectIntents(text) : { web: false, deep: false, loc: false };
      const effWeb = (canWebSearch && webSearch) || (canWebSearch && detected.web);
      const effDeep = deepMode || detected.deep;
      const effLoc = locationEnabled || detected.loc;
      let effLocation = (locationEnabled && userLocation) ? userLocation : undefined;
      if (!effLocation && detected.loc) {
        const loc = await captureOneShotLocation();
        if (loc) effLocation = loc;
      }
      const usedAuto = {
        web: !webSearch && detected.web && canWebSearch,
        deep: !deepMode && detected.deep,
        loc: !locationEnabled && detected.loc,
      };
      // Only flash the auto-badges if the user is still looking at this chat.
      if (autoMode && (usedAuto.web || usedAuto.deep || usedAuto.loc) && activeIdRef.current === startingConvId) {
        const parts = [
          usedAuto.web ? '🌐 Web' : null,
          usedAuto.deep ? '🧠 Deep' : null,
          usedAuto.loc ? '📍 Location' : null,
        ].filter(Boolean).join(' · ');
        toast.success(`Auto-enabled: ${parts}`, { duration: 2200 });
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
          conversation_id: startingConvId,
          connectionId: activeConnection?.id,
          folder_id: startingConvId ? undefined : activeFolderId,
          attachments: attachmentUrls,
          attachment_refs: attachmentRefs,
          stream: true,
          web_search: effWeb,
          user_location: effLoc ? effLocation : undefined,
          deep: effDeep,
        }),
        signal: info.abort.signal,
      });

      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('text/event-stream') && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          if (info.aborted) { try { reader.cancel(); } catch {} break; }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const ev of events) {
            if (info.aborted) break;
            const line = ev.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'conversation') {
                const newId = data.conversation_id as string | undefined;
                if (newId && !info.convId) {
                  info.convId = newId;
                  // Only navigate if the user is still on the new-chat screen
                  // that started this stream. If they've already moved on,
                  // leave their navigation alone.
                  if (activeIdRef.current == null) {
                    setActiveId(newId);
                    navigate(`/chat/${newId}`, { replace: true });
                  }
                  bumpStreams();
                }
              } else if (data.type === 'token') {
                const chunk = typeof data.content === 'string' ? data.content : '';
                if (!chunk) continue;
                const BATCH = 2;
                for (let i = 0; i < chunk.length; i += BATCH) {
                  if (info.aborted) break;
                  info.text += chunk.slice(i, i + BATCH);
                  bumpStreams();
                  await new Promise((resolve) => setTimeout(resolve, 18));
                }
              } else if (data.type === 'citations') {
                info.citations = Array.isArray(data.citations) ? data.citations : [];
                bumpStreams();
              } else if (data.type === 'phase') {
                if (typeof data.label === 'string' && data.label.trim()) {
                  info.phase = data.label.trim();
                  bumpStreams();
                }
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
        // Reload messages & conversations to capture saved rows.
        let lastAssistant: Msg | null = null;
        if (info.convId) {
          const { data: msgs } = await supabase
            .from('chat_messages')
            .select('id, role, content, created_at, attachments, citations')
            .eq('conversation_id', info.convId)
            .order('created_at', { ascending: true });
          const filtered = ((msgs as Msg[]) || []).filter((m) => m.role !== 'system');
          // Only replace the visible message list if the user is currently
          // viewing this chat. Otherwise the saved messages will load
          // naturally when they navigate to it.
          if (activeIdRef.current === info.convId) {
            setMessages(filtered);
          }
          lastAssistant = [...filtered].reverse().find((m) => m.role === 'assistant') || null;
        }
        if (voiceOut && lastAssistant?.content && activeIdRef.current === info.convId) {
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
          if (data.conversation_id && !info.convId) {
            info.convId = data.conversation_id;
            if (activeIdRef.current == null) {
              setActiveId(data.conversation_id);
              navigate(`/chat/${data.conversation_id}`, { replace: true });
            }
          }
          const cid = info.convId;
          if (cid) {
            const { data: msgs } = await supabase
              .from('chat_messages')
              .select('id, role, content, created_at, attachments, citations')
              .eq('conversation_id', cid)
              .order('created_at', { ascending: true });
            if (activeIdRef.current === cid) {
              setMessages(((msgs as Msg[]) || []).filter((m) => m.role !== 'system'));
            }
          }
          loadConversations();
          loadUsage();
        }
      }
    } catch (e) {
      const name = (e as any)?.name;
      if (name === 'AbortError' || info.aborted) {
        toast.message('Stopped');
      } else {
        toast.error(e instanceof Error ? e.message : 'Failed to send');
      }
    } finally {
      streamsRef.current.delete(key);
      bumpStreams();
      // Auto badges are per-turn — only clear them if the user is currently
      // looking at the chat that just finished.
      if (activeIdRef.current === info.convId) {
        setAutoBadges({});
      }
      // Mark the conv as "recently replied" so the sidebar shows a dark-green
      // dot until the user opens it again.
      if (info.convId && !info.aborted) {
        markRecent(info.convId);
      }
    }
  };

  const handleStop = () => {
    const s = activeStream;
    if (!s) return;
    s.aborted = true;
    try { s.abort.abort(); } catch { /* ignore */ }
  };




  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Re-ask the model with the user prompt that produced this assistant
  // reply. Doesn't delete the old reply — appends a fresh attempt below it
  // so the user can compare, like ChatGPT's "Regenerate".
  const handleRegenerate = (assistantMessageId: string) => {
    if (isStreaming) return;
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx < 0) return;
    let priorUserText: string | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].content?.trim()) {
        priorUserText = messages[i].content;
        break;
      }
    }
    if (!priorUserText) {
      toast.error("Couldn't find the original message to regenerate.");
      return;
    }
    handleSend(priorUserText);
  };

  // Create a draft of the assistant reply in the user's own connected
  // mailbox (Gmail or Outlook), addressed to themselves. We intentionally
  // create a draft (not auto-send) so the user can review/edit and hit
  // Send from their mail app.
  const handleEmailToSelf = async (assistantMessage: Msg) => {
    if (!activeConnection?.id || !activeConnection?.email) {
      toast.error('Connect a mailbox first to email yourself.');
      return;
    }
    const providerLabel = activeConnection.provider === 'google' ? 'Gmail'
      : activeConnection.provider === 'outlook' ? 'Outlook'
      : 'your mailbox';
    const subjectBase = (assistantMessage.content || '').trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 80) || 'InboxIQ chat note';
    const subject = `InboxIQ – ${subjectBase}`;
    // Render the assistant's markdown reply into the same styled HTML the
    // chat shows on-screen so the email arrives with bold headings, lists,
    // code blocks, links, etc. — not as flat plain text.
    const rawHtml = await marked.parse(assistantMessage.content || '', { gfm: true, breaks: true });
    const safeHtml = DOMPurify.sanitize(rawHtml as string, { USE_PROFILES: { html: true } });
    const styledHtml = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;line-height:1.55;">
<div style="max-width:640px;margin:0 auto;padding:28px 16px;">
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:28px 32px;box-shadow:0 2px 12px rgba(15,23,42,0.04);">
    <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6366f1;margin-bottom:6px;">InboxIQ</div>
    <div style="font-size:18px;font-weight:600;color:#0f172a;margin:0 0 18px 0;">${subjectBase.replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c] || c))}</div>
    <div style="font-size:15px;color:#0f172a;">
      <style>
        .iq h1,.iq h2,.iq h3{color:#0f172a;font-weight:600;line-height:1.3;margin:18px 0 8px;}
        .iq h1{font-size:20px;} .iq h2{font-size:17px;} .iq h3{font-size:15px;}
        .iq p{margin:0 0 12px;} .iq ul,.iq ol{padding-left:20px;margin:0 0 12px;}
        .iq li{margin:4px 0;} .iq strong{color:#0f172a;}
        .iq a{color:#4f46e5;text-decoration:underline;}
        .iq code{background:#f1f5f9;border-radius:4px;padding:1px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;}
        .iq pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:13px;}
        .iq pre code{background:transparent;color:inherit;padding:0;}
        .iq blockquote{border-left:3px solid #c7d2fe;margin:12px 0;padding:4px 14px;color:#475569;background:#f8fafc;border-radius:0 6px 6px 0;}
        .iq table{border-collapse:collapse;width:100%;margin:12px 0;} .iq th,.iq td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;font-size:14px;}
        .iq th{background:#f8fafc;}
      </style>
      <div class="iq">${safeHtml}</div>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0 14px;" />
    <div style="font-size:12px;color:#64748b;">Sent from your InboxIQ chat to ${activeConnection.email}.</div>
  </div>
</div>
</body></html>`;
    const toastId = toast.loading(`Sending to ${providerLabel}…`);
    try {
      const { data, error } = await supabase.functions.invoke('push-draft-to-provider', {
        body: {
          connection_id: activeConnection.id,
          subject,
          body: styledHtml,
          to: [activeConnection.email],
          is_html: true,
          mode: 'send',
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const result = data as { mode?: 'draft' | 'send'; webLink?: string | null } | null;
      const destinationUrl = result?.mode === 'draft'
        ? (result?.webLink
          ?? (activeConnection.provider === 'google'
            ? 'https://mail.google.com/mail/u/0/#drafts'
            : activeConnection.provider === 'outlook'
              ? 'https://outlook.office.com/mail/drafts'
              : null))
        : (activeConnection.provider === 'google'
          ? 'https://mail.google.com/mail/u/0/#sent'
          : activeConnection.provider === 'outlook'
            ? 'https://outlook.office.com/mail/sentitems'
            : null);
      toast.success(`Sent to ${activeConnection.email} in ${providerLabel}.`, {
        id: toastId,
        action: destinationUrl ? {
          label: result?.mode === 'draft' ? 'Open drafts' : 'Open sent',
          onClick: () => window.open(destinationUrl, '_blank', 'noopener,noreferrer'),
        } : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Couldn't create draft in ${providerLabel}`, { id: toastId });
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
    // Base expiry on last activity (updated_at). Actively-used chats never expire.
    const days = daysUntilExpiry(c.updated_at || c.created_at);
    const titleText = c.title && c.title.trim() && c.title.toLowerCase() !== 'user greeting'
      ? c.title
      : 'New chat';
    return (
      <div
        key={c.id}
        data-tour="chat-conv-row"
        className={cn(
          'group flex items-center gap-2 px-2.5 py-2 border-b border-border/40 text-sm cursor-pointer transition-all hover:bg-primary/10 hover:text-primary hover:pl-3',
          opts.indent && 'ml-5',
          activeId === c.id && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-l-2 border-l-emerald-500 pl-2'
        )}
        onClick={() => handleSelectConv(c.id)}
      >
        {streamingConvIds.has(c.id) ? (
          <span
            className="relative flex h-2.5 w-2.5 shrink-0"
            title="AI is replying in this chat"
            aria-label="AI is replying in this chat"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-300 opacity-80" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-300 ring-2 ring-green-300/40" />
          </span>
        ) : recentConvIds.has(c.id) ? (
          <span
            className="relative flex h-2.5 w-2.5 shrink-0"
            title="Recent AI reply — click to view"
            aria-label="Recent AI reply"
          >
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-700 ring-2 ring-green-700/30" />
          </span>
        ) : null}
        <span className="flex-1 truncate group-hover:font-semibold transition-all">{titleText}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-tour="chat-conv-menu"
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

  // Composer block — extracted so we can render it both at the bottom of
  // an active conversation AND in the middle of the empty-state hero
  // (ChatGPT-style centered input on a fresh chat).
  const composerBlock = (
        <div className="bg-background -mt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-2 pb-3 space-y-2.5">
            {messages.length > 0 && (
              <div data-tour="chat-capacity">
                <ChatCreditMeter
                  onSummarizeAndContinue={handleSummarizeAndContinue}
                  summarizing={summarizing}
                  messageCount={messages.filter((m) => m.role !== 'system').length}
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
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="default"
                        size="icon"
                        className={cn(
                          'h-9 w-9 shrink-0 rounded-full',
                          (autoMode || webSearch || locationEnabled || deepMode) && 'ring-2 ring-primary/40',
                        )}
                        disabled={isStreaming || limitReached}
                        aria-label="More tools"
                        data-tour="chat-tools"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Tools — attach, web search, location, deep mode, voice</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-72">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setAutoMode((v) => {
                        const next = !v;
                        toast.success(next
                          ? 'Auto mode ON — I’ll turn on web search, location, and deep reasoning when your request needs them'
                          : 'Auto mode OFF — I’ll only use the toggles you set');
                        return next;
                      });
                    }}
                  >
                    <Wand2 className="h-4 w-4 mr-2" />
                    <span className="flex-1">Auto mode</span>
                    {autoMode && <Check className="h-4 w-4 opacity-80" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e) => { e.preventDefault(); fileInputRef.current?.click(); }}
                    data-tour="chat-attach"
                  >
                    <Paperclip className="h-4 w-4 mr-2" />
                    <span className="flex-1">Attach files</span>
                  </DropdownMenuItem>
                  {canWebSearch && (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setWebSearch((v) => {
                          const next = !v;
                          toast.success(next ? 'Web search on — using live results' : 'Web search off');
                          return next;
                        });
                      }}
                      data-tour="chat-web"
                    >
                      <Globe className="h-4 w-4 mr-2" />
                      <span className="flex-1">Web search</span>
                      {webSearch && <Check className="h-4 w-4 opacity-80" />}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setLocationEnabled((v) => {
                        const next = !v;
                        toast.success(next
                          ? 'Location sharing on — the assistant can use your approximate location'
                          : 'Location sharing off');
                        return next;
                      });
                    }}
                    data-tour="chat-location"
                  >
                    {locationEnabled ? <MapPin className="h-4 w-4 mr-2" /> : <MapPinOff className="h-4 w-4 mr-2" />}
                    <span className="flex-1">Share location</span>
                    {locationEnabled && <Check className="h-4 w-4 opacity-80" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setDeepMode((v) => {
                        const next = !v;
                        toast.success(next
                          ? 'Deep mode ON — thorough multi-step answers, no follow-up questions'
                          : 'Deep mode OFF');
                        return next;
                      });
                    }}
                    data-tour="chat-deep"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    <span className="flex-1">Deep mode</span>
                    {deepMode && <Check className="h-4 w-4 opacity-80" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Volume2 className="h-4 w-4 mr-2" />
                      <span className="flex-1">Voice</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="max-h-[360px] w-64 overflow-y-auto">
                        {Object.entries(KOKORO_VOICES_BY_LANGUAGE).map(([lang, voices], idx) => (
                          <div key={lang}>
                            {idx > 0 && <DropdownMenuSeparator />}
                            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">{lang}</div>
                            {voices.map((v) => (
                              <DropdownMenuItem key={v.id} onSelect={() => handleSelectVoice(v.id)}>
                                <Check className={cn('h-4 w-4 mr-2', ttsVoice === v.id ? 'opacity-100' : 'opacity-0')} />
                                <span className="flex-1">{v.label}</span>
                                <span className="ml-2 text-[10px] text-muted-foreground">{v.gender === 'female' ? '♀' : '♂'}</span>
                              </DropdownMenuItem>
                            ))}
                          </div>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="relative flex-1 min-w-0">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={limitReached ? 'Daily limit reached' : (isRecording ? 'Listening… your speech will be added to what you already typed' : 'Message InboxIQ...')}
                  disabled={isStreaming || limitReached}
                  rows={1}
                  className={cn(
                    'w-full resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent min-h-0 py-2',
                    isRecording && 'pr-[200px]',
                  )}
                  data-tour="chat-input"
                />
                {isRecording && (
                  <div className="pointer-events-none absolute right-1 bottom-1 flex items-center gap-2 rounded-full bg-background/90 backdrop-blur px-2 py-1 border border-destructive/40 shadow-sm">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-destructive/70 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                    </span>
                    <VoiceWaveform getAnalyser={getAnalyser} active={isRecording} className="h-5 w-20" />
                    <span className="text-[10px] font-medium text-muted-foreground shrink-0">Listening…</span>
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
              <Button
                size="icon"
                variant={isStreaming ? 'destructive' : 'default'}
                className="h-9 w-9 shrink-0 rounded-full"
                onClick={() => (isStreaming ? handleStop() : handleSend())}
                disabled={isStreaming ? false : (!input.trim() || limitReached || isRecording)}
                title={isStreaming ? 'Stop generating' : (isRecording ? 'Stop the mic first, then send' : 'Send message')}
                aria-label={isStreaming ? 'Stop generating' : 'Send message'}
              >
                {isStreaming ? <Square className="h-4 w-4" fill="currentColor" /> : <Send className="h-4 w-4" />}
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
              {isStreaming && (
                <span className="text-muted-foreground">InboxIQ is processing…</span>
              )}
              {input.length > 1000 && (
                <span className="text-muted-foreground">{input.length} chars</span>
              )}
            </div>
          </div>
        </div>
  );

  return (

    <div className="h-full flex bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        'fixed lg:static top-0 left-0 z-40 w-[300px] h-[100dvh] lg:h-full bg-card border-r border-border flex flex-col transition-transform pb-[env(safe-area-inset-bottom)]',
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
          <Button onClick={handleCreateFolder} variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground" data-tour="chat-new-folder">
            <FolderPlus className="h-3.5 w-3.5" /> New folder
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-1 space-y-3 pb-[calc(env(safe-area-inset-bottom)+96px)]">
          {/* Inactivity banner removed — chats only expire after 30 days of no activity.
              Users can export individual chats via the ⋮ menu (Download or Save to OneDrive). */}

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
                        'group flex items-center gap-1.5 px-2.5 py-2 border-b border-border/40 text-sm cursor-pointer transition-all hover:bg-primary/10 hover:text-primary',
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
                        <span className="flex-1 truncate font-medium group-hover:font-semibold transition-all">{f.name}</span>
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
              <div className="mx-2 mt-3 mb-1 px-2 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-sm">{label}</div>
              {items.map((c) => renderConvRow(c))}
            </div>
          ))}
          {!conversations.length && (
            <div className="px-2 py-6 text-xs text-muted-foreground text-center">
              No conversations yet
            </div>
          )}
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 h-full min-h-0">
        {/* Page hero — matches the colored header used on other pages */}
        <div className="shrink-0 px-4 lg:px-6 pt-4 pb-3">
          <PageHero
            accent="purple"
            eyebrow="AI INTELLIGENCE"
            title={activeConversationTitle}
            description={activeId
              ? 'Ask follow-ups, draft replies, or summarize — all in one thread.'
              : 'Ask anything about your inbox, calendar, or work.'}
            icon={<MessageSquare className="w-5 h-5 text-white" />}
            actions={
              <>
                <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 text-white hover:bg-white/15" onClick={() => setSidebarOpen(true)}>
                  <Menu className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8 text-white hover:bg-white/15">
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </>
            }
          />
        </div>

        {messages.length === 0 && !streamingText ? (
          // Empty state — ChatGPT-style: hero + composer sit in the vertical
          // center of the page. Starter prompts live below and start collapsed.
          <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center px-4 pt-8 sm:pt-12 pb-6">
            <div className="w-full max-w-3xl flex flex-col items-center gap-5">
              <AgentAvatar className="w-24 h-24 sm:w-28 sm:h-28 shadow-glow" />
              <div className="text-center">
                <h2 className="text-xl sm:text-2xl font-semibold mb-1">How can I help you today?</h2>
                <p className="text-muted-foreground text-sm">Type your message below — or pick a starter.</p>
              </div>

              {/* Composer placed in the middle, directly under the greeting. */}
              <div className="w-full">{composerBlock}</div>

              {/* Collapsible starter prompts with admin/user "Add prompt". */}
              <div className="w-full">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setPromptsExpanded((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
                    aria-expanded={promptsExpanded}
                  >
                    {promptsExpanded
                      ? <ChevronDown className="h-3.5 w-3.5" />
                      : <ChevronRight className="h-3.5 w-3.5" />}
                    Starter prompts
                    <span className="text-[10px] opacity-60">
                      ({examplePrompts.length + customPrompts.length})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddPromptOpen(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    title="Save your own prompt to this list"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add prompt
                  </button>
                </div>
                {promptsExpanded && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {examplePrompts.map((p) => (
                      <button
                        key={p.title}
                        onClick={() => setInput(`${p.title} ${p.desc}`)}
                        className="text-left border border-border rounded-xl p-3 hover:border-primary hover:bg-accent transition group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-muted group-hover:bg-background">
                            <p.icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{p.title}</div>
                            <div className="text-xs text-muted-foreground truncate">{p.desc}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                    {customPrompts.map((p, idx) => (
                      <div
                        key={`custom-${idx}-${p.title}`}
                        className="relative text-left border border-border rounded-xl p-3 hover:border-primary hover:bg-accent transition group"
                      >
                        <button
                          type="button"
                          onClick={() => setInput(p.desc ? `${p.title} ${p.desc}` : p.title)}
                          className="block w-full text-left"
                        >
                          <div className="flex items-start gap-3 pr-6">
                            <div className="p-2 rounded-lg bg-muted group-hover:bg-background">
                              <Sparkles className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{p.title}</div>
                              {p.desc && <div className="text-xs text-muted-foreground truncate">{p.desc}</div>}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCustomPrompt(idx)}
                          title="Remove prompt"
                          className="absolute top-1.5 right-1.5 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-background opacity-0 group-hover:opacity-100 transition"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              onScroll={onScrollContainer}
              className="flex-1 overflow-y-auto min-h-0"
            >
              <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-10 space-y-6">
                {messages.map((m) => <MessageBubble key={m.id} message={m} userInitial={userInitial} speakingId={speakingId} ttsLoading={ttsLoading} ttsProgress={ttsLoadProgress} ttsModelState={ttsModelState} onSpeak={speak} onStopSpeak={stopSpeak} onRegenerate={handleRegenerate} onEmailToSelf={handleEmailToSelf} onResubmit={(text) => { if (!isStreaming) handleSend(text); }} mailboxLabel={activeConnection?.provider === 'google' ? 'Gmail' : activeConnection?.provider === 'outlook' ? 'Outlook' : null} mailboxEmail={activeConnection?.email ?? null} isStreamingAny={isStreaming} />)}
                {activeStream && (
                  <>
                    <MessageBubble
                      message={activeStream.tempUserMsg}
                      userInitial={userInitial}
                      isStreamingAny={isStreaming}
                    />
                    {activeStream.text ? (
                      <MessageBubble
                        message={{
                          id: 'streaming',
                          role: 'assistant',
                          content: activeStream.text,
                          created_at: new Date().toISOString(),
                          citations: activeStream.citations.length ? activeStream.citations : null,
                        }}
                        userInitial={userInitial}
                        streaming
                      />
                    ) : (
                      <AIThinking label={activeStream.phase} />
                    )}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
            {composerBlock}
          </>
        )}

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

      {/* Add starter-prompt dialog — saved per-user in this browser. */}
      <Dialog open={addPromptOpen} onOpenChange={setAddPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a starter prompt</DialogTitle>
            <DialogDescription>
              Save a custom prompt you use often. It appears in your starter list whenever you open a new chat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input
                value={newPromptTitle}
                onChange={(e) => setNewPromptTitle(e.target.value)}
                placeholder="e.g. Weekly status update"
                maxLength={80}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Details (optional)</label>
              <Textarea
                value={newPromptDesc}
                onChange={(e) => setNewPromptDesc(e.target.value)}
                placeholder="e.g. summarizing this week's progress, blockers, and next steps"
                rows={3}
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddPromptOpen(false)}>Cancel</Button>
            <Button onClick={addCustomPrompt}>Save prompt</Button>
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
  ttsLoading,
  ttsProgress,
  ttsModelState,
  onSpeak,
  onStopSpeak,
  onRegenerate,
  onEmailToSelf,
  onResubmit,
  mailboxLabel,
  mailboxEmail,
  isStreamingAny,
}: {
  message: Msg;
  userInitial: string;
  streaming?: boolean;
  speakingId?: string | null;
  ttsLoading?: boolean;
  ttsProgress?: number;
  ttsModelState?: string;
  onSpeak?: (text: string, id: string) => void;
  onStopSpeak?: () => void;
  onRegenerate?: (assistantMessageId: string) => void;
  onEmailToSelf?: (assistantMessage: Msg) => void;
  onResubmit?: (newText: string) => void;
  mailboxLabel?: string | null;
  mailboxEmail?: string | null;
  isStreamingAny?: boolean;
}) {
  const isUser = message.role === 'user';
  const copy = () => {
    navigator.clipboard.writeText(message.content);
    toast.success('Copied to clipboard');
  };
  const isSpeaking = speakingId === message.id;
  const isTtsBusy = isSpeaking && !!ttsLoading;
  const ttsPct = Math.max(0, Math.min(100, Math.round(ttsProgress ?? 0)));
  const ttsBusyLabel = ttsModelState !== 'ready' && ttsPct < 100
    ? `Downloading ${ttsPct}%`
    : 'Generating…';
  const canRegenerate = !!onRegenerate && !message.id.startsWith('temp-') && message.id !== 'streaming';
  const canEmail = !!onEmailToSelf && !!mailboxLabel && !!mailboxEmail;
  const canEdit = isUser && !!onResubmit && !message.id.startsWith('temp-');

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(message.content);
      requestAnimationFrame(() => {
        const ta = editRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = ta.value.length;
          ta.style.height = 'auto';
          ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
        }
      });
    }
  }, [isEditing, message.content]);

  const submitEdit = () => {
    const next = draft.trim();
    if (!next) return;
    setIsEditing(false);
    onResubmit?.(next);
  };

  return (
    <div className="flex flex-col gap-1.5 group">
      {!isUser && (
        <AgentAvatar active={!!streaming} className="h-9 w-9 shrink-0" />
      )}
      <div className={cn('max-w-[85%] flex flex-col gap-1', isUser ? 'items-end self-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
            isUser ? 'bg-primary text-primary-foreground' : 'text-foreground',
            isEditing && 'w-full'
          )}
        >
          {isUser ? (
            isEditing ? (
              <div className="flex flex-col gap-2 min-w-[260px]">
                <textarea
                  ref={editRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    const ta = e.currentTarget;
                    ta.style.height = 'auto';
                    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submitEdit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsEditing(false);
                    }
                  }}
                  className="w-full resize-none bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/60 rounded-lg px-3 py-2 text-[15px] leading-relaxed outline-none ring-1 ring-primary-foreground/30 focus:ring-2 focus:ring-primary-foreground/60"
                  rows={2}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-2.5 py-1 rounded-md text-xs bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitEdit}
                    disabled={!draft.trim() || !!isStreamingAny}
                    className="px-2.5 py-1 rounded-md text-xs bg-primary-foreground text-primary hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Send the edited message (⌘/Ctrl + Enter)"
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            )
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed [&_p]:my-3 [&_p]:leading-relaxed [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1.5 [&_li]:leading-relaxed [&_h1]:mt-5 [&_h1]:mb-3 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:mt-4 [&_h3]:mb-2 [&_hr]:my-5 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-foreground/70 dark:[&_hr]:bg-foreground/80 [&_blockquote]:my-3 [&_pre]:bg-background [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:my-3 [&_code]:text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
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
        {isUser && canEdit && !isEditing && (
          <div className="flex flex-wrap gap-1 items-center mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={() => setIsEditing(true)}
              disabled={!!isStreamingAny}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition disabled:opacity-50 disabled:cursor-not-allowed"
              title="Edit this message and send it again"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>Edit &amp; resend</span>
            </button>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition"
              title="Copy to clipboard"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </button>
          </div>
        )}
        {!isUser && !streaming && (
          <div className="flex flex-wrap gap-1 items-center mt-1" data-tour="chat-msg-actions">
            <button
              data-tour="chat-msg-copy"
              onClick={copy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition"
              title="Copy reply to clipboard"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </button>
            {canRegenerate && (
              <button
                data-tour="chat-msg-regenerate"
                onClick={() => onRegenerate!(message.id)}
                disabled={!!isStreamingAny}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Ask the AI to answer again"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Regenerate</span>
              </button>
            )}
            {canEmail && (
              <button
                data-tour="chat-msg-email"
                onClick={() => onEmailToSelf!(message)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition"
                title={`Create a draft in ${mailboxLabel} addressed to ${mailboxEmail}`}
              >
                <Mail className="h-3.5 w-3.5" />
                <span>Email to me{mailboxLabel ? ` (${mailboxLabel})` : ''}</span>
              </button>
            )}
            {onSpeak && (
              <button
                data-tour="chat-msg-play"
                onClick={() => isSpeaking ? onStopSpeak?.() : onSpeak(message.content, message.id)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
                  isSpeaking
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                )}
                title={isSpeaking ? (isTtsBusy ? 'Preparing audio — click to cancel' : 'Stop reading') : 'Read this reply aloud'}
              >
                {isTtsBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isSpeaking ? (
                  <VolumeX className="h-3.5 w-3.5" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
                <span>{isTtsBusy ? ttsBusyLabel : isSpeaking ? 'Stop' : 'Play'}</span>
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

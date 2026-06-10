import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Inbox,
  BellRing,
  UserCog,
  Video,
  Activity,
  Sun,
  ArrowRight,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  OPEN_WELCOME_GUIDE_EVENT,
  START_GUIDED_TOUR_EVENT,
  type StartGuidedTourDetail,
} from '@/components/help/events';

/**
 * Full-screen premium dark-glass welcome guide.
 *
 * - Auto-opens once per user (localStorage `inboxiq_welcome_guide_seen`).
 * - Manual relaunch via `OPEN_WELCOME_GUIDE_EVENT`.
 * - Presents an overview paragraph + 7 section tiles. Clicking a tile
 *   navigates to that page and, if an article tour exists, automatically
 *   fires the spotlight tour so each control gets highlighted in turn.
 */

const STORAGE_KEY = 'inboxiq_welcome_guide_seen_v1';

interface Section {
  id: string;
  title: string;
  tagline: string;
  description: string;
  route: string;
  /** Help article id whose `steps[].target` will be spotlighted on arrival. */
  tourArticleId?: string;
  Icon: LucideIcon;
  /** Tailwind gradient stops for the tile's glow. */
  accent: string;
}

const SECTIONS: Section[] = [
  {
    id: 'chat',
    title: 'AI Chat',
    tagline: 'Your always-on AI co-pilot',
    description:
      'Ask anything in natural language. Search your inbox, your documents, or the live web — attach files, talk to it, and keep multiple conversations running in parallel.',
    route: '/chat',
    tourArticleId: 'ai-assistant',
    Icon: MessageSquare,
    accent: 'from-indigo-500/40 to-violet-500/20',
  },
  {
    id: 'email-intelligence',
    title: 'Email Intelligence',
    tagline: 'Auto-sort & auto-draft your inbox',
    description:
      'Define the categories that match how you work. InboxIQ labels new mail, applies your rules, and prepares draft replies you can review and send in seconds.',
    route: '/categories',
    tourArticleId: 'categories-overview',
    Icon: Inbox,
    accent: 'from-emerald-500/40 to-teal-500/20',
  },
  {
    id: 'reply-tracker',
    title: 'My Reply Tracker',
    tagline: 'Never lose a follow-up',
    description:
      'See every thread you’re waiting on. InboxIQ surfaces unanswered conversations, suggests nudges, and helps you close the loop before it slips.',
    route: '/follow-up-reminder',
    Icon: BellRing,
    accent: 'from-amber-500/40 to-orange-500/20',
  },
  {
    id: 'daily-brief',
    title: 'My Daily Brief',
    tagline: 'A 60-second morning standup',
    description:
      'Open it each morning for an executive summary of what landed overnight, what needs you, and what can wait — generated fresh by AI.',
    route: '/ai-daily-brief',
    tourArticleId: 'daily-brief',
    Icon: Sun,
    accent: 'from-yellow-400/40 to-amber-500/20',
  },
  {
    id: 'meeting-copilot',
    title: 'Meeting Copilot',
    tagline: 'Prep, transcribe, summarize',
    description:
      'Pull context from emails and calendar before every meeting, capture the conversation live, and walk away with action items written for you.',
    route: '/meeting-copilot',
    Icon: Video,
    accent: 'from-sky-500/40 to-blue-500/20',
  },
  {
    id: 'ai-activity',
    title: 'AI Activity',
    tagline: 'See what the AI did for you',
    description:
      'A transparent log of every draft written, label applied, and message processed — with full traceability and one-click overrides.',
    route: '/ai-activity',
    Icon: Activity,
    accent: 'from-fuchsia-500/40 to-pink-500/20',
  },
  {
    id: 'settings',
    title: 'My Profile Settings',
    tagline: 'Make InboxIQ sound like you',
    description:
      'Set your tone, signature, photo, and writing voice. Manage connected accounts and decide exactly which features are on.',
    route: '/settings',
    tourArticleId: 'profile-signature',
    Icon: UserCog,
    accent: 'from-slate-400/40 to-zinc-500/20',
  },
];

export function WelcomeGuide() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Auto-open once per browser/user on first authenticated landing.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== '1') {
        // Slight delay so the app shell renders first.
        const t = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Manual relaunch.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_WELCOME_GUIDE_EVENT, handler);
    return () => window.removeEventListener(OPEN_WELCOME_GUIDE_EVENT, handler);
  }, []);

  const close = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const openSection = (section: Section) => {
    close();
    navigate(section.route);
    if (section.tourArticleId) {
      // Wait for the page to mount + targets to render, then start the
      // spotlight tour that walks through every button on the page.
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent<StartGuidedTourDetail>(START_GUIDED_TOUR_EVENT, {
            detail: { articleId: section.tourArticleId! },
          }),
        );
      }, 650);
    }
  };

  if (!open) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[110] overflow-y-auto animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to InboxIQ"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#05070f]/85 backdrop-blur-xl"
        onClick={close}
      />
      {/* Ambient gradient blobs */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full bg-indigo-600/25 blur-[140px]" />
        <div className="absolute top-1/3 -right-32 h-[520px] w-[520px] rounded-full bg-violet-500/20 blur-[160px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-fuchsia-500/15 blur-[140px]" />
      </div>

      {/* Content */}
      <div className="relative min-h-full px-4 py-10 sm:px-8 sm:py-14 flex justify-center">
        <div className="w-full max-w-6xl">
          {/* Close */}
          <button
            type="button"
            onClick={close}
            aria-label="Close welcome guide"
            className="absolute top-4 right-4 sm:top-6 sm:right-6 h-10 w-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur flex items-center justify-center text-white/80 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Hero */}
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-indigo-200/80 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
              Welcome to InboxIQ
            </div>
            <h1 className="mt-5 text-3xl sm:text-5xl font-semibold tracking-tight bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent leading-tight">
              Your inbox, intelligently in control.
            </h1>
            <p className="mt-5 text-base sm:text-lg leading-relaxed text-white/70">
              InboxIQ is your AI co-pilot for email, meetings, and follow-ups.
              It connects to your Gmail or Outlook mailbox, organizes incoming
              messages into categories you control, drafts replies in your own
              voice, and gives you an executive morning brief — so you spend
              minutes on email instead of hours. Pick any section below to see
              exactly what it does and get a guided tour of every button.
            </p>
          </div>

          {/* Section grid */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SECTIONS.map((section, idx) => (
              <button
                key={section.id}
                type="button"
                onClick={() => openSection(section)}
                style={{ animationDelay: `${idx * 60}ms` }}
                className={cn(
                  'group relative text-left rounded-2xl p-5 sm:p-6',
                  'bg-white/[0.04] hover:bg-white/[0.07] backdrop-blur-xl',
                  'border border-white/10 hover:border-white/20',
                  'transition-all duration-300 hover:-translate-y-1',
                  'shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)]',
                  'animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500',
                )}
              >
                {/* Accent glow */}
                <div
                  aria-hidden
                  className={cn(
                    'absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none',
                    'bg-gradient-to-br',
                    section.accent,
                  )}
                  style={{ filter: 'blur(40px)' }}
                />
                <div className="relative">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={cn(
                        'h-11 w-11 rounded-xl flex items-center justify-center',
                        'bg-gradient-to-br border border-white/15',
                        section.accent,
                      )}
                    >
                      <section.Icon className="h-5 w-5 text-white" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-white/40 group-hover:text-white group-hover:translate-x-0.5 transition" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">
                    {section.title}
                  </h3>
                  <p className="mt-0.5 text-xs uppercase tracking-wider text-indigo-200/70">
                    {section.tagline}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-white/65">
                    {section.description}
                  </p>
                  <div className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-200/90 group-hover:text-white transition">
                    {section.tourArticleId
                      ? 'Take the guided tour'
                      : 'Open this section'}
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/55">
            <p>
              You can reopen this tour anytime from the floating guide pill in
              the bottom-left corner.
            </p>
            <button
              type="button"
              onClick={close}
              className="rounded-full px-5 py-2 bg-white/10 hover:bg-white/15 border border-white/15 text-white font-medium transition"
            >
              I’ll explore on my own
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

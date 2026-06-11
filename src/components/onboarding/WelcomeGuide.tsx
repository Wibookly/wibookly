import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
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
  BookOpen,
  MapPin,
  PlayCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  OPEN_WELCOME_GUIDE_EVENT,
  START_GUIDED_TOUR_EVENT,
  type StartGuidedTourDetail,
} from '@/components/help/events';
import { HELP_ARTICLES, filterHelpArticlesByAccess } from '@/config/help-content';
import { useFeatureAccess, type FeatureKey } from '@/hooks/useFeatureAccess';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';

/**
 * Full-screen premium dark-glass welcome guide.
 *
 * - Auto-opens once per user (localStorage `inboxiq_welcome_guide_seen`).
 * - Manual relaunch via `OPEN_WELCOME_GUIDE_EVENT`.
 * - Two menus:
 *    1. "App overview" — the main menu of all sections.
 *    2. "This page" — page-specific menu listing every guided tour
 *       available on the user's current route.
 */

const STORAGE_KEY = 'inboxiq_welcome_guide_seen_v2';

interface Section {
  id: string;
  title: string;
  tagline: string;
  description: string;
  route: string;
  tourArticleId?: string;
  Icon: LucideIcon;
  accent: string;
  /** Feature key required to surface this section. `null` = always shown. */
  feature: FeatureKey | null;
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
    feature: 'ai_chat',
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
    feature: 'email_intelligence',
  },
  {
    id: 'reply-tracker',
    title: 'My Reply Tracker',
    tagline: 'Never lose a follow-up',
    description:
      'See every thread you’re waiting on. InboxIQ surfaces unanswered conversations, suggests nudges, and helps you close the loop before it slips.',
    route: '/follow-up-reminder',
    tourArticleId: 'reply-tracker',
    Icon: BellRing,
    accent: 'from-amber-500/40 to-orange-500/20',
    feature: 'feature.follow_up_reminder',
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
    feature: 'daily_brief',
  },
  {
    id: 'meeting-copilot',
    title: 'Meeting Copilot',
    tagline: 'Prep, transcribe, summarize',
    description:
      'Pull context from emails and calendar before every meeting, capture the conversation live, and walk away with action items written for you.',
    route: '/meeting-copilot',
    tourArticleId: 'meeting-copilot',
    Icon: Video,
    accent: 'from-sky-500/40 to-blue-500/20',
    feature: 'meeting_copilot',
  },
  {
    id: 'ai-activity',
    title: 'AI Activity',
    tagline: 'See what the AI did for you',
    description:
      'A transparent log of every draft written, label applied, and message processed — with full traceability and one-click overrides.',
    route: '/ai-activity',
    tourArticleId: 'ai-activity',
    Icon: Activity,
    accent: 'from-fuchsia-500/40 to-pink-500/20',
    feature: 'reports',
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
    feature: null,
  },
];

type TabId = 'overview' | 'page';

export function WelcomeGuide() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const [autoChecked, setAutoChecked] = useState(false);
  const [onboardingCompletedAt, setOnboardingCompletedAt] = useState<string | null | undefined>(undefined);
  const navigate = useNavigate();
  const location = useLocation();
  const { hasFeature, loading: featuresLoading } = useFeatureAccess();
  const { profile, user, loading: authLoading } = useAuth();
  const openedByUserRef = useRef(false);
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  useEffect(() => {
    setAutoChecked(false);
    openedByUserRef.current = false;
  }, [user?.id]);

  // Only surface sections the user actually has permission to use.
  const visibleSections = useMemo(
    () =>
      SECTIONS.filter(
        (s) => s.feature === null || hasFeature(s.feature),
      ),
    [hasFeature],
  );

  useEffect(() => {
    if (!user?.id) {
      setOnboardingCompletedAt(undefined);
      return;
    }

    let cancelled = false;

    const loadOnboardingStatus = async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('onboarding_completed_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;
      const row = data as { onboarding_completed_at?: string | null } | null;
      setOnboardingCompletedAt(row?.onboarding_completed_at ?? null);
    };

    void loadOnboardingStatus();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Auto-open once per browser/user on first authenticated landing.
  // Wait until features have loaded so we don't render the menu with the
  // wrong set of sections.
  useEffect(() => {
    if (featuresLoading || authLoading || !user?.id || autoChecked || onboardingCompletedAt === undefined) return;

    let cancelled = false;

    const maybeOpen = async () => {
      try {
        const stored = localStorage.getItem(`${STORAGE_KEY}:${user.id}`);
        if (stored === '1') {
          if (!cancelled) setAutoChecked(true);
          return;
        }
      } catch {
        /* ignore */
      }

      const mainLandingRoutes = new Set(['/integrations', '/categories', '/settings']);
      if (!mainLandingRoutes.has(location.pathname)) {
        if (!cancelled) setAutoChecked(true);
        return;
      }

      const isFirstTimeUser = !onboardingCompletedAt;
      if (!cancelled) {
        if (isFirstTimeUser) {
          const t = window.setTimeout(() => {
            if (!cancelled) setOpen(true);
          }, 600);
          window.setTimeout(() => clearTimeout(t), 1200);
        }
        setAutoChecked(true);
      }
    };

    void maybeOpen();

    return () => {
      cancelled = true;
    };
  }, [featuresLoading, authLoading, user?.id, autoChecked, location.pathname, onboardingCompletedAt]);

  // Manual relaunch. Honor optional `tab` detail.
  useEffect(() => {
    const handler = (e: Event) => {
      openedByUserRef.current = true;
      const detail = (e as CustomEvent<{ tab?: TabId }>).detail;
      if (detail?.tab) setTab(detail.tab);
      else setTab('overview');
      setOpen(true);
    };
    window.addEventListener(OPEN_WELCOME_GUIDE_EVENT, handler as EventListener);
    return () =>
      window.removeEventListener(OPEN_WELCOME_GUIDE_EVENT, handler as EventListener);
  }, []);

  const close = () => {
    try {
      if (user?.id) {
        localStorage.setItem(`${STORAGE_KEY}:${user.id}`, '1');
      }
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const openSection = (section: Section) => {
    close();
    navigate(section.route);
    if (section.tourArticleId) {
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent<StartGuidedTourDetail>(START_GUIDED_TOUR_EVENT, {
            detail: { articleId: section.tourArticleId! },
          }),
        );
      }, 650);
    }
  };

  // Articles whose routes include the current path = "tours for this page".
  const pageArticles = useMemo(() => {
    const path = location.pathname;
    return filterHelpArticlesByAccess(
      HELP_ARTICLES.filter(
      (a) => a.routes?.includes(path) && (a.steps?.length ?? 0) > 0,
      ),
      hasFeature,
      isSuperAdmin,
    );
  }, [location.pathname, hasFeature, isSuperAdmin]);

  const startTour = (articleId: string) => {
    close();
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<StartGuidedTourDetail>(START_GUIDED_TOUR_EVENT, {
          detail: { articleId },
        }),
      );
    }, 200);
  };

  if (!open) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[110] overflow-y-auto animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to InboxIQ"
    >
      <div
        className="absolute inset-0 bg-[#05070f]/85 backdrop-blur-xl"
        onClick={close}
      />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full bg-indigo-600/25 blur-[140px]" />
        <div className="absolute top-1/3 -right-32 h-[520px] w-[520px] rounded-full bg-violet-500/20 blur-[160px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-fuchsia-500/15 blur-[140px]" />
      </div>

      <div className="relative min-h-full px-4 py-10 sm:px-8 sm:py-14 flex justify-center">
        <div className="w-full max-w-6xl">
          <button
            type="button"
            onClick={close}
            aria-label="Close welcome guide"
            className="absolute top-4 right-4 sm:top-6 sm:right-6 h-10 w-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur flex items-center justify-center text-white/80 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Hero */}
          <div className="text-center max-w-3xl mx-auto pr-12 sm:pr-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-indigo-200/80 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
              Welcome to InboxIQ — Quick Guide
            </div>
            <h1 className="mt-5 text-3xl sm:text-5xl font-semibold tracking-tight bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent leading-tight">
              Here’s everything InboxIQ does for you.
            </h1>
            <p className="mt-5 text-base sm:text-lg leading-relaxed text-white/70">
              This is your one-stop onboarding tour. Below is the full map of
              the platform — every section you have access to, what it does,
              and a guided walkthrough you can launch with one click.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/55">
              New here? Start with <strong className="text-white/80">AI Chat</strong>,
              then set up <strong className="text-white/80">Email Intelligence</strong>{' '}
              and your <strong className="text-white/80">Profile Settings</strong>.
              You can reopen this guide any time from{' '}
              <strong className="text-white/80">User Guide</strong> in the sidebar.
            </p>
          </div>

          {/* "What this app provides" — bullets filtered by user permissions */}
          {visibleSections.length > 0 && (
            <div className="mt-8 max-w-4xl mx-auto rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-5 sm:p-6">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-indigo-200/80">
                <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                What this app provides for you
              </div>
              <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {visibleSections.map((s) => (
                  <li key={s.id} className="flex items-start gap-3">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-gradient-to-br from-indigo-500/40 to-violet-500/20 border border-white/15 flex items-center justify-center">
                      <s.Icon className="h-3 w-3 text-white" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">
                        {s.title}
                      </div>
                      <div className="text-xs text-white/60 leading-relaxed">
                        {s.tagline}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-white/45">
                Only the capabilities your account has access to are listed here.
              </p>
            </div>
          )}



          {/* Quick "how it works" strip */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {[
              {
                step: '1',
                title: 'Explore the sections',
                body: 'Tap any card below to jump into that part of InboxIQ.',
              },
              {
                step: '2',
                title: 'Take the guided tour',
                body: 'Each section opens with a step-by-step walkthrough of the UI.',
              },
              {
                step: '3',
                title: 'Reopen any time',
                body: 'Use User Guide in the sidebar to bring this menu back.',
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur p-4 text-left"
              >
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-indigo-200/80">
                  <span className="h-5 w-5 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[10px] text-white">
                    {s.step}
                  </span>
                  {s.title}
                </div>
                <p className="mt-2 text-sm text-white/65 leading-relaxed">
                  {s.body}
                </p>
              </div>
            ))}
          </div>

          {/* Tab bar */}
          <div className="mt-8 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur">
              <button
                type="button"
                onClick={() => setTab('overview')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition',
                  tab === 'overview'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-white/60 hover:text-white',
                )}
              >
                <BookOpen className="h-3.5 w-3.5" />
                App overview
              </button>
              <button
                type="button"
                onClick={() => setTab('page')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition',
                  tab === 'page'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-white/60 hover:text-white',
                )}
              >
                <MapPin className="h-3.5 w-3.5" />
                This page
                <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80">
                  {pageArticles.length}
                </span>
              </button>
            </div>
          </div>

          {tab === 'overview' && (
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {visibleSections.map((section, idx) => (
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
          )}

          {tab === 'page' && (
            <div className="mt-10">
              <div className="mb-4 text-center text-xs text-white/55">
                Guided tours available on{' '}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-white/80">
                  {location.pathname}
                </code>
              </div>
              {pageArticles.length === 0 ? (
                <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur">
                  <MapPin className="mx-auto h-6 w-6 text-white/40" />
                  <p className="mt-3 text-sm text-white/70">
                    There aren’t any page-specific tours for this screen yet.
                    Use <strong className="text-white">App overview</strong> to
                    jump into a section that has a tour.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {pageArticles.map((a, idx) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => startTour(a.id)}
                      style={{ animationDelay: `${idx * 50}ms` }}
                      className={cn(
                        'group relative text-left rounded-2xl p-5',
                        'bg-white/[0.04] hover:bg-white/[0.07] backdrop-blur-xl',
                        'border border-white/10 hover:border-white/20',
                        'transition-all duration-300 hover:-translate-y-0.5',
                        'animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500/40 to-violet-500/20 border border-white/15 flex items-center justify-center">
                          <PlayCircle className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-white truncate">
                            {a.title}
                          </h3>
                          <p className="mt-1 text-sm text-white/65 line-clamp-2">
                            {a.summary}
                          </p>
                          <div className="mt-3 flex items-center gap-3 text-[11px] text-white/50">
                            <span>{a.steps?.length ?? 0} steps</span>
                            <span className="inline-flex items-center gap-1 text-indigo-200/90 group-hover:text-white transition">
                              Start tour <ArrowRight className="h-3 w-3" />
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-10 sticky bottom-0 pb-1">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={close}
                className="w-full sm:w-auto rounded-full px-5 py-3 bg-white/10 hover:bg-white/15 border border-white/15 text-white font-medium transition"
              >
                {openedByUserRef.current ? 'Close guide' : 'I’ll explore on my own'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

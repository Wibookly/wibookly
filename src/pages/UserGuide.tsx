import {
  Compass,
  BookOpen,
  PlayCircle,
  ArrowRight,
  MessageSquare,
  Inbox,
  BellRing,
  Sun,
  Video,
  Activity,
  UserCog,
  Plug,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHero } from '@/components/app/PageHero';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFeatureAccess, type FeatureKey } from '@/hooks/useFeatureAccess';
import { useAuth } from '@/lib/auth';
import {
  OPEN_WELCOME_GUIDE_EVENT,
  START_GUIDED_TOUR_EVENT,
  type StartGuidedTourDetail,
} from '@/components/help/events';

interface GuideEntry {
  id: string;
  title: string;
  description: string;
  route: string;
  tourArticleId?: string;
  Icon: LucideIcon;
  feature: FeatureKey | null;
  accent: string;
}

const GUIDES: GuideEntry[] = [
  {
    id: 'chat',
    title: 'AI Chat',
    description:
      'Talk to your AI co-pilot. Ask anything in natural language, attach files, search the web, or run multiple conversations in parallel.',
    route: '/chat',
    tourArticleId: 'ai-assistant',
    Icon: MessageSquare,
    feature: 'ai_chat',
    accent: 'from-indigo-500/15 to-violet-500/5 border-indigo-500/30',
  },
  {
    id: 'email-intelligence',
    title: 'Email Intelligence',
    description:
      'Auto-categorize new mail, apply rules, and let AI prepare draft replies you review and send in seconds.',
    route: '/categories',
    tourArticleId: 'categories-overview',
    Icon: Inbox,
    feature: 'email_intelligence',
    accent: 'from-emerald-500/15 to-teal-500/5 border-emerald-500/30',
  },
  {
    id: 'reply-tracker',
    title: 'Flagged Email Tracker',
    description:
      'Flag a sent email in Outlook with a due date — InboxIQ watches the thread and politely follows up if nobody replies in time.',
    route: '/follow-up-reminder',
    tourArticleId: 'reply-tracker',
    Icon: BellRing,
    feature: 'feature.follow_up_reminder',
    accent: 'from-amber-500/15 to-orange-500/5 border-amber-500/30',
  },
  {
    id: 'daily-brief',
    title: 'The Helm (Daily Brief)',
    description:
      'A 60-second morning standup with priorities, calendar, and next actions — on demand or scheduled to your inbox.',
    route: '/the-helm',
    tourArticleId: 'daily-brief',
    Icon: Sun,
    feature: 'daily_brief',
    accent: 'from-yellow-500/15 to-amber-500/5 border-yellow-500/30',
  },
  {
    id: 'meeting-copilot',
    title: 'Meeting Copilot',
    description:
      'Prep beforehand, record and transcribe live, then turn the discussion into notes, summaries, and action items.',
    route: '/meeting-copilot',
    tourArticleId: 'meeting-copilot',
    Icon: Video,
    feature: 'meeting_copilot',
    accent: 'from-sky-500/15 to-blue-500/5 border-sky-500/30',
  },
  {
    id: 'ai-activity',
    title: 'AI Intelligence Report',
    description:
      'See exactly what AI did for you — drafts, processed mail, follow-ups, and where you use AI most.',
    route: '/ai-activity',
    tourArticleId: 'ai-activity',
    Icon: Activity,
    feature: 'reports',
    accent: 'from-fuchsia-500/15 to-pink-500/5 border-fuchsia-500/30',
  },
  {
    id: 'integrations',
    title: 'Integrations',
    description:
      'Connect Microsoft 365 (mail + calendar) and manage your active connections per workspace.',
    route: '/integrations',
    Icon: Plug,
    feature: null,
    accent: 'from-cyan-500/15 to-blue-500/5 border-cyan-500/30',
  },
  {
    id: 'settings',
    title: 'My Profile & Signature',
    description:
      'Set your tone, signature, and identity so AI drafts sound like you — every time.',
    route: '/settings',
    tourArticleId: 'profile-signature',
    Icon: UserCog,
    feature: null,
    accent: 'from-slate-500/15 to-zinc-500/5 border-slate-500/30',
  },
];

export default function UserGuide() {
  const navigate = useNavigate();
  const { hasFeature } = useFeatureAccess();
  const { profile } = useAuth();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  const openWelcome = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WELCOME_GUIDE_EVENT));
  };

  const startTour = (route: string, articleId?: string) => {
    navigate(route);
    if (!articleId) return;
    // Defer so the destination page can mount its tour targets first.
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<StartGuidedTourDetail>(START_GUIDED_TOUR_EVENT, {
          detail: { articleId },
        }),
      );
    }, 600);
  };

  const visible = GUIDES.filter((g) => g.feature === null || isSuperAdmin || hasFeature(g.feature));

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Knowledge Base"
          title="User Guide"
          description="Pick a feature to learn how it works, or launch a guided walkthrough straight to the page."
          accent="cyan"
          icon={<Compass className="w-5 h-5 text-white" strokeWidth={2} />}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={openWelcome}
              className="bg-white/15 hover:bg-white/25 text-white border-white/20"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              Open full walkthrough
            </Button>
          }
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in space-y-6 max-w-6xl">
        {/* Hero "start here" card */}
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4">
            <div className="grid place-items-center w-12 h-12 rounded-xl bg-primary/15 text-primary shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold">New here? Start with the full walkthrough.</h2>
              <p className="text-sm text-muted-foreground mt-1">
                A guided tour of every InboxIQ feature your account has access to — about 5 minutes end to end.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={openWelcome}>
                <PlayCircle className="w-4 h-4 mr-2" /> Start full walkthrough
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Feature guides */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Feature guides
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((g) => {
              const Icon = g.Icon;
              return (
                <Card
                  key={g.id}
                  className={`bg-gradient-to-br ${g.accent} border transition-all hover:shadow-md hover:-translate-y-0.5`}
                >
                  <CardContent className="p-5 flex flex-col gap-3 h-full">
                    <div className="flex items-start gap-3">
                      <div className="grid place-items-center w-10 h-10 rounded-lg bg-background/70 shrink-0">
                        <Icon className="w-5 h-5 text-foreground/80" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm leading-tight">{g.title}</h3>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                      {g.description}
                    </p>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-8 px-2"
                        onClick={() => navigate(g.route)}
                      >
                        Open page
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                      {g.tourArticleId && (
                        <Badge
                          variant="secondary"
                          className="cursor-pointer hover:bg-secondary/80 text-[10px] h-6 px-2"
                          onClick={() => startTour(g.route, g.tourArticleId)}
                        >
                          <PlayCircle className="w-3 h-3 mr-1" /> Tour me
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
